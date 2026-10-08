/*
  The data files and their (de)serialization. Shared by the app and the
  server, so it must stay free of DOM and Node APIs.

    transactions.csv       ID,Date,Description,Amount,CategoryId,Account,Notes,OriginalAmount,FxRate
    categories.csv         Id,ParentId,Name,Path,OneOff,Archived,Color,Budget,Notes,CreatedAt
    rules.csv              Pattern,IsRegex,CategoryId,Enabled,CreatedAt
    import-profiles.json   app-managed bank column mappings

  The category tree is an adjacency list (Id/ParentId); Path is a derived
  convenience column rewritten on every save — structure lives in ParentId
  only, so tree edits never touch transactions.csv.
*/
import Papa from "papaparse";
import type { StoredTransaction, CategoryNode, Rule, ImportProfile } from "./types";
import { buildTree, makeUncategorizedNode, UNCATEGORIZED_ID } from "./tree";
import { csvToTransactions, transactionsToCsv } from "./export";

export const WS_FILES = {
  transactions: "transactions.csv",
  categories: "categories.csv",
  rules: "rules.csv",
  profiles: "import-profiles.json",
} as const;

export type WsFileKey = keyof typeof WS_FILES;
export type WsFileName = (typeof WS_FILES)[WsFileKey];
export const WS_FILE_NAMES = Object.values(WS_FILES) as WsFileName[];

export function isWsFileName(name: string): name is WsFileName {
  return (WS_FILE_NAMES as string[]).includes(name);
}

/* ---------- Per-file serialization ---------- */

/** transactions.csv, sorted by date then id so diffs stay small */
export function serializeTxns(txns: StoredTransaction[]): string {
  const sorted = [...txns].sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id))
  );
  return transactionsToCsv(sorted) + "\n";
}

const NODE_FIELDS = ["Id", "ParentId", "Name", "Path", "OneOff", "Archived", "Color", "Budget", "Notes", "CreatedAt"];

/**
 * Serialize the tree depth-first (reads like an indented outline) with the
 * derived Path column filled in for humans and spreadsheet clients.
 */
export function nodesToCsv(nodes: CategoryNode[]): string {
  const tree = buildTree(nodes);
  const rows = tree.nodes.map((n) => [
    n.id,
    n.parentId ?? "",
    n.name,
    tree.pathOf(n.id),
    n.oneOff ? "true" : "",
    n.archived ? "true" : "",
    n.color ?? "",
    n.budget != null ? String(n.budget) : "",
    n.notes ?? "",
    n.createdAt ?? "",
  ]);
  return Papa.unparse({ fields: NODE_FIELDS, data: rows }, { newline: "\n" }) + "\n";
}

export function csvToNodes(text: string): CategoryNode[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  return result.data
    .filter((r) => r.Id && r.Name)
    .map((r) => ({
      id: r.Id,
      parentId: r.ParentId ? r.ParentId : null,
      name: r.Name,
      ...(r.OneOff === "true" ? { oneOff: true } : {}),
      ...(r.Archived === "true" ? { archived: true } : {}),
      ...(r.Color ? { color: r.Color } : {}),
      ...(r.Budget && !isNaN(parseFloat(r.Budget)) ? { budget: parseFloat(r.Budget) } : {}),
      ...(r.Notes ? { notes: r.Notes } : {}),
      ...(r.CreatedAt ? { createdAt: r.CreatedAt } : {}),
    }));
}

export function rulesToCsv(rules: Rule[]): string {
  const rows = rules.map((r) => [
    r.pattern,
    r.isRegex ? "true" : "false",
    r.categoryId,
    r.enabled ? "true" : "false",
    r.createdAt,
  ]);
  return (
    Papa.unparse(
      { fields: ["Pattern", "IsRegex", "CategoryId", "Enabled", "CreatedAt"], data: rows },
      { newline: "\n" }
    ) + "\n"
  );
}

/** FNV-1a, base36 — short stable ids, not security */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * rules.csv has no id column, so ids are derived from CreatedAt (which edits
 * never change), falling back to the pattern for hand-added rows without one.
 * Stable ids let a queued edit ("disable rule X") still find its rule after
 * the file is re-read.
 */
export function csvToRules(text: string): Rule[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const seen = new Map<string, number>();
  return result.data
    .filter((r) => r.Pattern && r.CategoryId)
    .map((r) => {
      const base = "r" + hash(r.CreatedAt || `${r.Pattern}|${r.CategoryId}`);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return {
        id: n === 0 ? base : `${base}-${n}`,
        pattern: r.Pattern,
        isRegex: r.IsRegex === "true",
        categoryId: r.CategoryId,
        enabled: r.Enabled !== "false",
        createdAt: r.CreatedAt ?? "",
      };
    });
}

