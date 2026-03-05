import { createContext, useContext, type ReactNode } from "react";
import { useExpenseData } from "@/hooks/useExpenseData";
import type { Transaction, MonthlyData, CategoryData, GroupData } from "@/lib/types";

interface ExpenseContextType {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  totalSpend: number;
  monthlyData: MonthlyData[];
  categoryData: CategoryData[];
  groupData: GroupData[];
  categories: string[];
  groups: string[];
  avgMonthlySpend: number;
}

const ExpenseContext = createContext<ExpenseContextType | null>(null);

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const data = useExpenseData();
  return (
    <ExpenseContext.Provider value={data}>
      {children}
    </ExpenseContext.Provider>
  );
}

export function useExpenses() {
  const ctx = useContext(ExpenseContext);
  if (!ctx) throw new Error("useExpenses must be used within ExpenseProvider");
  return ctx;
}
