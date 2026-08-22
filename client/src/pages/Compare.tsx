/*
  DESIGN: Scandinavian Analytical — Compare periods
  - Two periods (A vs baseline B) picked as a year, a month, or a custom range
  - Presets: year vs previous (YoY), rolling 12 months, month vs previous/year-ago
  - KPI cards, aligned monthly bars, cumulative race, per-group delta table
    with category drill-down, and side-by-side calendar heatmaps
  - Ignores the global sidebar time scope (it compares across all data);
    the hide-one-offs toggle still applies
*/
import { useState, useMemo, useCallback, useEffect } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard from "@/components/ChartCard";
import StatCard from "@/components/StatCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import CalendarHeatmap, { type DayTotal } from "@/components/CalendarHeatmap";
import { formatCurrency, formatCurrencyExact } from "@/lib/utils";
import {
  type Period, yearPeriod, monthPeriod, rangePeriod, monthKeysIn, monthKeyLabel,
  daysInPeriod, isoOf, addDaysIso, shiftMonthKey, formatDay,
} from "@/lib/compare";
import { MONTH_LABELS } from "@/lib/types";
import { ArrowLeftRight, ChevronRight, ArrowUpRight, X } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const COLOR_A = "#55a38b"; // eucalyptus — period A
const COLOR_B = "#8e8ea0"; // muted grey — baseline B

type PickerMode = "year" | "month" | "range";
interface PickerState {
  mode: PickerMode;
  year: string;
  month: string; // "2025-08"
  from: string;
  to: string;
}

function toPeriod(p: PickerState): Period {
  if (p.mode === "year") return yearPeriod(p.year);
  if (p.mode === "month") return monthPeriod(p.month);
  return rangePeriod(p.from, p.to);
}

/** Days of the period that have already happened (partial periods) */
function elapsedDays(p: Period): number {
  const today = isoOf(new Date());
  if (p.from > today) return 0;
  const end = p.to < today ? p.to : today;
  return daysInPeriod({ ...p, to: end });
}

function signedCurrency(v: number): string {
  return (v > 0 ? "+" : "") + formatCurrency(v);
}

function deltaColor(v: number): string {
  if (v > 0) return "text-terracotta";
  if (v < 0) return "text-eucalyptus";
  return "text-muted-foreground";
}

