/*
  Export / backup: CSV for spreadsheets + AI agents, JSON for full backups.
  The CSV export round-trips through re-import (rows matched by ID), and the
  JSON backup restores everything including the category tree, projects,
  rules and import profiles.
*/
import Papa from "papaparse";
import type { StoredTransaction, CategoryDef, Project, Rule, ImportProfile } from "./types";

export interface BackupFile {
  app: "expense-tracker";
  version: 2;
  exportedAt: string;
  transactions: StoredTransaction[];
  categories: CategoryDef[];
  projects: Project[];
  rules: Rule[];
  importProfiles: ImportProfile[];
}

const TXN_FIELDS = ["ID", "Date", "Description", "Amount", "Category", "Group", "Account", "Notes", "OriginalAmount", "FxRate"];

export function transactionsToCsv(transactions: StoredTransaction[]): string {
  const rows = transactions.map((t) => [
    t.id,
    t.date,
    t.description,
    t.amount.toFixed(2),
    t.category,
    t.group,
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

/** Parse a CSV previously exported by transactionsToCsv (matched by ID column) */
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
        category: r.Category || "Uncategorized",
        group: r.Group || "Other",
        account: r.Account ?? "",
        notes: r.Notes ?? "",
        ...(isNaN(originalAmount) ? {} : { originalAmount }),
        ...(isNaN(fxRate) ? {} : { fxRate }),
      };
    });
}

export function makeBackup(
  transactions: StoredTransaction[],
  categories: CategoryDef[],
  projects: Project[],
  rules: Rule[],
  importProfiles: ImportProfile[]
): BackupFile {
  return {
    app: "expense-tracker",
    version: 2,
    exportedAt: new Date().toISOString(),
    transactions,
    categories,
    projects,
    rules,
    importProfiles,
  };
}

/** Accepts v1 (tag-based projects) and v2 backups; v1 data is migrated on the fly */
export function parseBackup(text: string): BackupFile | null {
  try {
    const data = JSON.parse(text);
    if (data?.app !== "expense-tracker" || !Array.isArray(data.transactions)) return null;
    const transactions: StoredTransaction[] = data.transactions.map((t: any) => ({
      id: t.id,
      date: t.date,
      description: t.description ?? "",
      amount: t.amount ?? 0,
      category: t.category || "Uncategorized",
      group: t.group || "Other",
      account: t.account ?? "",
      notes: t.notes ?? "",
      ...(typeof t.originalAmount === "number" ? { originalAmount: t.originalAmount } : {}),
      ...(typeof t.fxRate === "number" ? { fxRate: t.fxRate } : {}),
    }));
    const projects: Project[] = Array.isArray(data.projects)
      ? data.projects.map((p: any) => {
          const { tag: _tag, ...rest } = p;
          return rest as Project;
        })
      : [];
    const rules: Rule[] = Array.isArray(data.rules)
      ? data.rules
          .filter((r: any) => r.category)
          .map((r: any) => ({
            id: r.id,
            pattern: r.pattern,
            isRegex: !!r.isRegex,
            category: r.category,
            enabled: !!r.enabled,
            createdAt: r.createdAt ?? "",
          }))
      : [];
    return {
      app: "expense-tracker",
      version: 2,
      exportedAt: data.exportedAt ?? "",
      transactions,
      categories: Array.isArray(data.categories) ? data.categories : [],
      projects,
      rules,
      importProfiles: Array.isArray(data.importProfiles) ? data.importProfiles : [],
    };
  } catch {
    return null;
  }
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
