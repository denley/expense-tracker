/*
  Expense tracker server: serves the built app and the API under BASE_PATH,
  and is the only writer of DATA_DIR (see store.ts).

  Config (env):
    PORT=8098  HOST=127.0.0.1  BASE_PATH=/expense-tracker
    DATA_DIR=./data  STATIC_DIR=./dist
    ALLOWED_LOGINS=*        comma-separated Tailscale logins, or * for anyone on the tailnet
    APP_VERSION             shown in the app, for "which build is this"
*/
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { isWsFileName, WS_FILE_NAMES, type WsFileName } from "../client/src/lib/files";
import { makeBackup } from "../client/src/lib/export";
import type { Actor } from "./activity";
import { HttpError, identify, isAllowed, readBody, readJson, send, sendJson, serveStatic } from "./http";
import * as ops from "./ops";
import { ConflictError, Store, ValidationError, type ChangeEvent } from "./store";

const PORT = Number(process.env.PORT) || 8098;
const HOST = process.env.HOST || "127.0.0.1";
const BASE = (process.env.BASE_PATH ?? "/expense-tracker").replace(/\/$/, "");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || "./dist");
const VERSION = process.env.APP_VERSION || "dev";
const ALLOWED = (process.env.ALLOWED_LOGINS || "*")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const store = new Store(DATA_DIR, { apiBase: `http://127.0.0.1:${PORT}${BASE}/api` });

/* ---------- Live events (SSE) ---------- */

const clients = new Set<ServerResponse>();

