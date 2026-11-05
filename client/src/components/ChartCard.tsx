/*
  DESIGN: Scandinavian Analytical — chart container card
  - Paper-like card with title and optional subtitle
  - Consistent padding and border treatment
  - Optional table view of the same data (Chart / Table switch), remembered
    per card in this browser
*/
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChartTableColumn<R> {
  label: string;
  align?: "left" | "right";
  cell: (row: R) => ReactNode;
}

export interface ChartTable<R> {
  columns: ChartTableColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  /** Same destination as clicking the matching bar/point in the chart */
  onRowClick?: (row: R) => void;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  /** The chart's data as a table; adds a Chart / Table switch */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: ChartTable<any>;
  /** Stable key for remembering the chosen view (titles can change with the data) */
  viewKey?: string;
}

type View = "chart" | "table";

function readView(key: string | undefined): View {
  if (!key) return "chart";
  try {
    return localStorage.getItem(`chartView:${key}`) === "table" ? "table" : "chart";
  } catch {
    return "chart";
  }
}

function saveView(key: string | undefined, view: View) {
  if (!key) return;
  try {
    localStorage.setItem(`chartView:${key}`, view);
  } catch {
    // storage unavailable (private window): the switch still works for this visit
  }
}

export default function ChartCard({ title, subtitle, children, className, action, table, viewKey }: ChartCardProps) {
  const [view, setView] = useState<View>(() => (table ? readView(viewKey) : "chart"));
  const choose = (v: View) => {
    setView(v);
    saveView(viewKey, v);
  };
  const showTable = !!table && view === "table";

  return (
    <div className={cn("bg-card rounded-xl border border-border p-5", className)}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {(action || table) && (
          <div className="flex items-center gap-2 shrink-0">
            {action}
            {table && (
              <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-medium" role="group" aria-label="View">
                {(["chart", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => choose(v)}
                    aria-pressed={view === v}
                    className={cn(
                      "px-2.5 py-1 capitalize transition-colors",
                      view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {showTable ? <DataTable table={table} /> : children}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DataTable({ table }: { table: ChartTable<any> }) {
  const { columns, rows, rowKey, onRowClick } = table;
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-6 text-center">No data</p>;
  }
  return (
    <div className="max-h-[420px] overflow-y-auto -mx-5">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            {columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  "px-5 py-2 font-medium text-muted-foreground uppercase tracking-wider text-[11px]",
                  c.align === "right" ? "text-right" : "text-left"
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border/50",
                onRowClick && "cursor-pointer hover:bg-accent/50 transition-colors"
              )}
            >
              {columns.map((c, i) => (
                <td
                  key={i}
                  className={cn("px-5 py-2", c.align === "right" ? "text-right tabular-nums whitespace-nowrap" : "text-left")}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A table cell label with a category's colour dot */
export function ColorLabel({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}
