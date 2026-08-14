/*
  CSV parsing and import intelligence:
  - header + column auto-detection for arbitrary bank exports
  - date format detection (DMY / MDY / YMD)
  - amount sign conventions (banks export spending as negative; this app stores expenses positive)
  - dedup keys so re-importing the same file is safe
*/
import Papa from "papaparse";
import type {
  StoredTransaction,
  ColumnMapping,
  DateFormat,
  AmountConvention,
} from "./types";
import { UNCATEGORIZED_ID } from "./tree";
import { uid } from "./db";

export interface ParsedCsv {
  rows: string[][];
  hasHeader: boolean;
  header: string[];
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  const text = await file.text();
  return parseCsvText(text);
}

export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.trim(), {
    skipEmptyLines: true,
  });
  const rows = (result.data as string[][]).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const hasHeader = rows.length > 0 && detectHeader(rows[0]);
  return {
    rows: hasHeader ? rows.slice(1) : rows,
    hasHeader,
    header: hasHeader ? rows[0] : rows[0]?.map((_, i) => `Column ${i + 1}`) ?? [],
  };
}

/** A row is a header if no cell parses as a date or a money amount */
function detectHeader(row: string[]): boolean {
  return !row.some((cell) => looksLikeDate(cell) || looksLikeAmount(cell));
}

const DATE_RE = /^\s*(\d{1,4})[\/\-.](\d{1,2}|[A-Za-z]{3,})[\/\-.](\d{1,4})\s*$/;

function looksLikeDate(s: string): boolean {
  return DATE_RE.test(s) || !isNaN(Date.parse(s)) && /\d{4}/.test(s) && /[\/\-]/.test(s);
}

function looksLikeAmount(s: string): boolean {
  return /^\s*-?\$?-?[\d,]+\.?\d*\s*$/.test(s) && /\d/.test(s);
}

/** Guess the column mapping from headers + data samples */
export function detectMapping(header: string[], rows: string[][]): ColumnMapping {
  const h = header.map((x) => x.toLowerCase().trim());
  const find = (...names: string[]) =>
    h.findIndex((col) => names.some((n) => col === n || col.includes(n)));

  let date = find("date", "transaction date", "posted");
  let description = find("description", "narrative", "details", "merchant", "payee", "transaction details");
  let amount = find("amount", "debit", "value");
  const credit = find("credit");
  const categoryId = find("categoryid");
  const category = h.findIndex((col) => col !== "categoryid" && (col === "category" || col.includes("category")));
  const account = find("account", "bank");
  const notes = find("notes", "memo", "comment");

  // Fall back to data-shape detection when headers don't help
  const sample = rows.slice(0, 20);
  if (date === -1) {
    date = firstColWhere(sample, looksLikeDate);
  }
  if (amount === -1) {
    amount = firstColWhere(sample, (c) => looksLikeAmount(c) && !looksLikeDate(c), date);
  }
  if (description === -1) {
    // longest average text column that isn't date/amount
    let best = -1;
    let bestLen = 0;
    const width = Math.max(...sample.map((r) => r.length), 0);
    for (let i = 0; i < width; i++) {
      if (i === date || i === amount) continue;
      const avg =
        sample.reduce((s, r) => s + (r[i]?.length || 0), 0) / Math.max(sample.length, 1);
      const isTexty = sample.some((r) => r[i] && !looksLikeAmount(r[i]) && !looksLikeDate(r[i]));
      if (isTexty && avg > bestLen) {
        bestLen = avg;
        best = i;
      }
    }
    description = best;
  }

  return {
    date: date === -1 ? 0 : date,
    description: description === -1 ? 1 : description,
    amount: amount === -1 ? 2 : amount,
    credit: credit === -1 ? undefined : credit,
    category: category === -1 ? undefined : category,
    categoryId: categoryId === -1 ? undefined : categoryId,
    account: account === -1 ? undefined : account,
    notes: notes === -1 ? undefined : notes,
  };
}

