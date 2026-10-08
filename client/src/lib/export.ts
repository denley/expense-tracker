/*
  Export / backup: CSV for spreadsheets + AI agents, JSON for full backups.
  transactions.csv references the category tree by CategoryId only — tree
  changes never rewrite it. The portable (download) export additionally
  resolves Group / Category Path columns for spreadsheet use.
*/
import Papa from "papaparse";
import type { StoredTransaction, CategoryNode, Rule, ImportProfile } from "./types";
import type { CategoryTree } from "./tree";
import { UNCATEGORIZED_ID } from "./tree";

export interface BackupFile {
  app: "expense-tracker";
  version: 3;
  exportedAt: string;
  transactions: StoredTransaction[];
  nodes: CategoryNode[];
  rules: Rule[];
  importProfiles: ImportProfile[];
}

const TXN_FIELDS = ["ID", "Date", "Description", "Amount", "CategoryId", "Account", "Notes", "OriginalAmount", "FxRate"];

export function transactionsToCsv(transactions: StoredTransaction[]): string {
  const rows = transactions.map((t) => [
    t.id,
    t.date,
    t.description,
    t.amount.toFixed(2),
    t.categoryId,
    t.account,
    t.notes,
    t.originalAmount !== undefined ? t.originalAmount.toFixed(2) : "",
    t.fxRate !== undefined ? String(t.fxRate) : "",
  ]);
  // Explicit fields so an empty list still produces the header row — a file
  // without it reads back as unparseable, not as "zero transactions".
  // Unix newlines: agents and scripts append with "\n"; mixed endings break parsing
  return Papa.unparse({ fields: TXN_FIELDS, data: rows }, { newline: "\n" });
}

/** Spreadsheet-friendly export: CategoryId plus resolved Group and Category Path columns */
export function transactionsToPortableCsv(
  transactions: StoredTransaction[],
  tree: CategoryTree
): string {
  const fields = ["ID", "Date", "Description", "Amount", "CategoryId", "Category", "Group", "Account", "Notes", "OriginalAmount", "FxRate"];
  const rows = transactions.map((t) => [
    t.id,
    t.date,
    t.description,
    t.amount.toFixed(2),
    t.categoryId,
    tree.pathOf(t.categoryId),
    tree.rootOf(t.categoryId)?.name ?? "",
    t.account,
    t.notes,
    t.originalAmount !== undefined ? t.originalAmount.toFixed(2) : "",
    t.fxRate !== undefined ? String(t.fxRate) : "",
  ]);
  return Papa.unparse({ fields, data: rows }, { newline: "\n" });
}

/** Parse transactions.csv (matched by ID column). Returns null if the header is invalid. */
export function csvToTransactions(text: string): StoredTransaction[] | null {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  const fields = result.meta.fields ?? [];
  if (!fields.includes("ID") || !fields.includes("Date") || !fields.includes("Amount")) {
    return null;
  }
  return result.data
    .filter((r) => r.ID && r.Date)
    .map((r) => {
      const originalAmount = parseFloat(r.OriginalAmount ?? "");
      const fxRate = parseFloat(r.FxRate ?? "");
      return {
        id: r.ID,
        date: r.Date,
        description: r.Description ?? "",
        amount: parseFloat(r.Amount) || 0,
        categoryId: r.CategoryId || UNCATEGORIZED_ID,
        account: r.Account ?? "",
        notes: r.Notes ?? "",
        ...(isNaN(originalAmount) ? {} : { originalAmount }),
        ...(isNaN(fxRate) ? {} : { fxRate }),
      };
    });
}

export function makeBackup(
  transactions: StoredTransaction[],
  nodes: CategoryNode[],
  rules: Rule[],
  importProfiles: ImportProfile[]
): BackupFile {
  return {
    app: "expense-tracker",
    version: 3,
    exportedAt: new Date().toISOString(),
    transactions,
    nodes,
    rules,
    importProfiles,
  };
}

/** Accepts v3 backups only (older backups predate the category tree rework) */
export function parseBackup(text: string): BackupFile | null {
  try {
    const data = JSON.parse(text);
    if (data?.app !== "expense-tracker" || data?.version !== 3) return null;
    if (!Array.isArray(data.transactions) || !Array.isArray(data.nodes)) return null;
    const transactions: StoredTransaction[] = data.transactions.map((t: any) => ({
      id: t.id,
      date: t.date,
      description: t.description ?? "",
      amount: t.amount ?? 0,
      categoryId: t.categoryId || UNCATEGORIZED_ID,
      account: t.account ?? "",
      notes: t.notes ?? "",
      ...(typeof t.originalAmount === "number" ? { originalAmount: t.originalAmount } : {}),
      ...(typeof t.fxRate === "number" ? { fxRate: t.fxRate } : {}),
    }));
    const nodes: CategoryNode[] = data.nodes
      .filter((n: any) => n?.id && n?.name)
      .map((n: any) => ({
        id: String(n.id),
        parentId: n.parentId ? String(n.parentId) : null,
        name: String(n.name),
        ...(n.oneOff ? { oneOff: true } : {}),
        ...(n.archived ? { archived: true } : {}),
        ...(n.color ? { color: String(n.color) } : {}),
        ...(typeof n.budget === "number" ? { budget: n.budget } : {}),
        ...(n.notes ? { notes: String(n.notes) } : {}),
        ...(n.createdAt ? { createdAt: String(n.createdAt) } : {}),
      }));
    const rules: Rule[] = Array.isArray(data.rules)
      ? data.rules
          .filter((r: any) => r.categoryId)
          .map((r: any) => ({
            id: r.id,
            pattern: r.pattern,
            isRegex: !!r.isRegex,
            categoryId: r.categoryId,
            enabled: !!r.enabled,
            createdAt: r.createdAt ?? "",
          }))
      : [];
    return {
      app: "expense-tracker",
      version: 3,
      exportedAt: data.exportedAt ?? "",
      transactions,
      nodes,
      rules,
      importProfiles: Array.isArray(data.importProfiles) ? data.importProfiles : [],
    };
  } catch {
    return null;
  }
}
