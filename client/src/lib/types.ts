export interface Transaction {
  id: string;
  date: Date;
  dateStr: string; // ISO "2025-01-15"
  description: string;
  amount: number; // positive = expense, negative = income/refund
  /** The category node this transaction is filed on (any node, not just leaves) */
  categoryId: string;
  /** Display name of the category node (derived at load) */
  category: string;
  /** Full path, e.g. "Travel > Mexico 2026 > Flights" (derived at load) */
  path: string;
  /** Name of the top-level ancestor node — the chart bucket (derived at load) */
  group: string;
  account: string; // source account/bank, e.g. "ANZ Visa"
  notes: string;
  /** For foreign-currency imports: the source-currency amount before conversion (audit trail) */
  originalAmount?: number;
  /** Rate applied at import: amount = originalAmount × fxRate */
  fxRate?: number;
}

/** Serialized form stored in transactions.csv / JSON backups — references the tree by id only */
export interface StoredTransaction {
  id: string;
  date: string; // ISO "2025-01-15"
  description: string;
  amount: number;
  categoryId: string;
  account: string;
  notes: string;
  originalAmount?: number;
  fxRate?: number;
}

/**
 * One node of the category tree (categories.csv). Arbitrary depth; transactions
 * may be filed on any node. A node with `oneOff` set is a "project": a one-off
 * cost centre (a trip, a renovation…) whose subtree clusters at the end of
 * pickers and can be excluded from trend analysis. Archiving a node retires its
 * whole subtree from pickers/suggestions and disables its rules, keeping history.
 */
export interface CategoryNode {
  id: string; // stable readable slug, e.g. "travel-mex26"
  parentId: string | null; // null = top-level (a chart bucket)
  name: string; // unique among siblings only
  oneOff?: boolean;
  archived?: boolean;
  color?: string; // chart color (top-level and one-off nodes)
  budget?: number;
  notes?: string;
  createdAt?: string;
}

export interface Rule {
  id: string;
  /** Case-insensitive substring matched against transaction description (or regex if isRegex) */
  pattern: string;
  isRegex: boolean;
  categoryId: string;
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
  /** Multiplier applied to amounts on import (foreign-currency accounts), e.g. USD→AUD 1.52 */
  fxRate?: number;
}

export interface ColumnMapping {
  date: number;
  description: number;
  amount: number; // single amount column, or debit column when credit >= 0
  credit?: number; // separate credit column (optional)
  /** Column carrying a category name or path (resolved against the tree at import) */
  category?: number;
  /** Column carrying a category node id (this app's own exports) */
  categoryId?: number;
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
  yearScope: string; // "all", "2025", or "range:2024-06-01:2025-08-13" (see lib/scope)
  /** Exclude one-off (project) subtrees from the derived analytics */
  hideOneOffs?: boolean;
}

export interface MonthlyData {
  month: string; // "2025-01"
  label: string; // "Jan" or "Jan 25" when multi-year
  total: number;
  count: number;
  /** spend per category node id (direct filing, no rollup) */
  categories: Record<string, number>;
  /** spend per top-level bucket name (full rollup) */
  groups: Record<string, number>;
}

/** Per-node aggregate over the scoped transactions */
export interface NodeStats {
  id: string;
  name: string;
  path: string;
  depth: number;
  parentId: string | null;
  /** spend filed directly on this node */
  direct: number;
  directCount: number;
  /** spend including all descendants */
  total: number;
  count: number;
}

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
 * Stable fallback color for a top-level bucket name — known names keep their
 * palette, new ones hash into it. A node's explicit `color` wins over this.
 */
export function groupColor(name: string): string {
  if (KNOWN_GROUP_COLORS[name]) return KNOWN_GROUP_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CHART_HEX_COLORS[hash % CHART_HEX_COLORS.length];
}

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
