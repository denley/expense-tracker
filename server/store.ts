/*
  The data folder and its single writer.

  - Every data file has a revision (content hash). Writes from the app name
    the revision they were based on; a stale one is a conflict (the app then
    replays its edit onto the current copy).
  - Writes are atomic (temp file + rename) and serialized (one at a time).
  - Each write snapshots first when it's the day's first change, records an
    activity entry (diff summary + who), and is broadcast to live clients.
  - Direct edits to the files (agents, scripts, an editor) are noticed by a
    watcher + poll, snapshotted (the previous content, at most hourly),
    normalized, logged and broadcast the same way.
*/
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  WS_FILES,
  WS_FILE_NAMES,
  emptyWorkspaceTexts,
  normalizeLoaded,
  parseWorkspace,
  serializeTxns,
  nodesToCsv,
  rulesToCsv,
  profilesToJson,
  validateFile,
  type WorkspaceData,
  type WsFileName,
} from "../client/src/lib/files";
import { ActivityLog, type Actor, type PublicEntry, type Source, type Undo } from "./activity";
import { Backups, localDay, type Snapshot } from "./backups";
import { summarizeChanges, type ChangeSummary } from "./summarize";
import { workspaceReadme } from "./readme";

export interface FileState {
  text: string;
  rev: string;
}

export interface ChangeEvent {
  files: Partial<Record<WsFileName, string>>;
  entry?: PublicEntry;
}

export const SYSTEM: Actor = { login: "system", name: "Expense tracker", kind: "system" };
const EXTERNAL: Actor = { login: "file-edit", name: "Direct file edit", kind: "local" };

const EXTERNAL_SNAPSHOT_EVERY_MS = 60 * 60_000;

export const revOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** What an operation on the parsed workspace wants written */
export interface WorkspaceChanges {
  transactions?: WorkspaceData["transactions"];
  nodes?: WorkspaceData["nodes"];
  rules?: WorkspaceData["rules"];
  importProfiles?: WorkspaceData["importProfiles"];
}

export interface OpResult<R> {
  changes?: WorkspaceChanges;
  undo?: Undo;
  title?: string;
  /** Snapshot reason to take before writing (e.g. "pre-import") */
  snapshot?: string;
  result: R;
}

export class ConflictError extends Error {}

