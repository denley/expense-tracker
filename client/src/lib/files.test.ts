import { describe, expect, it } from "vitest";
import { csvToRules, rulesToCsv, validateFile, emptyWorkspaceTexts, parseWorkspace, WS_FILES } from "./files";

describe("rules.csv ids", () => {
  const text =
    "Pattern,IsRegex,CategoryId,Enabled,CreatedAt\n" +
    "WOOLWORTHS,false,groceries,true,2026-01-01T00:00:00.000Z\n" +
    "COLES,false,groceries,true,2026-01-02T00:00:00.000Z\n" +
    "ALDI,false,groceries,true,\n";

  it("are stable across re-reads", () => {
    expect(csvToRules(text).map((r) => r.id)).toEqual(csvToRules(text).map((r) => r.id));
  });

  it("survive an edit to the rule (keyed on CreatedAt)", () => {
    const rules = csvToRules(text);
    const edited = rules.map((r, i) => (i === 0 ? { ...r, pattern: "WOOLIES", enabled: false } : r));
    expect(csvToRules(rulesToCsv(edited))[0].id).toBe(rules[0].id);
  });

  it("stay unique for identical rows", () => {
    const dup = text + "ALDI,false,groceries,true,\n";
    const ids = csvToRules(dup).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keep a blank CreatedAt blank", () => {
    expect(csvToRules(rulesToCsv(csvToRules(text)))[2].createdAt).toBe("");
  });
});

describe("validateFile", () => {
  it("rejects a transactions.csv without its header", () => {
    expect(validateFile(WS_FILES.transactions, "t1,2026-01-01,X,1,groceries,,,,")).toMatch(/header/);
  });
  it("accepts the empty workspace", () => {
    for (const [name, text] of Object.entries(emptyWorkspaceTexts())) {
      expect(validateFile(name as never, text)).toBeNull();
    }
  });
  it("rejects a profiles file that isn't an array", () => {
    expect(validateFile(WS_FILES.profiles, "{}")).toMatch(/array/);
  });
});

describe("parseWorkspace", () => {
  it("flags an unreadable transactions.csv instead of reading it as empty", () => {
    const ws = parseWorkspace({ ...emptyWorkspaceTexts(), [WS_FILES.transactions]: "garbage" });
    expect(ws.transactionsUnreadable).toBe(true);
  });
});
