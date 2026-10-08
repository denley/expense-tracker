import { describe, expect, it } from "vitest";
import { parseWorkspace, emptyWorkspaceTexts, type WorkspaceData } from "../client/src/lib/files";
import * as ops from "./ops";
import type { WorkspaceChanges } from "./store";

function workspace(): WorkspaceData {
  const ws = parseWorkspace(emptyWorkspaceTexts());
  ws.nodes.push(
    { id: "groceries", parentId: null, name: "Groceries" },
    { id: "home", parentId: null, name: "Home" },
    { id: "utilities", parentId: "home", name: "Utilities" },
    { id: "trip", parentId: null, name: "Old Trip", archived: true }
  );
  return ws;
}

/** Apply an op's changes to a workspace, like the store does */
function commit(ws: WorkspaceData, out: { changes?: WorkspaceChanges }): WorkspaceData {
  return { ...ws, ...(out.changes ?? {}) };
}

const BANK = [
  '01/10/2026,-45.20,"WOOLWORTHS 1234 ADELAIDE SA",1000.00',
  '03/10/2026,-89.99,"ORIGIN ENERGY",897.51',
  '04/10/2026,2500.00,"SALARY ACME",3397.51',
].join("\n");

describe("importCsv", () => {
  it("detects a headerless bank export, applies rules, and skips duplicates on re-import", () => {
    let ws = workspace();
    ws = commit(ws, ops.addRule(ws, { pattern: "woolworths", category: "Groceries" }));
    const first = ops.importCsv(ws, { csv: BANK, account: "CBA" });
    expect(first.result).toMatchObject({
      imported: 3,
      categorisedByRules: 1,
      uncategorized: 2,
      settings: { dateFormat: "DMY", convention: "negativeIsExpense" },
    });
    expect(first.snapshot).toBe("pre-import");
    ws = commit(ws, first);
    const woolies = ws.transactions.find((t) => t.description.startsWith("WOOLWORTHS"))!;
    expect(woolies).toMatchObject({ amount: 45.2, categoryId: "groceries", account: "CBA", date: "2026-10-01" });
    expect(ws.transactions.find((t) => t.description === "SALARY ACME")!.amount).toBe(-2500);

    const again = ops.importCsv(ws, { csv: BANK, account: "CBA" });
    expect(again.result).toMatchObject({ imported: 0, duplicatesSkipped: 3 });
    expect(again.changes).toBeUndefined();
  });

  it("writes nothing on a dry run", () => {
    const out = ops.importCsv(workspace(), { csv: BANK, dryRun: true });
    expect(out.changes).toBeUndefined();
    expect(out.result.new).toBe(3);
    expect(out.result.warnings.join()).toMatch(/account/);
  });

  it("saves and later matches a bank profile", () => {
    let ws = workspace();
    ws = commit(ws, ops.importCsv(ws, { csv: BANK, account: "CBA", saveProfile: "CBA Everyday" }));
    expect(ws.importProfiles.map((p) => p.name)).toEqual(["CBA Everyday"]);
    const next = ops.importCsv(ws, { csv: '05/10/2026,-5.00,"NEW THING",1.00', dryRun: true });
    expect(next.result.settings).toMatchObject({ profile: "CBA Everyday", account: "CBA" });
  });
});

describe("categorize + undo", () => {
  it("reverts only rows still as the operation left them", () => {
    let ws = workspace();
    ws = commit(ws, ops.importCsv(ws, { csv: BANK, account: "CBA" }));
    const [a, b] = ws.transactions;
    const out = ops.categorize(ws, [
      { id: a.id, category: "Home > Utilities" },
      { id: b.id, category: "utilities" },
      { id: "nope", category: "Groceries" },
    ]);
    expect(out.result).toMatchObject({ updated: 2, notFound: ["nope"] });
    ws = commit(ws, out);
    // someone re-files b afterwards
    ws = { ...ws, transactions: ws.transactions.map((t) => (t.id === b.id ? { ...t, categoryId: "groceries" } : t)) };
    const undone = ops.undo(ws, out.undo!);
    expect(undone.result).toEqual({ reverted: 1, skipped: 1 });
    ws = commit(ws, undone);
    expect(ws.transactions.find((t) => t.id === a.id)!.categoryId).toBe("uncategorized");
    expect(ws.transactions.find((t) => t.id === b.id)!.categoryId).toBe("groceries");
  });

  it("refuses archived and unknown categories", () => {
    const ws = workspace();
    expect(() => ops.categorize(ws, [{ id: "x", category: "Old Trip" }])).toThrow(/archived/);
    expect(() => ops.categorize(ws, [{ id: "x", category: "Utilites" }])).toThrow(/Unknown category/);
  });
});

describe("addCategory", () => {
  it("creates missing levels and undo removes them while unused", () => {
    const ws = workspace();
    const out = ops.addCategory(ws, { path: "Travel > Japan 2027 > Food", oneOff: true });
    expect(out.result.path).toBe("Travel > Japan 2027 > Food");
    expect(out.result.created).toHaveLength(3);
    const after = commit(ws, out);
    const undone = commit(after, ops.undo(after, out.undo!));
    expect(undone.nodes).toHaveLength(ws.nodes.length);
  });
});

describe("addRule", () => {
  it("rejects bad regexes and exact duplicates", () => {
    let ws = workspace();
    expect(() => ops.addRule(ws, { pattern: "(", isRegex: true, category: "Groceries" })).toThrow(/regex/);
    ws = commit(ws, ops.addRule(ws, { pattern: "COLES", category: "Groceries" }));
    expect(() => ops.addRule(ws, { pattern: "coles", category: "Groceries" })).toThrow(/identical/);
  });
});
