/*
  Small HTTP helpers: identity, bodies (gzip either way), JSON replies,
  static files with an SPA fallback.
*/
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Actor } from "./activity";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Tailscale sends non-ASCII names MIME-encoded: =?utf-8?q?...?= */
export function decodeMimeWord(s: string): string {
  const m = /^=\?utf-8\?([qb])\?(.*)\?=$/i.exec(s.trim());
  if (!m) return s;
  if (m[1].toLowerCase() === "b") return Buffer.from(m[2], "base64").toString("utf8");
  const bytes = m[2].replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}

/**
 * Who is calling. Requests through `tailscale serve` carry the caller's
 * identity (serve sets these headers itself and drops any the client sent).
 * Requests that reach the port directly — only possible from the server box,
 * the port is bound to loopback — carry no forwarding headers: those are
 * local agents and scripts, who may name themselves with X-Actor. Anything
 * proxied without an identity (e.g. a tagged device) gets null.
 */
export function identify(req: IncomingMessage): Actor | null {
  const login = header(req, "tailscale-user-login");
  if (login) {
    const name = header(req, "tailscale-user-name");
    return { login, name: name ? decodeMimeWord(name) : login, kind: "tailnet" };
  }
  if (header(req, "x-forwarded-for") || header(req, "tailscale-headers-info")) return null;
  const name = (header(req, "x-actor") ?? "").trim().slice(0, 40) || "local agent";
  return { login: `local:${name}`, name, kind: "local" };
}

export function isAllowed(actor: Actor, allowed: string[]): boolean {
  if (actor.kind !== "tailnet") return true;
  return allowed.includes("*") || allowed.includes(actor.login.toLowerCase());
}

export async function readBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  let buf = Buffer.concat(chunks);
  if ((header(req, "content-encoding") ?? "").includes("gzip")) {
    try {
      buf = gunzipSync(buf);
    } catch {
      throw new HttpError(400, "Body isn't valid gzip");
    }
  }
  return buf.toString("utf8");
}

export async function readJson<T = any>(req: IncomingMessage): Promise<T> {
  const text = await readBody(req);
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

/** Send a body, gzipped when the client accepts it and it's worth it */
export function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {}
): void {
  let buf = typeof body === "string" ? Buffer.from(body) : body;
  const out: Record<string, string> = { ...headers };
  if (buf.length > 1024 && /\bgzip\b/.test(header(req, "accept-encoding") ?? "")) {
    buf = gzipSync(buf);
    out["Content-Encoding"] = "gzip";
    out["Vary"] = "Accept-Encoding";
  }
  out["Content-Length"] = String(buf.length);
  res.writeHead(status, out);
  res.end(buf);
}

export function sendJson(req: IncomingMessage, res: ServerResponse, status: number, data: unknown): void {
  send(req, res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Serve a file from the built app; unknown non-asset paths get index.html (client routing) */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  relPath: string
): Promise<void> {
  const root = path.resolve(staticDir);
  const clean = path.normalize(decodeURIComponent(relPath)).replace(/^([/\\]|\.\.[/\\])+/, "");
  let file = path.resolve(root, clean);
  if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, "Not found");
  let isFile = false;
  try {
    isFile = (await stat(file)).isFile();
  } catch {
    // fall through
  }
  if (!isFile) {
    if (path.extname(clean)) throw new HttpError(404, "Not found");
    file = path.join(root, "index.html");
  }
  const body = await readFile(file);
  const ext = path.extname(file);
  send(req, res, 200, body, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    // hashed bundles never change; everything else revalidates
    "Cache-Control": clean.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
}
