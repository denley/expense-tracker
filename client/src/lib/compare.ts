/*
  Period math for the Compare page. A Period is an inclusive ISO date range
  with a human label; pickers build periods from years, months or custom
  ranges. All date arithmetic is done in local time via y/m/d parts (never
  Date.parse) to avoid timezone drift.
*/
import { MONTH_LABELS } from "@/lib/types";

export interface Period {
  from: string; // inclusive ISO date "2025-01-01"
  to: string; // inclusive ISO date "2025-12-31"
  label: string; // "2025", "Aug 2025", "1 Jun 2024 – 13 Aug 2025"
}

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysIso(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** Inclusive day count of a period */
export function daysInPeriod(p: Period): number {
  return Math.round((dateOf(p.to).getTime() - dateOf(p.from).getTime()) / 86400000) + 1;
}

/** Month keys ("2025-01") intersecting the period, in order */
export function monthKeysIn(p: Period): string[] {
  const keys: string[] = [];
  let [y, m] = p.from.split("-").map(Number);
  const [ey, em] = p.to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/** "Jan 25" style label for a month key */
export function monthKeyLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

/** Move a "2025-08" month key by a number of months (negative = back) */
export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function yearPeriod(year: string): Period {
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
}

export function monthPeriod(key: string): Period {
  const [y, m] = key.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${key}-01`,
    to: `${key}-${String(lastDay).padStart(2, "0")}`,
    label: `${MONTH_LABELS[m - 1]} ${y}`,
  };
}

function fmtShort(iso: string): string {
  return dateOf(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "Wed 12 Mar 2025" — heatmap/day-detail label */
export function formatDay(iso: string): string {
  return dateOf(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function rangePeriod(from: string, to: string): Period {
  return { from, to, label: `${fmtShort(from)} – ${fmtShort(to)}` };
}