export class Store {
  readonly backups: Backups;
  readonly activity: ActivityLog;
  private files = new Map<WsFileName, FileState>();
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(ev: ChangeEvent) => void>();
  private seen = new Map<WsFileName, string>();
  private lastExternalSnapshot = 0;
  private watcher: FSWatcher | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly dir: string,
    private readonly readme: { apiBase: string } = { apiBase: "/api" }
  ) {
    this.backups = new Backups(path.join(dir, "backups"));
    this.activity = new ActivityLog(path.join(dir, "activity.jsonl"));
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const seed = emptyWorkspaceTexts();
    for (const name of WS_FILE_NAMES) {
      let text: string;
      try {
        text = await readFile(this.pathOf(name), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        // Only ever CREATE missing files, never overwrite
        text = seed[name];
        await this.writeAtomic(name, text);
      }
      this.files.set(name, { text, rev: revOf(text) });
      this.seen.set(name, await this.statKey(name));
    }
    await this.activity.load();
    await writeFile(path.join(this.dir, "README.md"), workspaceReadme(this.readme.apiBase));
    await this.exclusive(() => this.normalize());
  }

  /** Serialize every read-modify-write */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  onChange(fn: (ev: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(name: WsFileName): FileState {
    return this.files.get(name)!;
  }

  texts(): Record<WsFileName, string> {
    return Object.fromEntries(WS_FILE_NAMES.map((n) => [n, this.get(n).text])) as Record<WsFileName, string>;
  }

  revs(): Record<WsFileName, string> {
    return Object.fromEntries(WS_FILE_NAMES.map((n) => [n, this.get(n).rev])) as Record<WsFileName, string>;
  }

  workspace(): WorkspaceData {
    return parseWorkspace(this.texts());
  }

  /* ---------- Writes ---------- */

  /** Write one file from the app, based on revision `ifMatch` */
  putFile(
    name: WsFileName,
    text: string,
    ifMatch: string,
    actor: Actor
  ): Promise<{ ok: true; rev: string } | { ok: false; current: FileState }> {
    return this.exclusive(async () => {
      const current = this.get(name);
      if (ifMatch !== current.rev) return { ok: false as const, current };
      const problem = validateFile(name, text);
      if (problem) throw new ValidationError(problem);
      await this.commit({ [name]: text }, { actor, source: "app" });
      return { ok: true as const, rev: this.get(name).rev };
    });
  }

  /** Replace every file (restore, first-time upload). Snapshots the current state first. */
  replaceAll(
    files: Partial<Record<WsFileName, string>>,
    actor: Actor,
    title: string
  ): Promise<Record<WsFileName, string>> {
    return this.exclusive(async () => {
      for (const [name, text] of Object.entries(files)) {
        const problem = validateFile(name as WsFileName, text!);
        if (problem) throw new ValidationError(problem);
      }
      await this.commit(files, { actor, source: "app", title, snapshot: "pre-replace" });
      return this.revs();
    });
  }

  restore(name: string, actor: Actor): Promise<void> {
    return this.exclusive(async () => {
      const saved = await this.backups.read(name);
      const files: Partial<Record<WsFileName, string>> = {};
      for (const n of WS_FILE_NAMES) if (saved[n] !== undefined) files[n] = saved[n];
      await this.commit(files, { actor, source: "app", title: `Restored backup ${name}`, snapshot: "pre-restore" });
    });
  }

  snapshot(reason: string): Promise<Snapshot> {
    return this.exclusive(() => this.backups.take(this.texts(), reason));
  }

  /**
   * Run an operation against the parsed workspace and write what it changed.
   * Throws when transactions.csv is unreadable (nothing may build on it).
   */
  apply<R>(op: (ws: WorkspaceData) => OpResult<R>, actor: Actor, source: Source = "api"): Promise<{ result: R; entry?: PublicEntry }> {
    return this.exclusive(async () => {
      const ws = this.workspace();
      if (ws.transactionsUnreadable) {
        throw new ConflictError("transactions.csv can't be parsed (missing or invalid header row); fix the file first");
      }
      const out = op(ws);
      const c = out.changes ?? {};
      const files: Partial<Record<WsFileName, string>> = {};
      if (c.transactions) files[WS_FILES.transactions] = serializeTxns(c.transactions);
      if (c.nodes) files[WS_FILES.categories] = nodesToCsv(c.nodes);
      if (c.rules) files[WS_FILES.rules] = rulesToCsv(c.rules);
      if (c.importProfiles) files[WS_FILES.profiles] = profilesToJson(c.importProfiles);
      const entry = await this.commit(files, { actor, source, undo: out.undo, title: out.title, snapshot: out.snapshot });
      return { result: out.result, entry };
    });
  }

  /** Must run inside exclusive() */
  private async commit(
    files: Partial<Record<WsFileName, string>>,
    ctx: { actor: Actor; source: Source; title?: string; undo?: Undo; snapshot?: string; summary?: ChangeSummary }
  ): Promise<PublicEntry | undefined> {
    const changed = (Object.entries(files) as Array<[WsFileName, string]>).filter(
      ([name, text]) => text !== this.get(name).text
    );
    if (changed.length === 0) return undefined;

    const now = new Date();
    if (!(await this.backups.hasSnapshotOn(localDay(now)))) await this.backups.take(this.texts(), "daily", now);
    if (ctx.snapshot) await this.backups.take(this.texts(), ctx.snapshot, now);

    const summary =
      ctx.summary ??
      summarizeChanges(
        changed.map(([name, text]) => ({ name, oldText: this.get(name).text, newText: text })),
        files[WS_FILES.categories] ?? this.get(WS_FILES.categories).text
      );
    for (const [name, text] of changed) await this.writeAtomic(name, text);

    const entry = await this.activity.record({
      actor: ctx.actor,
      source: ctx.source,
      files: changed.map(([n]) => n),
      summary,
      title: ctx.title,
      undo: ctx.undo,
      now,
    });
    this.emit({ files: Object.fromEntries(changed.map(([n]) => [n, this.get(n).rev])), entry });
    return entry;
  }

  private emit(ev: ChangeEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch (e) {
        console.error("change listener failed", e);
      }
    }
  }

  private pathOf(name: WsFileName): string {
    return path.join(this.dir, name);
  }

  private async writeAtomic(name: WsFileName, text: string): Promise<void> {
    const prev = this.files.get(name);
    // Update the in-memory copy first so the watcher never mistakes our own
    // write for an external edit
    this.files.set(name, { text, rev: revOf(text) });
    try {
      const tmp = `${this.pathOf(name)}.tmp-${process.pid}`;
      await writeFile(tmp, text);
      await rename(tmp, this.pathOf(name));
      this.seen.set(name, await this.statKey(name));
    } catch (e) {
      if (prev) this.files.set(name, prev);
      throw e;
    }
  }

  private async statKey(name: WsFileName): Promise<string> {
    try {
      const s = await stat(this.pathOf(name));
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "missing";
    }
  }

  /**
   * Keep the files coherent: Uncategorized exists, every transaction points
   * at a real node (unknown ids are registered as top-level nodes so nothing
   * is lost). Must run inside exclusive().
   */
  private async normalize(): Promise<void> {
    const ws = this.workspace();
    if (ws.transactionsUnreadable) return;
    const norm = normalizeLoaded(ws.transactions, ws.nodes);
    const files: Partial<Record<WsFileName, string>> = {};
    if (norm.txnsChanged) files[WS_FILES.transactions] = serializeTxns(norm.txns);
    if (norm.nodesChanged) files[WS_FILES.categories] = nodesToCsv(norm.nodes);
    await this.commit(files, { actor: SYSTEM, source: "system" });
  }

  /* ---------- Direct file edits ---------- */

  startWatching(pollMs = 3000): void {
    const schedule = () => {
      if (this.checkTimer) return;
      this.checkTimer = setTimeout(() => {
        this.checkTimer = null;
        void this.exclusive(() => this.checkExternal()).catch((e) => console.error("external check failed", e));
      }, 300);
    };
    try {
      this.watcher = watch(this.dir, (_event, file) => {
        if (file && (WS_FILE_NAMES as string[]).includes(String(file))) schedule();
      });
    } catch (e) {
      console.warn("fs.watch unavailable, polling only", e);
    }
    this.poll = setInterval(schedule, pollMs);
  }

  stopWatching(): void {
    this.watcher?.close();
    if (this.poll) clearInterval(this.poll);
    if (this.checkTimer) clearTimeout(this.checkTimer);
  }

  /** Must run inside exclusive() */
  async checkExternal(): Promise<void> {
    const changed: Array<{ name: WsFileName; text: string }> = [];
    for (const name of WS_FILE_NAMES) {
      const key = await this.statKey(name);
      if (key === this.seen.get(name)) continue;
      this.seen.set(name, key);
      if (key === "missing") {
        // Deleted out from under us: put our copy back rather than lose it
        await this.writeAtomic(name, this.get(name).text);
        continue;
      }
      const text = await readFile(this.pathOf(name), "utf8");
      if (revOf(text) !== this.get(name).rev) changed.push({ name, text });
    }
    if (changed.length === 0) return;

    const now = Date.now();
    if (now - this.lastExternalSnapshot > EXTERNAL_SNAPSHOT_EVERY_MS) {
      this.lastExternalSnapshot = now;
      await this.backups.take(this.texts(), "pre-file-edit");
    }
    const newCats = changed.find((c) => c.name === WS_FILES.categories)?.text ?? this.get(WS_FILES.categories).text;
    const summary = summarizeChanges(
      changed.map((c) => ({ name: c.name, oldText: this.get(c.name).text, newText: c.text })),
      newCats
    );
    for (const c of changed) this.files.set(c.name, { text: c.text, rev: revOf(c.text) });
    const entry = await this.activity.record({
      actor: EXTERNAL,
      source: "external",
      files: changed.map((c) => c.name),
      summary,
    });
    this.emit({ files: Object.fromEntries(changed.map((c) => [c.name, this.get(c.name).rev])), entry });
    await this.normalize();
  }
}

export class ValidationError extends Error {}
