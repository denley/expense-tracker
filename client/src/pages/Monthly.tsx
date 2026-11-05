/*
  DESIGN: Scandinavian Analytical — Monthly Breakdown
  - Hero banner with monthly image
  - Month selector, stacked bar chart, category table, daily chart
  - Comparison to monthly average. Opens on the last finished month; the
    current month is "so far" and is compared over the same elapsed days
  - Reads ?month= from URL search params for cross-page navigation
  - Category rows link to /categories?category=...
*/
import { useState, useMemo, useEffect } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard, { ColorLabel } from "@/components/ChartCard";
import StatCard from "@/components/StatCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import PageBanner from "@/components/PageBanner";
import { formatCurrency, formatCurrencyExact, formatPercent, formatMonthYear, formatAxisDollars } from "@/lib/utils";
import type { MonthlyData } from "@/lib/types";
import { Calendar, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";


export default function Monthly() {
  const {
    loading, monthlyData, avgMonthlySpend, groupColors, nameOf, colorOf, analysisTransactions,
  } = useExpenses();
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [location, navigate] = useLocation();

  // Read URL search params for cross-page navigation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const monthParam = params.get("month");
    if (monthParam && monthlyData.some((m) => m.month === monthParam)) {
      setSelectedMonth(monthParam);
    }
  }, [location, monthlyData]);

  // Open on the last finished month: a few days into a month, its total says little
  const defaultMonth =
    [...monthlyData].reverse().find((m) => !m.partial)?.month ?? monthlyData[monthlyData.length - 1]?.month ?? "";
  const activeMonth = selectedMonth || defaultMonth;

  const activeMonthData = useMemo(
    () => monthlyData.find((m) => m.month === activeMonth),
    [monthlyData, activeMonth]
  );

  // Filtered list, so the row count matches the month totals from monthlyData
  const monthTransactions = useMemo(
    () => analysisTransactions.filter((t) => {
      const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      return key === activeMonth;
    }),
    [analysisTransactions, activeMonth]
  );

  // For the current month, compare like with like: the days elapsed so far
  const partial = !!activeMonthData?.partial;
  const daysInActiveMonth = useMemo(() => {
    if (!activeMonth) return 0;
    const [year, month] = activeMonth.split("-").map(Number);
    return new Date(year, month, 0).getDate();
  }, [activeMonth]);
  const elapsedDays = partial ? new Date().getDate() : daysInActiveMonth;

  // What a month usually comes to: the monthly average, or for the current
  // month the average of what finished months had spent by the same day
  // (bills cluster early in a month, so a pro-rated average would mislead)
  const expectedSoFar = useMemo(() => {
    if (!partial) return avgMonthlySpend;
    const full = new Set(monthlyData.filter((m) => !m.partial && m.count > 0).map((m) => m.month));
    if (full.size === 0) return 0;
    let sum = 0;
    for (const t of analysisTransactions) {
      const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      if (full.has(key) && t.date.getDate() <= elapsedDays) sum += t.amount;
    }
    return sum / full.size;
  }, [partial, avgMonthlySpend, monthlyData, analysisTransactions, elapsedDays]);

  const vsAverage = useMemo(() => {
    if (!activeMonthData || expectedSoFar <= 0) return null;
    return ((activeMonthData.total - expectedSoFar) / expectedSoFar) * 100;
  }, [activeMonthData, expectedSoFar]);

  // Category breakdown for selected month (keys are node ids)
  const categoryBreakdown = useMemo(() => {
    if (!activeMonthData) return [];
    return Object.entries(activeMonthData.categories)
      .map(([id, total]) => ({
        id,
        name: nameOf(id),
        total,
        count: monthTransactions.filter((t) => t.categoryId === id).length,
        pct: (total / activeMonthData.total) * 100,
      }))
      .sort((a, b) => b.total - a.total);
  }, [activeMonthData, monthTransactions, nameOf]);

  // Daily spending for selected month
  const dailySpending = useMemo(() => {
    if (!activeMonth) return [];
    const [year, month] = activeMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyMap = new Map<number, number>();

    for (const t of monthTransactions) {
      const day = t.date.getDate();
      dailyMap.set(day, (dailyMap.get(day) || 0) + t.amount);
    }

    // The current month stops at today rather than drawing empty future days
    const today = new Date();
    const isCurrent = today.getFullYear() === year && today.getMonth() + 1 === month;
    return Array.from({ length: isCurrent ? today.getDate() : daysInMonth }, (_, i) => ({
      day: i + 1,
      total: Math.round(dailyMap.get(i + 1) || 0),
      exact: dailyMap.get(i + 1) || 0,
    }));
  }, [monthTransactions, activeMonth]);

  // Stacked bar: monthly data with group breakdown (all groups seen in scope)
  const stackedGroups = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of monthlyData) {
      for (const [g, v] of Object.entries(m.groups)) {
        totals.set(g, (totals.get(g) || 0) + v);
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => g);
  }, [monthlyData]);

  const stackedMonthlyData = useMemo(() => {
    return monthlyData.map((m) => {
      const row: Record<string, string | number> = { name: m.label, month: m.month };
      for (const g of stackedGroups) {
        row[g] = Math.round(m.groups[g] || 0);
      }
      return row;
    });
  }, [monthlyData, stackedGroups]);

  // Previous month comparison
  const prevMonthData = useMemo(() => {
    const idx = monthlyData.findIndex((m) => m.month === activeMonth);
    return idx > 0 ? monthlyData[idx - 1] : null;
  }, [monthlyData, activeMonth]);

  // Previous month's spend over the same days (all of it, unless this month is partial)
  const prevComparable = useMemo(() => {
    if (!prevMonthData) return null;
    if (!partial) return prevMonthData.total;
    return analysisTransactions
      .filter((t) => {
        const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
        return key === prevMonthData.month && t.date.getDate() <= elapsedDays;
      })
      .reduce((s, t) => s + t.amount, 0);
  }, [prevMonthData, partial, analysisTransactions, elapsedDays]);

  const monthOverMonthChange = useMemo(() => {
    if (!activeMonthData || prevComparable === null || prevComparable <= 0) return null;
    return ((activeMonthData.total - prevComparable) / prevComparable) * 100;
  }, [activeMonthData, prevComparable]);

  // The category for this month (Categories keeps the period)
  const handleCategoryClick = (categoryId: string) => {
    navigate(`/categories?category=${encodeURIComponent(categoryId)}&month=${activeMonth}`);
  };

  const handleCompositionClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload?.month) {
      setSelectedMonth(data.activePayload[0].payload.month);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageBanner title="Monthly Breakdown" subtitle="Each month's spending, by group and by category" />

      {/* Month Selector */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="bg-card rounded-xl border border-border p-4">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
            Select Month
          </label>
          <div className="flex flex-wrap gap-2">
            {monthlyData.map((m) => (
              <button
                key={m.month}
                onClick={() => setSelectedMonth(m.month)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  m.month === activeMonth
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-accent"
                }`}
              >
                {m.label}
                {m.partial && <span className="ml-1 opacity-70">(so far)</span>}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          label={partial ? `${formatMonthYear(activeMonth)} so far` : formatMonthYear(activeMonth)}
          value={formatCurrency(activeMonthData?.total || 0)}
          subtitle={`${activeMonthData?.count || 0} transactions${partial ? ` · ${elapsedDays} of ${daysInActiveMonth} days` : ""}`}
          icon={<Calendar className="w-4 h-4" />}
        />
        <StatCard
          label="vs. Monthly Average"
          value={vsAverage !== null ? `${vsAverage >= 0 ? "+" : ""}${formatPercent(vsAverage)}` : "—"}
          subtitle={
            partial
              ? `Avg by day ${elapsedDays} of a month: ${formatCurrency(expectedSoFar)}`
              : `Avg: ${formatCurrency(avgMonthlySpend)}`
          }
          icon={vsAverage !== null && vsAverage < 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="vs. Previous Month"
          value={monthOverMonthChange !== null ? `${monthOverMonthChange >= 0 ? "+" : ""}${formatPercent(monthOverMonthChange)}` : "—"}
          subtitle={
            prevMonthData && prevComparable !== null
              ? partial
                ? `${prevMonthData.label}, days 1–${elapsedDays}: ${formatCurrency(prevComparable)}`
                : `${prevMonthData.label}: ${formatCurrency(prevComparable)}`
              : "No prior month"
          }
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <StatCard
          label="Daily Average"
          value={formatCurrency((activeMonthData?.total || 0) / (elapsedDays || 1))}
          subtitle={`${dailySpending.filter((d) => d.total > 0).length} days with spending${partial ? " so far" : ""}`}
        />
      </motion.div>

      {/* Stacked Monthly + Daily Spending */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <ChartCard
            title="Monthly Composition by Group"
            subtitle="Click a month to select it"
            viewKey="monthly-composition"
            table={{
              columns: [
                { label: "Month", cell: (m: MonthlyData) => `${m.label}${m.partial ? " (so far)" : ""}` },
                { label: "Spend", align: "right", cell: (m: MonthlyData) => formatCurrencyExact(m.total) },
                {
                  label: "Largest group",
                  cell: (m: MonthlyData) => {
                    const top = Object.entries(m.groups).sort((a, b) => b[1] - a[1])[0];
                    return top ? (
                      <ColorLabel color={groupColors[top[0]]}>
                        {top[0]} <span className="text-muted-foreground tabular-nums">{formatCurrency(top[1])}</span>
                      </ColorLabel>
                    ) : "—";
                  },
                },
              ],
              rows: [...monthlyData].reverse(),
              rowKey: (m: MonthlyData) => m.month,
              onRowClick: (m: MonthlyData) => setSelectedMonth(m.month),
            }}
          >
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stackedMonthlyData} barCategoryGap="15%" onClick={handleCompositionClick} className="cursor-pointer">
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
                    tickFormatter={formatAxisDollars}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  />
                  {stackedGroups.map((group) => (
                    <Bar key={group} dataKey={group} stackId="a" fill={groupColors[group]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <ChartCard
            viewKey="monthly-daily"
            table={{
              columns: [
                {
                  label: "Day",
                  cell: (d: { day: number }) => {
                    const [y, mo] = activeMonth.split("-").map(Number);
                    return new Date(y, mo - 1, d.day).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
                  },
                },
                { label: "Spend", align: "right", cell: (d: { exact: number }) => (d.exact ? formatCurrencyExact(d.exact) : "—") },
              ],
              rows: dailySpending,
              rowKey: (d: { day: number }) => String(d.day),
            }}
            title={`Daily Spending — ${formatMonthYear(activeMonth)}`}
            subtitle={partial ? `Day-by-day breakdown, up to today` : "Day-by-day breakdown"}
          >
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySpending}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={formatAxisDollars}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Daily Spend" fill="#c17c5e" radius={[3, 3, 0, 0]} opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>
      </div>

      {/* Category Breakdown Table — rows are clickable to navigate to Categories page */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <ChartCard
          title={`Category Breakdown — ${formatMonthYear(activeMonth)}`}
          subtitle={`${categoryBreakdown.length} categories with spending · Click a row to explore`}
        >
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                    Count
                  </th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Share
                  </th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell w-[200px]">
                    Bar
                  </th>
                </tr>
              </thead>
              <tbody>
                {categoryBreakdown.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer group"
                    onClick={() => handleCategoryClick(c.id)}
                  >
                    <td className="px-5 py-2.5 text-xs font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: colorOf(c.id) }}
                        />
                        <span className="group-hover:text-primary transition-colors">{c.name}</span>
                        <span className="text-primary/0 group-hover:text-primary/60 transition-colors text-[10px]">→</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-xs font-medium text-right tabular-nums">
                      {formatCurrencyExact(c.total)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground text-right tabular-nums hidden sm:table-cell">
                      {c.count}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground text-right tabular-nums">
                      {formatPercent(c.pct)}
                    </td>
                    <td className="px-5 py-2.5 hidden lg:table-cell">
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(c.pct * 2, 100)}%`,
                            backgroundColor: colorOf(c.id),
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </motion.div>
    </div>
  );
}
