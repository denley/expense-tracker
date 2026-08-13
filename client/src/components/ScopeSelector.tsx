/*
  Global time scope — filters every analytics page to one year, a custom
  date range, or all time. The scope is stored in the expense context, so
  it carries across Dashboard, Categories, Monthly and Trends.
*/
import { useExpenses } from "@/contexts/ExpenseContext";
import { parseScope, encodeRange } from "@/lib/scope";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

const CUSTOM = "__custom__";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ScopeSelector({ className }: { className?: string }) {
  const { yearScope, setYearScope, availableYears } = useExpenses();
  const scope = parseScope(yearScope);

  if (availableYears.length === 0) return null;

  const startCustom = () => {
    // Default the custom range to the last 12 months
    const to = new Date();
    const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate() + 1);
    setYearScope(encodeRange(iso(from), iso(to)));
  };

  const inputCls =
    "w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="relative">
        <CalendarRange className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <select
          value={scope.kind === "range" ? CUSTOM : yearScope}
          onChange={(e) => {
            if (e.target.value === CUSTOM) startCustom();
            else setYearScope(e.target.value);
          }}
          className="w-full pl-8 pr-2 py-2 text-xs font-medium bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
          title="Time scope"
        >
          <option value="all">All time</option>
          {[...availableYears].reverse().map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
          <option value={CUSTOM}>Custom range…</option>
        </select>
      </div>
      {scope.kind === "range" && (
        <div className="space-y-1">
          <input
            type="date"
            value={scope.from}
            onChange={(e) => setYearScope(encodeRange(e.target.value, scope.to))}
            className={inputCls}
            title="From (inclusive)"
          />
          <input
            type="date"
            value={scope.to}
            onChange={(e) => setYearScope(encodeRange(scope.from, e.target.value))}
            className={inputCls}
            title="To (inclusive)"
          />
        </div>
      )}
    </div>
  );
}
