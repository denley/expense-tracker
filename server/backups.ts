/*
  Snapshots of the data files: backups/<stamp>-<reason>/<file>, plain copies
  so they can be restored by hand with cp. Taken before each day's first
  change, before restores/replace-all/imports, before applying a direct file
  edit (at most hourly), and on demand.

  Retention: everything from the last 30 days, then the newest snapshot of
  each older month, kept indefinitely (the files are small).
*/
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-(\d+))?-([a-z0-9-]+)$/;

export interface Snapshot {
  name: string;
  /** ISO timestamp (local wall time of the server, which runs in Australia/Adelaide) */
  at: string;
  reason: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time stamp, sortable: 2026-10-08T153012 */
export function stampOf(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function localDay(d: Date): string {
  return stampOf(d).slice(0, 10);
}

export function parseSnapshotName(name: string): Snapshot | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, , reason] = m;
  return { name, at: `${y}-${mo}-${d}T${h}:${mi}:${s}`, reason };
}

/** Names to delete under the retention policy (pure, for testing) */
export function snapshotsToPrune(names: string[], now: Date, keepDays = 30): string[] {
  const cutoff = stampOf(new Date(now.getTime() - keepDays * 86_400_000));
  const newestPerMonth = new Map<string, string>();
  for (const name of names) {
    if (!parseSnapshotName(name)) continue;
    const month = name.slice(0, 7);
    const best = newestPerMonth.get(month);
    if (!best || name > best) newestPerMonth.set(month, name);
  }
  return names.filter((name) => {
    if (!parseSnapshotName(name)) return false;
    if (name >= cutoff) return false;
    return newestPerMonth.get(name.slice(0, 7)) !== name;
  });
}

export class Backups {
  constructor(readonly dir: string) {}

  async list(): Promise<Snapshot[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    return names
      .map(parseSnapshotName)
      .filter((s): s is Snapshot => s !== null)
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  async hasSnapshotOn(day: string): Promise<boolean> {
    return (await this.list()).some((s) => s.name.startsWith(day));
  }

  async take(files: Record<string, string>, reason: string, now = new Date()): Promise<Snapshot> {
    await mkdir(this.dir, { recursive: true });
    const stamp = stampOf(now);
    let name = `${stamp}-${reason}`;
    for (let i = 2; await exists(path.join(this.dir, name)); i++) name = `${stamp}-${i}-${reason}`;
    const target = path.join(this.dir, name);
    await mkdir(target);
    for (const [file, text] of Object.entries(files)) {
      await writeFile(path.join(target, file), text);
    }
    await this.prune(now);
    return parseSnapshotName(name)!;
  }

  async read(name: string): Promise<Record<string, string>> {
    if (!parseSnapshotName(name)) throw new Error("No such backup");
    const dir = path.join(this.dir, name);
    const out: Record<string, string> = {};
    for (const file of await readdir(dir)) out[file] = await readFile(path.join(dir, file), "utf8");
    return out;
  }

  async prune(now = new Date()): Promise<void> {
    const names = (await this.list()).map((s) => s.name);
    for (const name of snapshotsToPrune(names, now)) {
      await rm(path.join(this.dir, name), { recursive: true, force: true });
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