export function profilesToJson(profiles: ImportProfile[]): string {
  return JSON.stringify(profiles, null, 2) + "\n";
}

export function jsonToProfiles(text: string): ImportProfile[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------- Whole workspace ---------- */

export interface WorkspaceData {
  transactions: StoredTransaction[];
  nodes: CategoryNode[];
  rules: Rule[];
  importProfiles: ImportProfile[];
  /**
   * transactions.csv exists but couldn't be parsed (missing/invalid header).
   * Nothing may proceed as if there were zero transactions — a later write
   * would replace the file's real contents with emptiness.
   */
  transactionsUnreadable: boolean;
}

export type WorkspaceTexts = Partial<Record<WsFileName, string>>;

export function parseWorkspace(texts: WorkspaceTexts): WorkspaceData {
  const txnText = texts[WS_FILES.transactions];
  const parsedTxns = txnText !== undefined ? csvToTransactions(txnText) : [];
  return {
    transactions: parsedTxns ?? [],
    nodes: texts[WS_FILES.categories] ? csvToNodes(texts[WS_FILES.categories]!) : [],
    rules: texts[WS_FILES.rules] ? csvToRules(texts[WS_FILES.rules]!) : [],
    importProfiles: texts[WS_FILES.profiles] ? jsonToProfiles(texts[WS_FILES.profiles]!) : [],
    transactionsUnreadable: parsedTxns === null,
  };
}

export function serializeWorkspace(data: {
  transactions: StoredTransaction[];
  nodes: CategoryNode[];
  rules: Rule[];
  importProfiles: ImportProfile[];
}): Record<WsFileName, string> {
  return {
    [WS_FILES.transactions]: serializeTxns(data.transactions),
    [WS_FILES.categories]: nodesToCsv(data.nodes),
    [WS_FILES.rules]: rulesToCsv(data.rules),
    [WS_FILES.profiles]: profilesToJson(data.importProfiles),
  } as Record<WsFileName, string>;
}

/** The contents of a brand-new data folder */
export function emptyWorkspaceTexts(): Record<WsFileName, string> {
  return serializeWorkspace({
    transactions: [],
    nodes: [makeUncategorizedNode()],
    rules: [],
    importProfiles: [],
  });
}

/**
 * Ensure loaded data is coherent: the Uncategorized root exists and every
 * transaction's categoryId points at a real node. Unknown ids (e.g. an agent
 * referenced a node it forgot to add) are auto-registered as root nodes named
 * after the id so no data is lost — visible and fixable in the app.
 */
export function normalizeLoaded(
  txns: StoredTransaction[],
  nodes: CategoryNode[]
): { txns: StoredTransaction[]; nodes: CategoryNode[]; txnsChanged: boolean; nodesChanged: boolean } {
  const nextNodes = [...nodes];
  let nodesChanged = false;
  if (!nextNodes.some((n) => n.id === UNCATEGORIZED_ID)) {
    nextNodes.push(makeUncategorizedNode());
    nodesChanged = true;
  }
  const known = new Set(nextNodes.map((n) => n.id));
  let txnsChanged = false;
  const nextTxns = txns.map((t) => {
    const cat = t.categoryId || UNCATEGORIZED_ID;
    if (!known.has(cat)) {
      nextNodes.push({ id: cat, parentId: null, name: cat });
      known.add(cat);
      nodesChanged = true;
    }
    if (t.categoryId !== cat) {
      txnsChanged = true;
      return { ...t, categoryId: cat };
    }
    return t;
  });
  return { txns: nextTxns, nodes: nextNodes, txnsChanged, nodesChanged };
}

/**
 * Reject content that would read back as something other than what the
 * writer meant (most importantly a transactions.csv without its header,
 * which parses as unreadable rather than as zero rows). Returns an error
 * message, or null when the content is fine.
 */
export function validateFile(name: WsFileName, text: string): string | null {
  const header = (fields: string[]) => {
    const got = Papa.parse<Record<string, string>>(text.trim(), { header: true, preview: 1 }).meta.fields ?? [];
    const missing = fields.filter((f) => !got.includes(f));
    return missing.length ? `${name}: missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}` : null;
  };
  switch (name) {
    case WS_FILES.transactions:
      return csvToTransactions(text) === null ? `${name}: missing or invalid header row (needs ID, Date, Amount)` : null;
    case WS_FILES.categories:
      return header(["Id", "ParentId", "Name"]);
    case WS_FILES.rules:
      return header(["Pattern", "CategoryId"]);
    case WS_FILES.profiles:
      try {
        return Array.isArray(JSON.parse(text)) ? null : `${name}: must be a JSON array`;
      } catch {
        return `${name}: not valid JSON`;
      }
  }
}
