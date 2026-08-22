/*
  DESIGN: Scandinavian Analytical — GitHub-style calendar heatmap
  - Weeks as columns (Mon–Sun rows), month labels along the top
  - Terracotta intensity scale; shared `max` lets two heatmaps be compared
  - Displays at most 53 weeks from the period start (caller clamps/labels)
*/
import { useMemo } from "react";
import { dateOf, isoOf, formatDay } from "@/lib/compare";
import { formatCurrencyExact } from "@/lib/utils";
import { MONTH_LABELS } from "@/lib/types";

export interface DayTotal {
  total: number;
  count: number;
}

interface CalendarHeatmapProps {
  /** iso date → spend that day (only days with activity need entries) */
  days: Map<string, DayTotal>;
  from: string; // inclusive ISO
  to: string; // inclusive ISO
  /** Scale ceiling (e.g. p95 of daily totals across both periods) */
  max: number;
  onDayClick?: (iso: string) => void;
}

const CELL = 12; // px, including 2px gap
const MAX_WEEKS = 53;

/** Opacity step for a day's total against the shared ceiling */
function levelOf(total: number, max: number): number {
  if (total <= 0) return 0;
  const r = max > 0 ? total / max : 1;
  if (r < 0.25) return 0.2;
  if (r < 0.5) return 0.4;
  if (r < 0.75) return 0.65;
  return 1;
}

export default function CalendarHeatmap({ days, from, to, max, onDayClick }: CalendarHeatmapProps) {
  const weeks = useMemo(() => {
    // Start from the Monday on/before `from`
    const start = dateOf(from);
    const offset = (start.getDay() + 6) % 7; // Mon=0 … Sun=6
    start.setDate(start.getDate() - offset);

    const result: { monthLabel: string | null; cells: Array<{ iso: string; inPeriod: boolean } | null> }[] = [];
    const cursor = new Date(start);
    let prevMonth = -1;
    for (let w = 0; w < MAX_WEEKS; w++) {
      if (isoOf(cursor) > to) break;
      const cells: Array<{ iso: string; inPeriod: boolean } | null> = [];
      let monthLabel: string | null = null;
      for (let d = 0; d < 7; d++) {
        const iso = isoOf(cursor);
        const inPeriod = iso >= from && iso <= to;
        // Label the column where a new month first appears (in-period only)
        if (inPeriod && cursor.getDate() <= 7 && cursor.getMonth() !== prevMonth) {
          monthLabel = MONTH_LABELS[cursor.getMonth()];
          prevMonth = cursor.getMonth();
        }
        cells.push({ iso, inPeriod });
        cursor.setDate(cursor.getDate() + 1);
      }
      result.push({ monthLabel, cells });
    }
    return result;
  }, [from, to]);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-block min-w-0">
        {/* Month labels */}
        <div className="flex ml-8">
          {weeks.map((w, i) => (
            <div key={i} className="text-[9px] text-muted-foreground" style={{ width: CELL, minWidth: CELL }}>
              {w.monthLabel ?? ""}
            </div>
          ))}
        </div>
        <div className="flex">
          {/* Day-of-week labels */}
          <div className="flex flex-col w-8 shrink-0 text-[9px] text-muted-foreground">
            {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
              <div key={i} className="flex items-center" style={{ height: CELL }}>
                {l}
              </div>
            ))}
          </div>
          {/* Week columns */}
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col">
              {w.cells.map((cell, di) => {
                if (!cell || !cell.inPeriod) {
                  return <div key={di} style={{ width: CELL, height: CELL }} />;
                }
                const day = days.get(cell.iso);
                const level = levelOf(day?.total ?? 0, max);
                return (
                  <div key={di} className="p-[1px]" style={{ width: CELL, height: CELL }}>
                    <div
                      onClick={day && onDayClick ? () => onDayClick(cell.iso) : undefined}
                      className={
                        "w-full h-full rounded-[2px] " +
                        (day && onDayClick ? "cursor-pointer hover:ring-1 hover:ring-foreground/40" : "")
                      }
                      style={{
                        backgroundColor:
                          level === 0
                            ? "var(--color-secondary)"
                            : `color-mix(in srgb, var(--color-terracotta) ${Math.round(level * 100)}%, var(--color-secondary))`,
                      }}
                      title={
                        `${formatDay(cell.iso)} — ` +
                        (day
                          ? `${formatCurrencyExact(day.total)} (${day.count} transaction${day.count === 1 ? "" : "s"})`
                          : "no spending")
                      }
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
