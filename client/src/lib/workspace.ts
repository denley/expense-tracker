/*
  File-workspace persistence via the File System Access API.
  The user points the app at a folder; that folder's CSV files are the
  source of truth:
    transactions.csv       ID,Date,Description,Amount,CategoryId,Account,Notes,OriginalAmount,FxRate
    categories.csv         Id,ParentId,Name,Path,OneOff,Archived,Color,Budget,Notes,CreatedAt
    rules.csv              Pattern,IsRegex,CategoryId,Enabled,CreatedAt
    import-profiles.json   app-managed bank column mappings
  The category tree is an adjacency list (Id/ParentId); Path is a derived
  convenience column the app rewrites — structure lives in ParentId only, so
  tree edits never touch transactions.csv.
  The app writes files immediately on every mutation and re-reads any file
  whose mtime changed externally (AI agents / Excel edit them directly).
*/
import Papa from "papaparse";
import type { StoredTransaction, CategoryNode, Rule, ImportProfile } from "./types";
import { buildTree } from "./tree";
import { csvToTransactions } from "./export";
import { dbGet, dbSet, dbDel, uid } from "./db";

export const WS_HANDLE_KEY = "workspaceHandle";

export const WS_FILES = {
  transactions: "transactions.csv",
  categories: "categories.csv",
  rules: "rules.csv",
  profiles: "import-profiles.json",
} as const;

export type WsFileKey = keyof typeof WS_FILES;

export function supportsFileSystem(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickWorkspaceFolder(): Promise<FileSystemDirectoryHandle> {
  return (window as unknown as {
    showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker({ mode: "readwrite" });
}

export async function saveWorkspaceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await dbSet(WS_HANDLE_KEY, handle);
}

export async function loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return dbGet<FileSystemDirectoryHandle>(WS_HANDLE_KEY);
}

export async function clearWorkspaceHandle(): Promise<void> {
  await dbDel(WS_HANDLE_KEY);
}

type PermState = "granted" | "prompt" | "denied";

/** OPFS handles have no permission methods — treat them as always granted */
export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  const h = handle as unknown as { queryPermission?: (o: { mode: string }) => Promise<PermState> };
  if (typeof h.queryPermission !== "function") return "granted";
  return h.queryPermission({ mode: "readwrite" });
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  const h = handle as unknown as { requestPermission?: (o: { mode: string }) => Promise<PermState> };
  if (typeof h.requestPermission !== "function") return "granted";
  return h.requestPermission({ mode: "readwrite" });
}

/* ---------- Per-table serialization ---------- */

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

export function csvToRules(text: string): Rule[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  return result.data
    .filter((r) => r.Pattern && r.CategoryId)
    .map((r) => ({
      id: uid(),
      pattern: r.Pattern,
      isRegex: r.IsRegex === "true",
      categoryId: r.CategoryId,
      enabled: r.Enabled !== "false",
      createdAt: r.CreatedAt || new Date().toISOString(),
    }));
}

/* ---------- File IO ---------- */

/**
 * Returns null ONLY when the file genuinely doesn't exist. Any other failure
 * (transient lock, permission hiccup) rethrows — callers must never mistake
 * "couldn't read right now" for "empty folder", or they'd re-initialize over
 * real data.
 */
async function readFileIfExists(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<{ text: string; mtime: number } | null> {
  try {
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return { text: await f.text(), mtime: f.lastModified };
  } catch (e) {
    if ((e as DOMException)?.name === "NotFoundError") return null;
    throw e;
  }
}

/** Write a file only if it doesn't exist yet. Returns its mtime either way. */
export async function writeWorkspaceFileIfAbsent(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string
): Promise<number> {
  try {
    const fh = await dir.getFileHandle(name);
    return (await fh.getFile()).lastModified;
  } catch (e) {
    if ((e as DOMException)?.name !== "NotFoundError") throw e;
    return writeWorkspaceFile(dir, name, content);
  }
}

export async function writeWorkspaceFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string
): Promise<number> {
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
  const f = await fh.getFile();
  return f.lastModified;
}

