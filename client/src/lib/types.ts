export interface Transaction {
  id: string;
  date: Date;
  dateStr: string; // ISO "2025-01-15"
  description: string;
  amount: number; // positive = expense, negative = income/refund
  category: string;
  group: string; // always derived from the category's group (strict tree)
  account: string; // source account/bank, e.g. "ANZ Visa"
  notes: string;
}

/** Serialized form stored in IndexedDB / JSON export */
export interface StoredTransaction {
  id: string;
  date: string; // ISO "2025-01-15"
  description: string;
  amount: number;
  category: string;
  group: string;
  account: string;
  notes: string;
}

/**
 * The category tree: every category belongs to exactly one group.
 * Groups exist implicitly as the set of distinct `group` values.
 * A "project" is a group with a Project metadata record attached.
 */
export interface CategoryDef {
  name: string;
  group: string;
}

export type ProjectStatus = "active" | "archived";

/**
 * One-off cost centre. `name` IS the group name its categories live under.
 * The active period is implicit from its transactions; archiving retires it
 * from pickers, rules and suggestions while keeping all history.
 */
export interface Project {
  id: string;
  name: string;
  color: string;
  status: ProjectStatus;
  budget?: number;
  notes?: string;
  createdAt: string;
}

export interface Rule {
  id: string;
  /** Case-insensitive substring matched against transaction description (or regex if isRegex) */
  pattern: string;
  isRegex: boolean;
  category: string; // group follows from the category
  enabled: boolean;
  createdAt: string;
}

/** Saved CSV column mapping for a bank */
export interface ImportProfile {
  id: string;
  name: string; // e.g. "ANZ Visa"
  account: string;
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  amountConvention: AmountConvention;
  hasHeader: boolean;
}

export interface ColumnMapping {
  date: number;
  description: number;
  amount: number; // single amount column, or debit column when credit >= 0
  credit?: number; // separate credit column (optional)
  category?: number;
  group?: number;
  account?: number;
  notes?: number;
}

export type DateFormat = "DMY" | "MDY" | "YMD";

/**
 * How to interpret amount signs in the source file:
 * - negativeIsExpense: bank exports where spending is negative (most banks)
 * - positiveIsExpense: files where spending is positive (this app's own exports)
 * - debitCredit: separate debit/credit columns
 */
export type AmountConvention = "negativeIsExpense" | "positiveIsExpense" | "debitCredit";

export interface Settings {
  yearScope: string; // "all" or "2025"
}

export interface MonthlyData {
  month: string; // "2025-01"
  label: string; // "Jan" or "Jan 25" when multi-year
  total: number;
  count: number;
  categories: Record<string, number>;
  groups: Record<string, number>;
}

export interface CategoryData {
  name: string;
  total: number;
  count: number;
  avgPerTransaction: number;
  group: string;
}

export interface GroupData {
  name: string;
  total: number;
  count: number;
  categories: string[];
}

export const UNCATEGORIZED = "Uncategorized";
export const DEFAULT_GROUP = "Other";

export const CHART_COLORS = [
  "var(--color-eucalyptus)",
  "var(--color-sandstone)",
  "var(--color-ocean)",
  "var(--color-terracotta)",
  "var(--color-lavender)",
  "var(--color-sage)",
  "#d4a574",
  "#7c9885",
  "#b8860b",
  "#6b8e9b",
  "#c17c5e",
  "#8e8ea0",
  "#a0c4a8",
  "#d4a574",
  "#7ba3b0",
  "#c9a96e",
];

export const CHART_HEX_COLORS = [
  "#55a38b",
  "#c9a96e",
  "#4a7c8a",
  "#c17c5e",
  "#8e8ea0",
  "#7c9885",
  "#d4a574",
  "#6b8e9b",
  "#b8860b",
  "#a0c4a8",
  "#7ba3b0",
  "#9b7c6b",
  "#6ba08e",
  "#b09b7b",
  "#5a8a9a",
  "#a07c6b",
];

const KNOWN_GROUP_COLORS: Record<string, string> = {
  "Groceries": "#55a38b",
  "Other": "#c9a96e",
  "Home": "#4a7c8a",
  "Travel": "#c17c5e",
  "Health/Wellness": "#8e8ea0",
  "Child": "#7c9885",
  "Other People": "#d4a574",
  "Income": "#6b8e9b",
};

/**
 * Stable fallback color for a group name — known groups keep their palette,
 * new ones hash into it. Project groups should prefer the project's own color
 * (see `groupColors` on the expense context).
 */
export function groupColor(name: string): string {
  if (KNOWN_GROUP_COLORS[name]) return KNOWN_GROUP_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CHART_HEX_COLORS[hash % CHART_HEX_COLORS.length];
}

/** Kept for backwards compatibility with existing pages */
export const GROUP_COLORS: Record<string, string> = new Proxy(KNOWN_GROUP_COLORS, {
  get(target, prop: string) {
    return target[prop] ?? groupColor(prop);
  },
});

export const PROJECT_COLORS = [
  "#c17c5e",
  "#55a38b",
  "#4a7c8a",
  "#c9a96e",
  "#8e8ea0",
  "#7c9885",
  "#b8860b",
  "#6b8e9b",
];

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
