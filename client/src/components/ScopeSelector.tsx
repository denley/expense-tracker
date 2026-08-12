/*
  Global year scope — filters every analytics page to one year or all time.
*/
import { useExpenses } from "@/contexts/ExpenseContext";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ScopeSelector({ className }: { className?: string }) {
  const { yearScope, setYearScope, availableYears } = useExpenses();

  if (availableYears.length <= 1) return null;

  return (
    <div className={cn("relative", className)}>
      <CalendarRange className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <select
        value={yearScope}
        onChange={(e) => setYearScope(e.target.value)}
        className="w-full pl-8 pr-2 py-2 text-xs font-medium bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
        title="Year scope"
      >
        <option value="all">All time</option>
        {[...availableYears].reverse().map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