export async function getWorkspaceFileMtime(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<number | null> {
  try {
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return f.lastModified;
  } catch {
    return null;
  }
}

export interface WorkspaceData {
  transactions: StoredTransaction[];
  nodes: CategoryNode[];
  rules: Rule[];
  importProfiles: ImportProfile[];
  hasTransactionsFile: boolean;
  /**
   * transactions.csv exists but couldn't be parsed (missing/invalid header).
   * The app must NOT proceed as if there were zero transactions — a later
   * write would replace the file's real contents with emptiness.
   */
  transactionsUnreadable: boolean;
}

export async function readWorkspace(
  dir: FileSystemDirectoryHandle
): Promise<{ data: WorkspaceData; mtimes: Record<string, number> }> {
  const mtimes: Record<string, number> = {};

  const txnFile = await readFileIfExists(dir, WS_FILES.transactions);
  const catFile = await readFileIfExists(dir, WS_FILES.categories);
  const ruleFile = await readFileIfExists(dir, WS_FILES.rules);
  const profFile = await readFileIfExists(dir, WS_FILES.profiles);

  if (txnFile) mtimes[WS_FILES.transactions] = txnFile.mtime;
  if (catFile) mtimes[WS_FILES.categories] = catFile.mtime;
  if (ruleFile) mtimes[WS_FILES.rules] = ruleFile.mtime;
  if (profFile) mtimes[WS_FILES.profiles] = profFile.mtime;

  let importProfiles: ImportProfile[] = [];
  if (profFile) {
    try {
      const parsed = JSON.parse(profFile.text);
      if (Array.isArray(parsed)) importProfiles = parsed;
    } catch {
      // ignore malformed profiles file
    }
  }

  const parsedTxns = txnFile ? csvToTransactions(txnFile.text) : [];

  return {
    data: {
      transactions: parsedTxns ?? [],
      nodes: catFile ? csvToNodes(catFile.text) : [],
      rules: ruleFile ? csvToRules(ruleFile.text) : [],
      importProfiles,
      hasTransactionsFile: !!txnFile,
      transactionsUnreadable: !!txnFile && parsedTxns === null,
    },
    mtimes,
  };
}

const WORKSPACE_README = `# Expense Tracker Data Workspace

This folder is the **source of truth** for the household expense tracker app.
The app reads and writes these files directly; you (or an AI agent, or Excel)
can edit them too — the app picks up external changes when its tab regains focus.

**Don't edit files while actively clicking around in the app** — writes are
last-one-wins. Finish edits, then refocus the app tab (or press "Reload from
disk" on its Data page).

## Files

### categories.csv — the category tree
\`\`\`
Id,ParentId,Name,Path,OneOff,Archived,Color,Budget,Notes,CreatedAt
\`\`\`
One row per node; arbitrary nesting via \`ParentId\` (empty = top-level).
Transactions may be filed on **any** node, not just leaves — reports roll
descendants up into ancestors.
- \`Id\` — stable readable slug (e.g. \`travel-mex26\`). **Never change it**;
  transactions and rules reference it. For new nodes, any unique slug.
- \`ParentId\` — the parent node's Id, empty for a top-level node (a chart bucket).
- \`Name\` — display name; unique among siblings only. Must not contain \`>\`.
- \`Path\` — **derived** (e.g. \`Travel > Mexico 2026 > Flights\`). The app
  rewrites it from ParentId/Name; feel free to leave it blank when adding rows.
  Structure lives in ParentId — editing Path alone changes nothing.
- \`OneOff\` — \`true\` marks a one-off cost centre ("project": a trip, a
  renovation…). Its subtree clusters at the end of pickers and can be excluded
  from trend charts.
- \`Archived\` — \`true\` retires the node's whole subtree: hidden from pickers
  and suggestions, its rules disabled, all history kept. **Do not categorise
  new spending into an archived subtree.**
- \`Color\` — chart color (used for top-level and one-off nodes), \`Budget\`,
  \`Notes\`, \`CreatedAt\` — optional metadata.
The top-level node \`uncategorized\` ("Uncategorized") is special: rows needing
triage are filed there, and the app re-creates it if it's missing.

### transactions.csv — every transaction
\`\`\`
ID,Date,Description,Amount,CategoryId,Account,Notes,OriginalAmount,FxRate
\`\`\`
- \`ID\` — stable unique row id. **Never change it**. For new rows, use any unique string.
- \`Date\` — ISO \`yyyy-mm-dd\`
- \`Amount\` — plain number, 2 decimals, **always AUD**. **Positive = expense, negative = income/refund.**
- \`CategoryId\` — the Id of a categories.csv node (any level). Use
  \`uncategorized\` for rows needing triage. To categorise into a new category,
  first add its row to categories.csv, then reference its Id here. An unknown
  CategoryId is auto-registered as a top-level node named after the id — fix it
  in categories.csv if that happens.
- \`Account\` — optional source account label (e.g. "ANZ Visa")
- \`Notes\` — optional free text
- \`OriginalAmount\`, \`FxRate\` — only set for foreign-currency imports: the source-currency
  amount and the rate used, so \`Amount ≈ OriginalAmount × FxRate\` (audit trail; both blank
  for native-AUD rows). Duplicate detection matches on \`OriginalAmount\` when present.

### rules.csv — auto-categorisation rules
\`\`\`
Pattern,IsRegex,CategoryId,Enabled,CreatedAt
\`\`\`
"Description contains Pattern (case-insensitive; regex if IsRegex) → assign
the node CategoryId." First matching rule wins.

### import-profiles.json — saved bank CSV column mappings (app-managed)
`;

/** Write README.md into the workspace, replacing any older schema description */
export async function ensureWorkspaceReadme(dir: FileSystemDirectoryHandle): Promise<void> {
  const existing = await readFileIfExists(dir, "README.md").catch(() => null);
  if (!existing || !existing.text.includes("CategoryId")) {
    await writeWorkspaceFile(dir, "README.md", WORKSPACE_README);
  }
}