function firstColWhere(
  sample: string[][],
  pred: (cell: string) => boolean,
  exclude = -1
): number {
  const width = Math.max(...sample.map((r) => r.length), 0);
  for (let i = 0; i < width; i++) {
    if (i === exclude) continue;
    const cells = sample.map((r) => r[i]).filter(Boolean);
    if (cells.length > 0 && cells.every(pred)) return i;
  }
  return -1;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Detect DMY vs MDY vs YMD from a column of date strings */
export function detectDateFormat(values: string[]): DateFormat {
  let dmyPossible = true;
  let mdyPossible = true;
  for (const v of values) {
    const m = v?.match(DATE_RE);
    if (!m) continue;
    const [, a, b, c] = m;
    if (a.length === 4) return "YMD";
    if (c.length !== 4 && parseInt(c) > 31) return "YMD"; // odd, bail
    const first = parseInt(a);
    const second = isNaN(parseInt(b)) ? MONTHS[b.slice(0, 3).toLowerCase()] || 0 : parseInt(b);
    if (first > 12) mdyPossible = false;
    if (second > 12) dmyPossible = false;
  }
  if (dmyPossible && !mdyPossible) return "DMY";
  if (mdyPossible && !dmyPossible) return "MDY";
  // Ambiguous — default DMY (AU locale app)
  return "DMY";
}

/** Parse a date string using the chosen format. Returns ISO yyyy-mm-dd or null. */
export function parseDateAs(s: string, format: DateFormat): string | null {
  if (!s) return null;
  const m = s.trim().match(DATE_RE);
  if (m) {
    let [, a, b, c] = m;
    let year: number, month: number, day: number;
    const bNum = isNaN(parseInt(b)) ? MONTHS[b.slice(0, 3).toLowerCase()] || 0 : parseInt(b);
    if (a.length === 4) {
      year = parseInt(a); month = bNum; day = parseInt(c);
    } else if (format === "YMD") {
      year = parseInt(a); month = bNum; day = parseInt(c);
    } else if (format === "MDY") {
      month = parseInt(a); day = bNum; year = parseInt(c);
    } else {
      day = parseInt(a); month = bNum; year = parseInt(c);
    }
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // Fallback: native parse (handles "15 Jan 2025" etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

export function parseAmountCell(s: string): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

export interface ImportCandidate {
  txn: StoredTransaction;
  duplicate: boolean;
  rowIndex: number;
  /**
   * Category name/path from the source file that didn't resolve to an existing
   * tree node — the import commit offers to create these.
   */
  unresolvedCategory?: string;
}

export interface RowError {
  rowIndex: number;
  row: string[];
  reason: string;
}

/**
 * Dedup key: date + rounded amount + normalized description.
 * FX-converted rows key on the original (source-currency) amount so the same
 * bank row still matches even if a different rate was used at import time.
 */
export function dedupKey(t: {
  date: string;
  amount: number;
  description: string;
  originalAmount?: number;
}): string {
  const desc = t.description.toLowerCase().replace(/\s+/g, " ").trim();
  return `${t.date}|${(t.originalAmount ?? t.amount).toFixed(2)}|${desc}`;
}

export function buildCandidates(
  rows: string[][],
  mapping: ColumnMapping,
  dateFormat: DateFormat,
  convention: AmountConvention,
  account: string,
  existingKeys: Set<string>,
  /** Resolve a category name or path from the source file to a tree node id */
  resolveCategory: (nameOrPath: string) => string | undefined,
  /** Is this id an existing tree node? (guards CategoryId columns from stale ids) */
  isValidCategoryId: (id: string) => boolean,
  fxRate?: number
): { candidates: ImportCandidate[]; errors: RowError[] } {
  const candidates: ImportCandidate[] = [];
  const errors: RowError[] = [];
  const seenInFile = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const dateRaw = row[mapping.date];
    const date = parseDateAs(dateRaw ?? "", dateFormat);
    if (!date) {
      errors.push({ rowIndex, row, reason: `Unparseable date: "${dateRaw ?? ""}"` });
      return;
    }

    let amount: number | null = null;
    if (convention === "debitCredit" && mapping.credit !== undefined) {
      const debit = parseAmountCell(row[mapping.amount]) ?? 0;
      const credit = parseAmountCell(row[mapping.credit]) ?? 0;
      amount = Math.abs(debit) - Math.abs(credit);
      if (debit === 0 && credit === 0) amount = null;
    } else {
      const raw = parseAmountCell(row[mapping.amount]);
      if (raw !== null) {
        // App convention: expenses positive, income negative
        amount = convention === "negativeIsExpense" ? -raw : raw;
      }
    }
    if (amount === null) {
      errors.push({ rowIndex, row, reason: "Missing or unparseable amount" });
      return;
    }

    const description = (row[mapping.description] ?? "").trim();
    const convert = fxRate !== undefined && fxRate > 0 && fxRate !== 1;
    const original = Math.round(amount * 100) / 100;

    // Category resolution: explicit CategoryId column wins; otherwise resolve
    // a category name/path against the tree; otherwise uncategorized.
    let categoryId = UNCATEGORIZED_ID;
    let unresolvedCategory: string | undefined;
    const rawId = mapping.categoryId !== undefined ? row[mapping.categoryId]?.trim() : "";
    const rawName = mapping.category !== undefined ? row[mapping.category]?.trim() : "";
    if (rawId && isValidCategoryId(rawId)) {
      categoryId = rawId;
    } else if (rawName) {
      const resolved = resolveCategory(rawName);
      if (resolved) categoryId = resolved;
      else unresolvedCategory = rawName;
    }

    const txn: StoredTransaction = {
      id: uid() + rowIndex.toString(36),
      date,
      description,
      amount: convert ? Math.round(original * fxRate * 100) / 100 : original,
      ...(convert ? { originalAmount: original, fxRate } : {}),
      categoryId,
      account: (mapping.account !== undefined && row[mapping.account]?.trim()) || account,
      notes: (mapping.notes !== undefined && row[mapping.notes]?.trim()) || "",
    };

    const key = dedupKey(txn);
    const duplicate = existingKeys.has(key) || seenInFile.has(key);
    seenInFile.add(key);
    candidates.push({ txn, duplicate, rowIndex, ...(unresolvedCategory ? { unresolvedCategory } : {}) });
  });

  return { candidates, errors };
}