function broadcast(ev: ChangeEvent): void {
  const msg = `event: change\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(msg);
}

setInterval(() => {
  for (const res of clients) res.write(": keepalive\n\n");
}, 25_000).unref();

function openEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

/* ---------- Routes ---------- */

type Handler = (ctx: {
  req: IncomingMessage;
  res: ServerResponse;
  actor: Actor;
  url: URL;
  params: string[];
}) => Promise<unknown> | unknown;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [];
const route = (method: string, pattern: RegExp, handler: Handler) => routes.push({ method, pattern, handler });

const bool = (v: string | null) => v === "1" || v === "true";

function fileParam(name: string): WsFileName {
  if (!isWsFileName(name)) throw new HttpError(404, `No such data file (have: ${WS_FILE_NAMES.join(", ")})`);
  return name;
}

route("GET", /^\/workspace$/, ({ actor }) => ({
  files: Object.fromEntries(WS_FILE_NAMES.map((n) => [n, store.get(n)])),
  me: actor,
  version: VERSION,
  dataDir: process.env.DATA_DIR_LABEL || DATA_DIR,
}));

route("PUT", /^\/workspace$/, async ({ req, actor }) => {
  const body = await readJson<{ files?: Record<string, string>; reason?: string }>(req);
  const files: Partial<Record<WsFileName, string>> = {};
  for (const [name, text] of Object.entries(body.files ?? {})) {
    if (typeof text !== "string") throw new HttpError(400, `${name}: must be text`);
    files[fileParam(name)] = text;
  }
  if (!files["transactions.csv"]) throw new HttpError(400, "transactions.csv is required");
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 80) : "Replaced all data";
  return { revs: await store.replaceAll(files, actor, reason) };
});

route("GET", /^\/files\/([^/]+)$/, ({ req, res, url, params }) => {
  const f = store.get(fileParam(params[0]));
  if (url.searchParams.get("format") === "json") return f;
  send(req, res, 200, f.text, {
    "Content-Type": params[0].endsWith(".json") ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
    ETag: `"${f.rev}"`,
    "Cache-Control": "no-store",
  });
});

route("PUT", /^\/files\/([^/]+)$/, async ({ req, res, actor, params }) => {
  const name = fileParam(params[0]);
  const ifMatch = String(req.headers["if-match"] ?? "").replace(/"/g, "");
  if (!ifMatch) throw new HttpError(428, "If-Match (the revision your edit is based on) is required");
  const text = await readBody(req);
  const result = await store.putFile(name, text, ifMatch, actor);
  if (!result.ok) return sendJson(req, res, 409, result.current);
  return { rev: result.rev };
});

route("GET", /^\/events$/, ({ req, res }) => openEvents(req, res));

route("GET", /^\/activity$/, ({ url }) => ({
  entries: store.activity.list(Math.min(Number(url.searchParams.get("limit")) || 100, 1000)),
}));

route("POST", /^\/activity\/([^/]+)\/undo$/, async ({ actor, params }) => {
  const found = store.activity.getUndo(params[0]);
  if (!found) throw new HttpError(404, "Nothing to undo for that entry (already undone, or not an agent operation)");
  const { result } = await store.apply((ws) => ({ ...ops.undo(ws, found.undo), title: `Undid: ${found.entry.summary}` }), actor, "app");
  await store.activity.markUndone(params[0], actor);
  broadcast({ files: {} });
  const skipped = result.skipped ? ` (${result.skipped} left alone: changed since)` : "";
  return { summary: `Reverted ${result.reverted} change${result.reverted === 1 ? "" : "s"}${skipped}`, ...result };
});

route("GET", /^\/backups$/, async () => {
  const list = await store.backups.list();
  return {
    backups: list.map((s) => ({ name: s.name, at: s.at, reason: s.reason })),
  };
});

route("POST", /^\/backups$/, async () => ({ backup: await store.snapshot("manual") }));

route("POST", /^\/backups\/([^/]+)\/restore$/, async ({ actor, params }) => {
  try {
    await store.restore(params[0], actor);
  } catch (e) {
    if (e instanceof Error && /ENOENT|No such backup/.test(e.message)) throw new HttpError(404, "No such backup");
    throw e;
  }
  return { ok: true };
});

route("GET", /^\/backup\.json$/, ({ req, res }) => {
  const ws = store.workspace();
  const body = JSON.stringify(makeBackup(ws.transactions, ws.nodes, ws.rules, ws.importProfiles), null, 2);
  send(req, res, 200, body, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="expense-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  });
});

/* Agent API */

route("GET", /^\/summary$/, () => ({
  ...ops.summary(store.workspace()),
  lastActivity: store.activity.list(1)[0] ?? null,
}));

route("GET", /^\/categories$/, ({ url }) => ({
  categories: ops.listCategories(store.workspace(), bool(url.searchParams.get("archived"))),
}));

route("POST", /^\/categories$/, async ({ req, actor }) => {
  const body = await readJson(req);
  return (await store.apply((ws) => ops.addCategory(ws, body), actor)).result;
});

route("GET", /^\/transactions$/, ({ url }) => {
  const q = url.searchParams;
  return ops.listTransactions(store.workspace(), {
    uncategorized: bool(q.get("uncategorized")),
    q: q.get("q") ?? undefined,
    account: q.get("account") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    category: q.get("category") ?? undefined,
    ids: q.get("ids")?.split(",").filter(Boolean),
    limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    offset: q.get("offset") ? Number(q.get("offset")) : undefined,
  });
});

route("POST", /^\/transactions$/, async ({ req, actor }) => {
  const body = await readJson(req);
  const rows = body.transactions;
  return (await store.apply((ws) => ops.addTransactions(ws, rows, body), actor)).result;
});

route("POST", /^\/transactions\/categori[sz]e$/, async ({ req, actor }) => {
  const body = await readJson(req);
  const items: ops.CategorizeItem[] =
    body.items ?? (Array.isArray(body.ids) ? body.ids.map((id: string) => ({ id, category: body.category ?? body.categoryId })) : []);
  return (await store.apply((ws) => ops.categorize(ws, items, !!body.allowArchived), actor)).result;
});

route("GET", /^\/rules$/, () => {
  const ws = store.workspace();
  const paths = ops.listCategories(ws, true);
  const pathOf = (id: string) => paths.find((c) => c.id === id)?.path ?? id;
  return {
    rules: ws.rules.map((r, i) => ({
      priority: i + 1,
      pattern: r.pattern,
      isRegex: r.isRegex,
      categoryId: r.categoryId,
      category: pathOf(r.categoryId),
      enabled: r.enabled,
      createdAt: r.createdAt,
    })),
  };
});

route("POST", /^\/rules$/, async ({ req, actor }) => {
  const body = await readJson(req);
  return (await store.apply((ws) => ops.addRule(ws, body), actor)).result;
});

route("POST", /^\/rules\/apply$/, async ({ req, actor }) => {
  const body = await readJson(req);
  return (await store.apply((ws) => ops.applyAllRules(ws, !!body.overwrite), actor)).result;
});

route("GET", /^\/suggestions$/, () => ops.suggestions(store.workspace()));

route("POST", /^\/import$/, async ({ req, actor }) => {
  const body = await readJson<ops.ImportInput>(req);
  return (await store.apply((ws) => ops.importCsv(ws, body), actor)).result;
});

/* ---------- Server ---------- */

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz" || url.pathname === `${BASE}/healthz`) {
    return sendJson(req, res, 200, { ok: true, version: VERSION });
  }
  if (BASE && (url.pathname === "/" || url.pathname === BASE)) {
    res.writeHead(302, { Location: `${BASE}/` });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(`${BASE}/`)) throw new HttpError(404, "Not found");
  const rel = url.pathname.slice(BASE.length);

  if (!rel.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
    return serveStatic(req, res, STATIC_DIR, rel.slice(1));
  }

  const actor = identify(req);
  if (!actor) throw new HttpError(403, "This app needs a signed-in Tailscale user (tagged devices aren't identified)");
  if (!isAllowed(actor, ALLOWED)) {
    throw new HttpError(403, `${actor.login} isn't allowed to use this app yet: add it to ALLOWED_LOGINS on the server`);
  }

  const apiPath = rel.slice("/api".length);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(apiPath);
    if (!m) continue;
    const out = await r.handler({ req, res, actor, url, params: m.slice(1).map(decodeURIComponent) });
    if (!res.headersSent && out !== undefined) sendJson(req, res, 200, out);
    return;
  }
  throw new HttpError(404, `No route ${req.method} ${apiPath}`);
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status =
      e instanceof HttpError ? e.status
      : e instanceof ops.OpError ? e.status
      : e instanceof ValidationError ? 400
      : e instanceof ConflictError ? 409
      : 500;
    if (status === 500) console.error(`${req.method} ${req.url}`, e);
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(req, res, status, { error: e instanceof Error ? e.message : String(e) });
  });
});

store.onChange((ev) => {
  broadcast(ev);
  if (ev.entry) console.log(`${ev.entry.actor.name} [${ev.entry.source}]: ${ev.entry.summary}`);
});

await store.init();
store.startWatching();
server.listen(PORT, HOST, () => {
  console.log(`expense-tracker ${VERSION} on http://${HOST}:${PORT}${BASE}/ (data: ${DATA_DIR})`);
});

const shutdown = () => {
  store.stopWatching();
  for (const res of clients) res.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
