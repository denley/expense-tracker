export interface Transaction {
  date: Date;
  dateStr: string;
  description: string;
  amount: number;
  category: string;
  group: string;
  notes: string;
}

export interface MonthlyData {
  month: string; // "2025-01"
  label: string; // "Jan"
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

export const GROUP_COLORS: Record<string, string> = {
  "Groceries": "#55a38b",
  "Other": "#c9a96e",
  "Home": "#4a7c8a",
  "Travel": "#c17c5e",
  "Health/Wellness": "#8e8ea0",
  "Child": "#7c9885",
  "Other People": "#d4a574",
  "Income": "#6b8e9b",
};

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
