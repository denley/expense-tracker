/*
  DESIGN: Scandinavian Analytical — Monthly Breakdown
  - Hero banner with monthly image
  - Month selector, stacked bar chart, category table, daily chart
  - Comparison to monthly average
  - Reads ?month= from URL search params for cross-page navigation
  - Category rows link to /categories?category=...
*/
import { useState, useMemo, useEffect } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard from "@/components/ChartCard";
import StatCard from "@/components/StatCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import { formatCurrency, formatCurrencyExact, formatPercent, formatMonthYear } from "@/lib/utils";
import { CHART_HEX_COLORS } from "@/lib/types";
import { Calendar, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend,
  ComposedChart, Line,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663325128704/SA2HSaHwj3kdEwrv6Yi87t/hero-monthly-6DPs6bdQN45W6sqfwd4qms.webp";

export default function Monthly() {
  const { loading, monthlyData, avgMonthlySpend, groupColors, nameOf, analysisTransactions } = useExpenses();
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

  const activeMonth = selectedMonth || monthlyData[monthlyData.length - 1]?.month || "";

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

  const vsAverage = useMemo(() => {
    if (!activeMonthData) return 0;
    return ((activeMonthData.total - avgMonthlySpend) / avgMonthlySpend) * 100;
  }, [activeMonthData, avgMonthlySpend]);

  // Category breakdown for selected month (keys are node ids)
  const categoryBreakdown = useMemo(() => {
    if (!activeMonthData) return [];
    return Object.entries(activeMonthData.categories)
      .map(([id, total]) => ({
        id,
        name: nameOf(id),
        total: Math.round(total),
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

    return Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      total: Math.round(dailyMap.get(i + 1) || 0),
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

  const monthOverMonthChange = useMemo(() => {
    if (!activeMonthData || !prevMonthData) return null;
    return ((activeMonthData.total - prevMonthData.total) / prevMonthData.total) * 100;
  }, [activeMonthData, prevMonthData]);

  const handleCategoryClick = (categoryId: string) => {
    navigate(`/categories?category=${encodeURIComponent(categoryId)}`);
  };

  const handleCompositionClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload?.month) {
      setSelectedMonth(data.activePayload[0].payload.month);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative rounded-2xl overflow-hidden h-[180px] lg:h-[200px]"
      >
        <img src={HERO_IMG} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#2d3436]/80 via-[#2d3436]/50 to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-center px-6 lg:px-10">
          <h2 className="text-2xl lg:text-3xl font-bold text-white tracking-tight">
            Monthly Breakdown
          </h2>
          <p className="text-white/70 text-sm mt-2">
            Drill into each month's spending composition
          </p>
        </div>
      </motion.div>

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
          label={formatMonthYear(activeMonth)}
          value={formatCurrency(activeMonthData?.total || 0)}
          subtitle={`${activeMonthData?.count || 0} transactions`}
          icon={<Calendar className="w-4 h-4" />}
        />
        <StatCard
          label="vs. Monthly Average"
          value={`${vsAverage >= 0 ? "+" : ""}${formatPercent(vsAverage)}`}
          subtitle={`Avg: ${formatCurrency(avgMonthlySpend)}`}
          icon={vsAverage >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        />
        <StatCard
          label="vs. Previous Month"
          value={monthOverMonthChange !== null ? `${monthOverMonthChange >= 0 ? "+" : ""}${formatPercent(monthOverMonthChange)}` : "N/A"}
          subtitle={prevMonthData ? `${prevMonthData.label}: ${formatCurrency(prevMonthData.total)}` : "No prior month"}
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <StatCard
          label="Daily Average"
          value={formatCurrency((activeMonthData?.total || 0) / (dailySpending.length || 1))}
          subtitle={`${dailySpending.filter((d) => d.total > 0).length} active days`}
        />
      </motion.div>

      {/* Stacked Monthly + Daily Spending */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <ChartCard title="Monthly Composition by Group" subtitle="Click a month to select it">
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
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
          <ChartCard title={`Daily Spending — ${formatMonthYear(activeMonth)}`} subtitle="Day-by-day breakdown">
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailySpending}>
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
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Daily Spend" fill="#c17c5e" radius={[3, 3, 0, 0]} opacity={0.8} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Trend"
                    stroke="#4a7c8a"
                    strokeWidth={1.5}
                    dot={false}
                    opacity={0.5}
                  />
                </ComposedChart>
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
                {categoryBreakdown.map((c, i) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer group"
                    onClick={() => handleCategoryClick(c.id)}
                  >
                    <td className="px-5 py-2.5 text-xs font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CHART_HEX_COLORS[i % CHART_HEX_COLORS.length] }}
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
                            backgroundColor: CHART_HEX_COLORS[i % CHART_HEX_COLORS.length],
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
