/*
  Activity log: who changed what, in activity.jsonl (append-only; a later
  line with the same id supersedes an earlier one, which is how coalescing
  and "undone" marks are recorded). Bursts of in-app edits by one person to
  the same files within 10 minutes coalesce into one entry.

  Agent operations store an undo recipe (never sent to clients); undoing
  only reverts rows still in the state the operation left them in.
*/
import { appendFile, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { renderSummary, mergeSummary, type ChangeSummary } from "./summarize";

export interface Actor {
  login: string;
  name: string;
  kind: "tailnet" | "local" | "system";
}

export type Source = "app" | "api" | "external" | "system";

export interface Undo {
  /** Transactions whose category the operation changed: revert to `from` if still `to` */
  txnCategories?: Array<{ id: string; from: string; to: string }>;
  /** Transactions the operation added */
  removeTxns?: string[];
  /** Rules the operation added (rules are identified by CreatedAt) */
  removeRules?: string[];
  /** Category nodes the operation created (removed only while unused) */
  removeNodes?: string[];
}

interface StoredEntry {
  id: string;
  at: string;
  until?: string;
  actor: Actor;
  source: Source;
  files: string[];
  counts: Record<string, number>;
  examples: string[];
  /** Overrides the rendered counts (e.g. "Restored backup …") */
  title?: string;
  undo?: Undo;
  undoneAt?: string;
  undoneBy?: string;
}

export interface PublicEntry {
  id: string;
  at: string;
  until?: string;
  actor: Actor;
  source: Source;
  files: string[];
  summary: string;
  examples: string[];
  canUndo: boolean;
  undoneAt?: string;
  undoneBy?: string;
}

const COALESCE_MS = 10 * 60_000;

export class ActivityLog {
  private entries: StoredEntry[] = [];
  private index = new Map<string, number>();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    let text = "";
    try {
      text = await readFile(this.file, "utf8");
    } catch {
      return;
    }
    let lines = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      lines++;
      try {
        this.put(JSON.parse(line) as StoredEntry);
      } catch {
        // skip a torn line
      }
    }
    // Compact when superseded lines dominate
    if (lines > this.entries.length * 2 + 100) {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
      await rename(tmp, this.file);
    }
  }

  private put(e: StoredEntry): void {
    const i = this.index.get(e.id);
    if (i === undefined) {
      this.index.set(e.id, this.entries.length);
      this.entries.push(e);
    } else {
      this.entries[i] = e;
    }
  }

  private async save(e: StoredEntry): Promise<void> {
    this.put(e);
    await appendFile(this.file, JSON.stringify(e) + "\n");
  }

  async record(opts: {
    actor: Actor;
    source: Source;
    files: string[];
    summary: ChangeSummary;
    title?: string;
    undo?: Undo;
    now?: Date;
  }): Promise<PublicEntry> {
    const now = opts.now ?? new Date();
    const last = this.entries[this.entries.length - 1];
    const files = [...opts.files].sort();
    if (
      last &&
      opts.source === "app" &&
      last.source === "app" &&
      !opts.undo &&
      !last.undo &&
      !opts.title &&
      !last.title &&
      last.actor.login === opts.actor.login &&
      last.files.join() === files.join() &&
      now.getTime() - Date.parse(last.until ?? last.at) < COALESCE_MS
    ) {
      const merged = mergeSummary({ counts: { ...last.counts }, examples: [...last.examples] }, opts.summary);
      const e: StoredEntry = { ...last, until: now.toISOString(), counts: merged.counts, examples: merged.examples };
      await this.save(e);
      return toPublic(e);
    }
    const e: StoredEntry = {
      id: `${now.getTime().toString(36)}-${randomBytes(3).toString("hex")}`,
      at: now.toISOString(),
      actor: opts.actor,
      source: opts.source,
      files,
      counts: opts.summary.counts,
      examples: opts.summary.examples,
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.undo ? { undo: opts.undo } : {}),
    };
    await this.save(e);
    return toPublic(e);
  }

  list(limit = 100): PublicEntry[] {
    return this.entries.slice(-limit).reverse().map(toPublic);
  }

  getUndo(id: string): { entry: PublicEntry; undo: Undo } | null {
    const i = this.index.get(id);
    if (i === undefined) return null;
    const e = this.entries[i];
    if (!e.undo || e.undoneAt) return null;
    return { entry: toPublic(e), undo: e.undo };
  }

  async markUndone(id: string, by: Actor, now = new Date()): Promise<void> {
    const i = this.index.get(id);
    if (i === undefined) return;
    await this.save({ ...this.entries[i], undoneAt: now.toISOString(), undoneBy: by.name });
  }
}

function toPublic(e: StoredEntry): PublicEntry {
  return {
    id: e.id,
    at: e.at,
    ...(e.until ? { until: e.until } : {}),
    actor: e.actor,
    source: e.source,
    files: e.files,
    summary: e.title ?? renderSummary(e.counts),
    examples: e.examples,
    canUndo: !!e.undo && !e.undoneAt,
    ...(e.undoneAt ? { undoneAt: e.undoneAt, undoneBy: e.undoneBy } : {}),
  };
}