export default function Compare() {
  const {
    loading, allTransactions, tree, hideOneOffs, availableYears, colorOf, nameOf,
  } = useExpenses();
  const [, navigate] = useLocation();

  // ---------- Base data (all time, minus one-offs when the toggle is on) ----------
  const baseTxns = useMemo(
    () => (hideOneOffs ? allTransactions.filter((t) => !tree.isOneOff(t.categoryId)) : allTransactions),
    [allTransactions, tree, hideOneOffs]
  );

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of baseTxns) set.add(t.dateStr.slice(0, 7));
    return Array.from(set).sort().reverse(); // newest first
  }, [baseTxns]);

  // ---------- Period pickers ----------
  const [pickA, setPickA] = useState<PickerState | null>(null);
  const [pickB, setPickB] = useState<PickerState | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const latestMonth = availableMonths[0];
  const latestYear = availableYears[availableYears.length - 1];
  const prevYear = availableYears[availableYears.length - 2];

  const defaultRange = useCallback((): { from: string; to: string } => {
    const to = isoOf(new Date());
    return { from: addDaysIso(to, -89), to };
  }, []);

  const makePicker = useCallback(
    (partial: Partial<PickerState>): PickerState => ({
      mode: "year",
      year: latestYear ?? String(new Date().getFullYear()),
      month: latestMonth ?? isoOf(new Date()).slice(0, 7),
      ...defaultRange(),
      ...partial,
    }),
    [latestYear, latestMonth, defaultRange]
  );

  // Default comparison once data arrives: year vs previous, else month vs previous
  useEffect(() => {
    if (pickA || baseTxns.length === 0) return;
    if (availableYears.length >= 2) {
      setPickA(makePicker({ mode: "year", year: latestYear }));
      setPickB(makePicker({ mode: "year", year: prevYear }));
      setActivePreset("yoy");
    } else {
      const m0 = latestMonth;
      const m1 = availableMonths[1] ?? shiftMonthKey(m0, -1);
      setPickA(makePicker({ mode: "month", month: m0 }));
      setPickB(makePicker({ mode: "month", month: m1 }));
      setActivePreset("mom");
    }
  }, [pickA, baseTxns.length, availableYears, availableMonths, latestYear, prevYear, latestMonth, makePicker]);

  const presets = useMemo(() => {
    const list: Array<{ id: string; label: string; apply: () => void }> = [];
    if (availableYears.length >= 2) {
      list.push({
        id: "yoy",
        label: `${latestYear} vs ${prevYear}`,
        apply: () => {
          setPickA(makePicker({ mode: "year", year: latestYear }));
          setPickB(makePicker({ mode: "year", year: prevYear }));
        },
      });
      list.push({
        id: "rolling12",
        label: "Last 12 months vs prior 12",
        apply: () => {
          const cur = isoOf(new Date()).slice(0, 7);
          const a = { from: monthPeriod(shiftMonthKey(cur, -11)).from, to: monthPeriod(cur).to };
          const b = { from: monthPeriod(shiftMonthKey(cur, -23)).from, to: monthPeriod(shiftMonthKey(cur, -12)).to };
          setPickA(makePicker({ mode: "range", ...a }));
          setPickB(makePicker({ mode: "range", ...b }));
        },
      });
    }
    if (latestMonth) {
      list.push({
        id: "mom",
        label: "Month vs previous",
        apply: () => {
          setPickA(makePicker({ mode: "month", month: latestMonth }));
          setPickB(makePicker({ mode: "month", month: shiftMonthKey(latestMonth, -1) }));
        },
      });
      list.push({
        id: "moy",
        label: "Month vs a year ago",
        apply: () => {
          setPickA(makePicker({ mode: "month", month: latestMonth }));
          setPickB(makePicker({ mode: "month", month: shiftMonthKey(latestMonth, -12) }));
        },
      });
    }
    return list;
  }, [availableYears.length, latestYear, prevYear, latestMonth, makePicker]);

  const periodA = useMemo(() => (pickA ? toPeriod(pickA) : null), [pickA]);
  const periodB = useMemo(() => (pickB ? toPeriod(pickB) : null), [pickB]);

  // ---------- Per-period data ----------
  const txnsA = useMemo(
    () => (periodA ? baseTxns.filter((t) => t.dateStr >= periodA.from && t.dateStr <= periodA.to) : []),
    [baseTxns, periodA]
  );
  const txnsB = useMemo(
    () => (periodB ? baseTxns.filter((t) => t.dateStr >= periodB.from && t.dateStr <= periodB.to) : []),
    [baseTxns, periodB]
  );

  const totalA = useMemo(() => txnsA.reduce((s, t) => s + t.amount, 0), [txnsA]);
  const totalB = useMemo(() => txnsB.reduce((s, t) => s + t.amount, 0), [txnsB]);
  const delta = totalA - totalB;
  const deltaPct = totalB !== 0 ? (delta / Math.abs(totalB)) * 100 : null;

  const elapsedA = periodA ? elapsedDays(periodA) : 0;
  const elapsedB = periodB ? elapsedDays(periodB) : 0;
  const perDayA = elapsedA > 0 ? totalA / elapsedA : 0;
  const perDayB = elapsedB > 0 ? totalB / elapsedB : 0;

  /** Subtree rollup + direct filing per node over a transaction list */
  const rollup = useCallback(
    (txns: typeof txnsA) => {
      const map = new Map<string, { total: number; direct: number }>();
      const bump = (id: string, total: number, direct: number) => {
        const cur = map.get(id) ?? { total: 0, direct: 0 };
        cur.total += total;
        cur.direct += direct;
        map.set(id, cur);
      };
      for (const t of txns) {
        bump(t.categoryId, 0, t.amount);
        let cur: string | null = t.categoryId;
        const seen = new Set<string>();
        while (cur !== null && !seen.has(cur)) {
          seen.add(cur);
          bump(cur, t.amount, 0);
          const n = tree.byId.get(cur);
          cur = n?.parentId && tree.byId.has(n.parentId) ? n.parentId : null;
        }
      }
      return map;
    },
    [tree]
  );

  const rollupA = useMemo(() => rollup(txnsA), [rollup, txnsA]);
  const rollupB = useMemo(() => rollup(txnsB), [rollup, txnsB]);

  // ---------- Delta table rows ----------
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groupRows = useMemo(() => {
    return (tree.children.get(null) ?? [])
      .map((n) => {
        const a = rollupA.get(n.id)?.total ?? 0;
        const b = rollupB.get(n.id)?.total ?? 0;
        return { id: n.id, name: n.name, a, b, delta: a - b };
      })
      .filter((r) => r.a !== 0 || r.b !== 0)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  }, [tree, rollupA, rollupB]);

  const childRowsOf = useCallback(
    (rootId: string) => {
      const rows: Array<{ id: string; name: string; a: number; b: number; delta: number }> = [];
      for (const child of tree.children.get(rootId) ?? []) {
        const a = rollupA.get(child.id)?.total ?? 0;
        const b = rollupB.get(child.id)?.total ?? 0;
        if (a !== 0 || b !== 0) rows.push({ id: child.id, name: child.name, a, b, delta: a - b });
      }
      const directA = rollupA.get(rootId)?.direct ?? 0;
      const directB = rollupB.get(rootId)?.direct ?? 0;
      if ((directA !== 0 || directB !== 0) && rows.length > 0) {
        rows.push({ id: rootId, name: "(directly filed)", a: directA, b: directB, delta: directA - directB });
      }
      return rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    },
    [tree, rollupA, rollupB]
  );

  const biggestMover = groupRows[0];

  // ---------- Aligned monthly comparison ----------
  const monthsA = useMemo(() => (periodA ? monthKeysIn(periodA) : []), [periodA]);
  const monthsB = useMemo(() => (periodB ? monthKeysIn(periodB) : []), [periodB]);

  const monthTotals = useCallback((txns: typeof txnsA) => {
    const map = new Map<string, number>();
    for (const t of txns) {
      const key = t.dateStr.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + t.amount);
    }
    return map;
  }, []);

  const monthTotalsA = useMemo(() => monthTotals(txnsA), [monthTotals, txnsA]);
  const monthTotalsB = useMemo(() => monthTotals(txnsB), [monthTotals, txnsB]);

  const bothCalendarYears = pickA?.mode === "year" && pickB?.mode === "year";

  const monthlyRows = useMemo(() => {
    const len = Math.max(monthsA.length, monthsB.length);
    if (len < 3) return [];
    return Array.from({ length: len }, (_, i) => {
      const keyA = monthsA[i];
      const keyB = monthsB[i];
      const name = bothCalendarYears
        ? MONTH_LABELS[i]
        : keyA ? monthKeyLabel(keyA) : monthKeyLabel(keyB);
      return {
        name,
        a: keyA !== undefined ? Math.round(monthTotalsA.get(keyA) ?? 0) : undefined,
        b: keyB !== undefined ? Math.round(monthTotalsB.get(keyB) ?? 0) : undefined,
      };
    });
  }, [monthsA, monthsB, monthTotalsA, monthTotalsB, bothCalendarYears]);

  // ---------- Cumulative race ----------
  const dailyTotals = useCallback((txns: typeof txnsA) => {
    const map = new Map<string, DayTotal>();
    for (const t of txns) {
      const cur = map.get(t.dateStr) ?? { total: 0, count: 0 };
      cur.total += t.amount;
      cur.count += 1;
      map.set(t.dateStr, cur);
    }
    return map;
  }, []);

  const daysA = useMemo(() => dailyTotals(txnsA), [dailyTotals, txnsA]);
  const daysB = useMemo(() => dailyTotals(txnsB), [dailyTotals, txnsB]);

  const cumulativeRows = useMemo(() => {
    if (!periodA || !periodB) return [];
    const build = (p: Period, days: Map<string, DayTotal>, limit: number) => {
      const out: number[] = [];
      let cum = 0;
      let d = p.from;
      for (let i = 0; i < limit; i++) {
        cum += days.get(d)?.total ?? 0;
        out.push(Math.round(cum));
        d = addDaysIso(d, 1);
      }
      return out;
    };
    const cumA = build(periodA, daysA, elapsedA);
    const cumB = build(periodB, daysB, elapsedB);
    const len = Math.max(cumA.length, cumB.length);
    if (len < 2) return [];
    return Array.from({ length: len }, (_, i) => ({
      name: `Day ${i + 1}`,
      a: cumA[i],
      b: cumB[i],
    }));
  }, [periodA, periodB, daysA, daysB, elapsedA, elapsedB]);

  // ---------- Heatmaps ----------
  // Heatmaps stop at today (no point rendering empty future months) and cap
  // at ~53 weeks so very long ranges stay readable
  const MAX_HEAT_DAYS = 371;
  const heatRange = useCallback((p: Period) => {
    const today = isoOf(new Date());
    const capped = addDaysIso(p.from, MAX_HEAT_DAYS - 1);
    const clamped = p.to > capped;
    let to = clamped ? capped : p.to;
    if (to > today) to = today;
    if (to < p.from) return null; // period entirely in the future
    return { from: p.from, to, clamped };
  }, []);
  const heatA = useMemo(() => (periodA ? heatRange(periodA) : null), [periodA, heatRange]);
  const heatB = useMemo(() => (periodB ? heatRange(periodB) : null), [periodB, heatRange]);

  /** Shared intensity ceiling: p95 of daily totals across both periods */
  const heatMax = useMemo(() => {
    const all = [...daysA.values(), ...daysB.values()]
      .map((d) => d.total)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (all.length === 0) return 1;
    return all[Math.min(all.length - 1, Math.floor(all.length * 0.95))];
  }, [daysA, daysB]);

  // ---------- Day detail modal ----------
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const dayTxns = useMemo(
    () => (selectedDay ? baseTxns.filter((t) => t.dateStr === selectedDay) : []),
    [baseTxns, selectedDay]
  );
  const dayTotal = useMemo(() => dayTxns.reduce((s, t) => s + t.amount, 0), [dayTxns]);

  const handleCategoryNav = useCallback(
    (categoryId: string) => navigate(`/categories?category=${encodeURIComponent(categoryId)}`),
    [navigate]
  );

  if (loading) return <LoadingState />;

  if (baseTxns.length === 0 || !pickA || !pickB || !periodA || !periodB) {
    return (
      <div className="bg-card rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">
        Not enough data to compare yet — import some transactions first.
      </div>
    );
  }

  const setPicker = (which: "a" | "b", next: PickerState) => {
    setActivePreset(null);
    if (which === "a") setPickA(next);
    else setPickB(next);
  };

  // Compare elapsed days (not nominal length) so a partial current year vs a
  // full previous year still gets the per-day normalisation note
  const periodLengthsDiffer = Math.abs(elapsedA - elapsedB) > Math.max(elapsedA, elapsedB) * 0.1;

  return (
    <div className="space-y-6">
      {/* Header + pickers */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-card rounded-xl border border-border p-5"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <ArrowLeftRight className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-foreground tracking-tight">Compare Periods</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Compares across all data — the sidebar time scope doesn't apply here.
        </p>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                p.apply();
                setActivePreset(p.id);
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                activePreset === p.id
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Period pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PeriodPicker
            label="Period A"
            dotColor={COLOR_A}
            state={pickA}
            onChange={(next) => setPicker("a", next)}
            years={availableYears}
            months={availableMonths}
          />
          <PeriodPicker
            label="Baseline B"
            dotColor={COLOR_B}
            state={pickB}
            onChange={(next) => setPicker("b", next)}
            years={availableYears}
            months={availableMonths}
          />
        </div>
      </motion.div>

      {/* KPI cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          label={periodA.label}
          value={formatCurrency(totalA)}
          subtitle={`${formatCurrency(perDayA)}/day · ${txnsA.length} transactions`}
        />
        <StatCard
          label={`${periodB.label} (baseline)`}
          value={formatCurrency(totalB)}
          subtitle={`${formatCurrency(perDayB)}/day · ${txnsB.length} transactions`}
        />
        {/* Change card — spending up is terracotta (bad), down is eucalyptus (good) */}
        <div className="bg-card rounded-xl border border-border p-5 card-hover">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Change</span>
          <div className={cn("tabular-nums text-2xl font-semibold leading-none mt-3", deltaColor(delta))}>
            {signedCurrency(delta)}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {deltaPct !== null ? `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs baseline` : "no baseline spend"}
            {periodLengthsDiffer && (
              <span className={cn("block mt-0.5 font-medium", deltaColor(perDayA - perDayB))}>
                {signedCurrency(perDayA - perDayB)}/day (periods differ in length)
              </span>
            )}
          </div>
        </div>
        {biggestMover ? (
          <StatCard
            label="Biggest mover"
            value={biggestMover.name}
            subtitle={`${signedCurrency(biggestMover.delta)} vs baseline`}
            onClick={() => handleCategoryNav(biggestMover.id)}
          />
        ) : (
          <StatCard label="Biggest mover" value="—" />
        )}
      </motion.div>

      {/* Aligned monthly bars */}
      {monthlyRows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <ChartCard
            title="Month by Month"
            subtitle={
              bothCalendarYears
                ? "Same month, different year — the classic year-over-year view"
                : "Months aligned by position within each period"
            }
          >
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyRows} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "11px", paddingBottom: "8px" }}
                  />
                  <Bar dataKey="a" name={periodA.label} fill={COLOR_A} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="b" name={periodB.label} fill={COLOR_B} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>
      )}

      {/* Cumulative race */}
      {cumulativeRows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          <ChartCard
            title="Cumulative Spend Race"
            subtitle="Running total by day within each period — a line stopping early means the period is still underway"
          >
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "11px", paddingBottom: "8px" }}
                  />
                  <Line type="monotone" dataKey="a" name={periodA.label} stroke={COLOR_A} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="b" name={periodB.label} stroke={COLOR_B} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>
      )}

      {/* Delta table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <ChartCard
          title="What Changed"
          subtitle="Groups sorted by biggest change · Click a row to see its categories"
        >
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Group</th>
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider max-w-[140px] truncate">{periodA.label}</th>
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider max-w-[140px] truncate">{periodB.label}</th>
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Change</th>
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">%</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => {
                  const isOpen = expanded.has(row.id);
                  const children = isOpen ? childRowsOf(row.id) : [];
                  const pct = row.b !== 0 ? (row.delta / Math.abs(row.b)) * 100 : null;
                  return (
                    <GroupRows
                      key={row.id}
                      row={row}
                      pct={pct}
                      isOpen={isOpen}
                      childRows={children}
                      color={colorOf(row.id)}
                      onToggle={() => toggleExpanded(row.id)}
                      onNavigate={handleCategoryNav}
                    />
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td className="px-5 py-2.5 text-xs font-semibold text-foreground">Total</td>
                  <td className="px-5 py-2.5 text-xs font-semibold text-right tabular-nums">{formatCurrency(totalA)}</td>
                  <td className="px-5 py-2.5 text-xs font-semibold text-right tabular-nums">{formatCurrency(totalB)}</td>
                  <td className={cn("px-5 py-2.5 text-xs font-semibold text-right tabular-nums", deltaColor(delta))}>
                    {signedCurrency(delta)}
                  </td>
                  <td className={cn("px-5 py-2.5 text-xs font-semibold text-right tabular-nums hidden sm:table-cell", deltaColor(delta))}>
                    {deltaPct !== null ? `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </ChartCard>
      </motion.div>

      {/* Calendar heatmaps */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.35 }}
        className="grid grid-cols-1 xl:grid-cols-2 gap-4"
      >
        {heatA && (
          <ChartCard
            title={`Daily Rhythm — ${periodA.label}`}
            subtitle={`Darker means more spent that day · Click a day for details${heatA.clamped ? " · First 12 months shown" : ""}`}
          >
            <CalendarHeatmap days={daysA} from={heatA.from} to={heatA.to} max={heatMax} onDayClick={setSelectedDay} />
            <HeatmapLegend />
          </ChartCard>
        )}
        {heatB && (
          <ChartCard
            title={`Daily Rhythm — ${periodB.label}`}
            subtitle={`Same colour scale as ${periodA.label}, so intensity is comparable${heatB.clamped ? " · First 12 months shown" : ""}`}
          >
            <CalendarHeatmap days={daysB} from={heatB.from} to={heatB.to} max={heatMax} onDayClick={setSelectedDay} />
            <HeatmapLegend />
          </ChartCard>
        )}
      </motion.div>

      {/* Day detail modal */}
      <AnimatePresence>
        {selectedDay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setSelectedDay(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg max-h-[70vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-5 border-b border-border">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{formatDay(selectedDay)}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {dayTxns.length} transaction{dayTxns.length === 1 ? "" : "s"} · Total: {formatCurrencyExact(dayTotal)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[calc(70vh-80px)]">
                <table className="w-full text-sm">
                  <tbody>
                    {dayTxns.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                        <td className="px-5 py-2.5 text-xs text-foreground max-w-[220px] truncate" title={t.description}>
                          {t.description}
                        </td>
                        <td className="px-5 py-2.5 text-xs hidden sm:table-cell">
                          <button
                            onClick={() => {
                              setSelectedDay(null);
                              handleCategoryNav(t.categoryId);
                            }}
                            className="text-primary hover:text-primary/80 hover:underline transition-colors"
                          >
                            {t.category}
                          </button>
                        </td>
                        <td className={cn("px-5 py-2.5 text-xs font-medium text-right tabular-nums whitespace-nowrap", t.amount < 0 ? "text-eucalyptus" : "text-foreground")}>
                          {formatCurrencyExact(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
      <span>less</span>
      {[0, 0.2, 0.4, 0.65, 1].map((level) => (
        <div
          key={level}
          className="w-[10px] h-[10px] rounded-[2px]"
          style={{
            backgroundColor:
              level === 0
                ? "var(--color-secondary)"
                : `color-mix(in srgb, var(--color-terracotta) ${Math.round(level * 100)}%, var(--color-secondary))`,
          }}
        />
      ))}
      <span>more</span>
    </div>
  );
}

interface DeltaRow {
  id: string;
  name: string;
  a: number;
  b: number;
  delta: number;
}

function GroupRows({
  row, pct, isOpen, childRows, color, onToggle, onNavigate,
}: {
  row: DeltaRow;
  pct: number | null;
  isOpen: boolean;
  childRows: DeltaRow[];
  color: string;
  onToggle: () => void;
  onNavigate: (id: string) => void;
}) {
  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-5 py-2.5 text-xs font-medium text-foreground">
          <div className="flex items-center gap-2">
            <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            {row.name}
          </div>
        </td>
        <td className="px-5 py-2.5 text-xs text-right tabular-nums">{formatCurrency(row.a)}</td>
        <td className="px-5 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.b)}</td>
        <td className={cn("px-5 py-2.5 text-xs font-medium text-right tabular-nums", deltaColor(row.delta))}>
          {signedCurrency(row.delta)}
        </td>
        <td className={cn("px-5 py-2.5 text-xs text-right tabular-nums hidden sm:table-cell", deltaColor(row.delta))}>
          {pct !== null ? `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%` : row.a !== 0 ? "new" : "—"}
        </td>
      </tr>
      {isOpen &&
        childRows.map((child) => (
          <tr key={child.id + child.name} className="border-b border-border/30 bg-secondary/30 hover:bg-accent/50 transition-colors group">
            <td className="pl-12 pr-5 py-2 text-xs text-muted-foreground">
              <button
                onClick={() => onNavigate(child.id)}
                className="flex items-center gap-1 hover:text-primary transition-colors text-left"
              >
                {child.name}
                <ArrowUpRight className="w-3 h-3 text-primary/0 group-hover:text-primary/60 transition-colors shrink-0" />
              </button>
            </td>
            <td className="px-5 py-2 text-xs text-right tabular-nums">{formatCurrency(child.a)}</td>
            <td className="px-5 py-2 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(child.b)}</td>
            <td className={cn("px-5 py-2 text-xs text-right tabular-nums", deltaColor(child.delta))}>
              {signedCurrency(child.delta)}
            </td>
            <td className={cn("px-5 py-2 text-xs text-right tabular-nums hidden sm:table-cell", deltaColor(child.delta))}>
              {child.b !== 0 ? `${child.delta > 0 ? "+" : ""}${((child.delta / Math.abs(child.b)) * 100).toFixed(0)}%` : child.a !== 0 ? "new" : "—"}
            </td>
          </tr>
        ))}
    </>
  );
}

function PeriodPicker({
  label, dotColor, state, onChange, years, months,
}: {
  label: string;
  dotColor: string;
  state: PickerState;
  onChange: (next: PickerState) => void;
  years: string[];
  months: string[];
}) {
  const selectCls =
    "w-full px-2.5 py-2 text-xs font-medium bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer";
  const inputCls =
    "w-full px-2.5 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="bg-secondary/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
          <span className="text-xs font-semibold text-foreground">{label}</span>
        </div>
        {/* Mode switch */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(["year", "month", "range"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChange({ ...state, mode })}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium capitalize transition-colors",
                state.mode === mode
                  ? "bg-primary/10 text-primary"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {mode === "range" ? "Custom" : mode}
            </button>
          ))}
        </div>
      </div>

      {state.mode === "year" && (
        <select value={state.year} onChange={(e) => onChange({ ...state, year: e.target.value })} className={selectCls}>
          {[...years].reverse().map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}
      {state.mode === "month" && (
        <select value={state.month} onChange={(e) => onChange({ ...state, month: e.target.value })} className={selectCls}>
          {/* Include the selected month even if it has no data (e.g. "a year ago" preset) */}
          {(months.includes(state.month) ? months : [state.month, ...months]).map((m) => (
            <option key={m} value={m}>{monthPeriod(m).label}</option>
          ))}
        </select>
      )}
      {state.mode === "range" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={state.from}
            onChange={(e) => onChange({ ...state, from: e.target.value })}
            className={inputCls}
            title="From (inclusive)"
          />
          <input
            type="date"
            value={state.to}
            onChange={(e) => onChange({ ...state, to: e.target.value })}
            className={inputCls}
            title="To (inclusive)"
          />
        </div>
      )}
    </div>
  );
}
