import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "./store";
import type { Actor } from "./activity";
import * as ops from "./ops";

const me: Actor = { login: "alex@example.com", name: "Alex", kind: "tailnet" };
const agent: Actor = { login: "local:Claude", name: "Claude", kind: "local" };

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "et-store-"));
  store = new Store(dir);
  await store.init();
});

afterEach(async () => {
  store.stopWatching();
  await rm(dir, { recursive: true, force: true });
});

const HEADER = "ID,Date,Description,Amount,CategoryId,Account,Notes,OriginalAmount,FxRate\n";

describe("Store", () => {
  it("creates a fresh data folder", async () => {
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(["transactions.csv", "categories.csv", "rules.csv", "import-profiles.json", "README.md"]));
  });

  it("writes against the current revision and reports conflicts", async () => {
    const rev = store.get("transactions.csv").rev;
    const text = HEADER + "t1,2026-10-01,COFFEE,4.50,uncategorized,,,,\n";
    const ok = await store.putFile("transactions.csv", text, rev, me);
    expect(ok.ok).toBe(true);
    expect(await readFile(path.join(dir, "transactions.csv"), "utf8")).toBe(text);
    const stale = await store.putFile("transactions.csv", HEADER, rev, me);
    expect(stale).toEqual({ ok: false, current: store.get("transactions.csv") });
    const entry = store.activity.list(1)[0];
    expect(entry).toMatchObject({ summary: "Added 1 transaction", actor: { name: "Alex" }, source: "app" });
  });

  it("refuses content that would read back as unreadable", async () => {
    await expect(store.putFile("transactions.csv", "no header", store.get("transactions.csv").rev, me)).rejects.toThrow(/header/);
  });

  it("takes the day's snapshot before the first change", async () => {
    expect(await store.backups.list()).toHaveLength(0);
    await store.putFile("transactions.csv", HEADER + "t1,2026-10-01,X,1,uncategorized,,,,\n", store.get("transactions.csv").rev, me);
    await store.putFile("transactions.csv", HEADER, store.get("transactions.csv").rev, me);
    const snaps = await store.backups.list();
    expect(snaps.map((s) => s.reason)).toEqual(["daily"]);
  });

  it("coalesces a burst of in-app edits into one activity entry", async () => {
    for (const n of [1, 2, 3]) {
      const rows = Array.from({ length: n }, (_, i) => `t${i},2026-10-01,X${i},1,uncategorized,,,,\n`).join("");
      await store.putFile("transactions.csv", HEADER + rows, store.get("transactions.csv").rev, me);
    }
    const entries = store.activity.list(10).filter((e) => e.source === "app");
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe("Added 3 transactions");
  });

  it("logs agent operations separately with undo", async () => {
    const { entry } = await store.apply((ws) => ops.addCategory(ws, { path: "Groceries" }), agent);
    expect(entry).toMatchObject({ canUndo: true, actor: { name: "Claude" }, source: "api" });
  });

  it("picks up a direct file edit, snapshots first, and registers unknown categories", async () => {
    const events: unknown[] = [];
    store.onChange((ev) => events.push(ev));
    const tmp = path.join(dir, "edit.tmp");
    await writeFile(tmp, HEADER + "m1,2026-10-07,BUNNINGS,55.00,hardware,Cash,,,\n");
    await rename(tmp, path.join(dir, "transactions.csv"));
    await store.exclusive(() => store.checkExternal());
    expect(store.workspace().transactions.map((t) => t.id)).toEqual(["m1"]);
    expect(store.workspace().nodes.some((n) => n.id === "hardware")).toBe(true);
    expect((await store.backups.list()).map((s) => s.reason)).toContain("pre-file-edit");
    const [system, external] = store.activity.list(2);
    expect(external).toMatchObject({ source: "external", summary: "Added 1 transaction" });
    expect(system).toMatchObject({ source: "system", summary: "Added 1 category" });
    expect(events).toHaveLength(2);
  });

  it("restores a snapshot after snapshotting the current state", async () => {
    await store.putFile("transactions.csv", HEADER + "t1,2026-10-01,X,1,uncategorized,,,,\n", store.get("transactions.csv").rev, me);
    const [daily] = await store.backups.list();
    await store.restore(daily.name, me);
    expect(store.workspace().transactions).toHaveLength(0);
    expect((await store.backups.list()).map((s) => s.reason)).toContain("pre-restore");
  });
});
