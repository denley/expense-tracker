import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import type { Transaction, MonthlyData, CategoryData, GroupData } from "@/lib/types";
import { MONTH_LABELS } from "@/lib/types";

// CSV is served from the public directory — swap the file to update data
const CSV_URL = import.meta.env.BASE_URL + "data.csv";

interface RawRow {
  Date: string;
  Description: string;
  Amount: string;
  Category: string;
  Group: string;
  Confidence: string;
  Notes: string;
}

function parseDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace("$", "").replace(",", ""));
}

export function useExpenseData() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Papa.parse<RawRow>(CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed: Transaction[] = results.data
            .filter((row) => row.Date && row.Amount)
            .map((row) => ({
              date: parseDate(row.Date),
              dateStr: row.Date,
              description: row.Description || "",
              amount: parseAmount(row.Amount),
              category: row.Category || "Uncategorized",
              group: row.Group || "Other",
              notes: row.Notes || "",
            }));
          parsed.sort((a, b) => a.date.getTime() - b.date.getTime());
          setTransactions(parsed);
          setLoading(false);
        } catch (e) {
          setError("Failed to parse CSV data");
          setLoading(false);
        }
      },
      error: (err) => {
        setError(err.message);
        setLoading(false);
      },
    });
  }, []);

  const totalSpend = useMemo(
    () => transactions.reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  );

  const monthlyData = useMemo(() => {
    const map = new Map<string, MonthlyData>();
    for (const t of transactions) {
      const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) {
        map.set(key, {
          month: key,
          label: MONTH_LABELS[t.date.getMonth()],
          total: 0,
          count: 0,
          categories: {},
          groups: {},
        });
      }
      const m = map.get(key)!;
      m.total += t.amount;
      m.count += 1;
      m.categories[t.category] = (m.categories[t.category] || 0) + t.amount;
      m.groups[t.group] = (m.groups[t.group] || 0) + t.amount;
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions]);

  const categoryData = useMemo(() => {
    const map = new Map<string, { total: number; count: number; group: string }>();
    for (const t of transactions) {
      if (!map.has(t.category)) {
        map.set(t.category, { total: 0, count: 0, group: t.group });
      }
      const c = map.get(t.category)!;
      c.total += t.amount;
      c.count += 1;
    }
    const result: CategoryData[] = Array.from(map.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      count: data.count,
      avgPerTransaction: data.total / data.count,
      group: data.group,
    }));
    return result.sort((a, b) => b.total - a.total);
  }, [transactions]);

  const groupData = useMemo(() => {
    const map = new Map<string, { total: number; count: number; categories: Set<string> }>();
    for (const t of transactions) {
      if (!map.has(t.group)) {
        map.set(t.group, { total: 0, count: 0, categories: new Set() });
      }
      const g = map.get(t.group)!;
      g.total += t.amount;
      g.count += 1;
      g.categories.add(t.category);
    }
    const result: GroupData[] = Array.from(map.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      count: data.count,
      categories: Array.from(data.categories),
    }));
    return result.sort((a, b) => b.total - a.total);
  }, [transactions]);

  const categories = useMemo(
    () => categoryData.map((c) => c.name),
    [categoryData]
  );

  const groups = useMemo(
    () => groupData.map((g) => g.name),
    [groupData]
  );

  const avgMonthlySpend = useMemo(
    () => (monthlyData.length > 0 ? totalSpend / monthlyData.length : 0),
    [totalSpend, monthlyData]
  );

  return {
    transactions,
    loading,
    error,
    totalSpend,
    monthlyData,
    categoryData,
    groupData,
    categories,
    groups,
    avgMonthlySpend,
  };
}
