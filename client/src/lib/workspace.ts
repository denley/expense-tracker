/*
  File-workspace persistence via the File System Access API.
  The user points the app at a folder; that folder's CSV files are the
  source of truth:
    transactions.csv       ID,Date,Description,Amount,Category,Group,Account,Notes
    categories.csv         Category,Group           (the strict tree)
    projects.csv           Name,Color,Status,Budget,StartDate,EndDate,Notes,CreatedAt
    rules.csv              Pattern,IsRegex,Category,Enabled,CreatedAt
    import-profiles.json   app-managed bank column mappings
  The app writes files immediately on every mutation and re-reads any file
  whose mtime changed externally (AI agents / Excel edit them directly).
*/
import Papa from "papaparse";
import type {
  StoredTransaction,
  CategoryDef,
  Project,
  Rule,
  ImportProfile,
} from "./types";
import { csvToTransactions } from "./export";
import { dbGet, dbSet, dbDel, uid } from "./db";

export const WS_HANDLE_KEY = "workspaceHandle";

export const WS_FILES = {
  transactions: "transactions.csv",
  categories: "categories.csv",
  projects: "projects.csv",
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

export function categoriesToCsv(defs: CategoryDef[]): string {
  const rows = [...defs]
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
    .map((d) => ({ Category: d.name, Group: d.group }));
  return (
    Papa.unparse(
      { fields: ["Category", "Group"], data: rows.map((r) => [r.Category, r.Group]) },
      { newline: "\n" }
    ) + "\n"
  );
}

export function csvToCategories(text: string): CategoryDef[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  return result.data
    .filter((r) => r.Category)
    .map((r) => ({ name: r.Category, group: r.Group || "Other" }));
}

export function projectsToCsv(projects: Project[]): string {
  const rows = projects.map((p) => ({
    Name: p.name,
    Color: p.color,
    Status: p.status,
    Budget: p.budget != null ? String(p.budget) : "",
    Notes: p.notes ?? "",
    CreatedAt: p.createdAt,
  }));
  return (
    Papa.unparse(
      {
        fields: ["Name", "Color", "Status", "Budget", "Notes", "CreatedAt"],
        data: rows.map((r) => [r.Name, r.Color, r.Status, r.Budget, r.Notes, r.CreatedAt]),
      },
      { newline: "\n" }
    ) + "\n"
  );
}

export function csvToProjects(text: string): Project[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  return result.data
    .filter((r) => r.Name)
    .map((r) => ({
      id: uid(),
      name: r.Name,
      color: r.Color || "#c17c5e",
      status: r.Status === "archived" ? "archived" as const : "active" as const,
      budget: r.Budget ? parseFloat(r.Budget) || undefined : undefined,
      notes: r.Notes || undefined,
      createdAt: r.CreatedAt || new Date().toISOString(),
    }));
}

export function rulesToCsv(rules: Rule[]): string {
  const rows = rules.map((r) => ({
    Pattern: r.pattern,
    IsRegex: r.isRegex ? "true" : "false",
    Category: r.category,
    Enabled: r.enabled ? "true" : "false",
    CreatedAt: r.createdAt,
  }));
  return (
    Papa.unparse(
      {
        fields: ["Pattern", "IsRegex", "Category", "Enabled", "CreatedAt"],
        data: rows.map((r) => [r.Pattern, r.IsRegex, r.Category, r.Enabled, r.CreatedAt]),
      },
      { newline: "\n" }
    ) + "\n"
  );
}

export function csvToRules(text: string): Rule[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  return result.data
    .filter((r) => r.Pattern && r.Category)
    .map((r) => ({
      id: uid(),
      pattern: r.Pattern,
      isRegex: r.IsRegex === "true",
      category: r.Category,
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
  categories: CategoryDef[];
  projects: Project[];
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
  const projFile = await readFileIfExists(dir, WS_FILES.projects);
  const ruleFile = await readFileIfExists(dir, WS_FILES.rules);
  const profFile = await readFileIfExists(dir, WS_FILES.profiles);

  if (txnFile) mtimes[WS_FILES.transactions] = txnFile.mtime;
  if (catFile) mtimes[WS_FILES.categories] = catFile.mtime;
  if (projFile) mtimes[WS_FILES.projects] = projFile.mtime;
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
      categories: catFile ? csvToCategories(catFile.text) : [],
      projects: projFile ? csvToProjects(projFile.text) : [],
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

### transactions.csv — every transaction
\`\`\`
ID,Date,Description,Amount,Category,Group,Account,Notes,OriginalAmount,FxRate
\`\`\`
- \`ID\` — stable unique row id. **Never change it**; the app uses it to track rows. For new rows, use any unique string.
- \`Date\` — ISO \`yyyy-mm-dd\`
- \`Amount\` — plain number, 2 decimals, **always AUD**. **Positive = expense, negative = income/refund.**
- \`Category\` — the fine-grained label. \`Uncategorized\` marks rows needing triage.
- \`Group\` — the pie-chart bucket. Informational for known categories (categories.csv is authoritative); for a category not yet in categories.csv, this value places it in the tree.
- \`Account\` — optional source account label (e.g. "ANZ Visa")
- \`Notes\` — optional free text
- \`OriginalAmount\`, \`FxRate\` — only set for foreign-currency imports: the source-currency
  amount and the rate used, so \`Amount ≈ OriginalAmount × FxRate\` (audit trail; both blank
  for native-AUD rows). Duplicate detection matches on \`OriginalAmount\` when present.

### categories.csv — the category tree
\`\`\`
Category,Group
\`\`\`
Every category belongs to exactly **one** group. This file is authoritative:
the app rewrites each transaction's Group to match it.

### projects.csv — one-off cost centres (a trip, a renovation…)
\`\`\`
Name,Color,Status,Budget,Notes,CreatedAt
\`\`\`
A project **is a group**: \`Name\` must match a Group value, and the project's
categories are the rows in categories.csv with that Group. \`Status\` is
\`active\` or \`archived\`. Archived projects keep all history but are retired:
**do not categorise new spending into an archived project's categories.**

### rules.csv — auto-categorisation rules
\`\`\`
Pattern,IsRegex,Category,Enabled,CreatedAt
\`\`\`
"Description contains Pattern (case-insensitive; regex if IsRegex) → assign
Category." First matching rule wins.

### import-profiles.json — saved bank CSV column mappings (app-managed)
`;

/** Write README.md into the workspace if it doesn't exist yet */
export async function ensureWorkspaceReadme(dir: FileSystemDirectoryHandle): Promise<void> {
  try {
    await dir.getFileHandle("README.md");
  } catch {
    await writeWorkspaceFile(dir, "README.md", WORKSPACE_README);
  }
}
