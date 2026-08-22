/*
  DESIGN: Scandinavian Analytical — Trends & Insights
  - Hero banner with trends image
  - Rolling average, MoM changes, biggest transactions, recurring detection
  - Group sparklines
  - INTERACTIVE: Category/group links navigate to detail pages
  - Recurring merchant click opens a modal showing all transactions for that merchant
  - Description column shows actual description, not notes
*/
import { useState, useMemo, useCallback } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard from "@/components/ChartCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import { formatCurrency, formatCurrencyExact, formatDate, formatPercent } from "@/lib/utils";
import { TrendingUp, Repeat, Zap, ArrowUpRight, X, ArrowUpDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, Legend,
  AreaChart, Area, ComposedChart, ReferenceLine,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import type { Transaction } from "@/lib/types";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663325128704/SA2HSaHwj3kdEwrv6Yi87t/hero-trends-2xQXBkMzyXx66hXLnF7Eio.webp";

export default function Trends() {
  const { loading, monthlyData, groupData, avgMonthlySpend, groupColors, analysisTransactions } = useExpenses();
  const [, navigate] = useLocation();
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(null);
  const [merchantSortField, setMerchantSortField] = useState<"date" | "amount">("date");
  const [merchantSortDir, setMerchantSortDir] = useState<"asc" | "desc">("desc");

  // Month-over-month changes (waterfall)
  const momChanges = useMemo(() => {
    return monthlyData.map((m, i) => {
      const prev = i > 0 ? monthlyData[i - 1].total : m.total;
      const change = m.total - prev;
      const pctChange = prev > 0 ? (change / prev) * 100 : 0;
      return {
        name: m.label,
        total: Math.round(m.total),
        change: Math.round(change),
        pctChange: Math.round(pctChange),
        positive: change >= 0,
        monthKey: m.month,
      };
    });
  }, [monthlyData]);

  // Rolling 3-month average
  const rollingAvgData = useMemo(() => {
    return monthlyData.map((m, i) => {
      const start = Math.max(0, i - 2);
      const window = monthlyData.slice(start, i + 1);
      const avg = window.reduce((s, w) => s + w.total, 0) / window.length;
      return {
        name: m.label,
        actual: Math.round(m.total),
        rolling3m: Math.round(avg),
        average: Math.round(avgMonthlySpend),
        monthKey: m.month,
      };
    });
  }, [monthlyData, avgMonthlySpend]);

  // Top 10 biggest transactions
  const biggestTransactions = useMemo(
    () => [...analysisTransactions]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10),
    [analysisTransactions]
  );

  // Recurring merchant detection — keyed on description
  const recurringMerchants = useMemo(() => {
    const merchantMap = new Map<string, { months: Set<string>; total: number; count: number; category: string; matchKey: string }>();
    for (const t of analysisTransactions) {
      const key = t.description;
      const cleanKey = key.length > 50 ? key.substring(0, 50) : key;
      if (!merchantMap.has(cleanKey)) {
        merchantMap.set(cleanKey, { months: new Set(), total: 0, count: 0, category: t.category, matchKey: cleanKey });
      }
      const m = merchantMap.get(cleanKey)!;
      const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      m.months.add(monthKey);
      m.total += t.amount;
      m.count += 1;
    }
    return Array.from(merchantMap.entries())
      .filter(([_, data]) => data.months.size >= 6)
      .map(([name, data]) => ({
        name,
        monthsActive: data.months.size,
        total: data.total,
        avgPerMonth: data.total / data.months.size,
        count: data.count,
        category: data.category,
        matchKey: data.matchKey,
      }))
      .sort((a, b) => b.monthsActive - a.monthsActive || b.total - a.total);
  }, [analysisTransactions]);

  // Get transactions for a selected merchant
  const merchantTransactions = useMemo(() => {
    if (!selectedMerchant) return [];
    const txns = analysisTransactions.filter((t) => {
      const key = t.description;
      const cleanKey = key.length > 50 ? key.substring(0, 50) : key;
      return cleanKey === selectedMerchant;
    });
    return [...txns].sort((a, b) => {
      if (merchantSortField === "date") {
        return merchantSortDir === "desc"
          ? b.date.getTime() - a.date.getTime()
          : a.date.getTime() - b.date.getTime();
      }
      return merchantSortDir === "desc" ? b.amount - a.amount : a.amount - b.amount;
    });
  }, [analysisTransactions, selectedMerchant, merchantSortField, merchantSortDir]);

  const merchantTotal = useMemo(
    () => merchantTransactions.reduce((s, t) => s + t.amount, 0),
    [merchantTransactions]
  );

  // Group trends (sparkline data)
  const groupTrends = useMemo(() => {
    return groupData
      .filter((g) => g.total > 0)
      .map((g) => {
        const monthlyTotals = monthlyData.map((m) => ({
          name: m.label,
          value: Math.round(m.groups[g.name] || 0),
        }));
        const trend = monthlyTotals.length >= 2
          ? monthlyTotals[monthlyTotals.length - 1].value - monthlyTotals[0].value
          : 0;
        return {
          id: g.id,
          name: g.name,
          total: g.total,
          data: monthlyTotals,
          trend,
          color: groupColors[g.name] || "#8e8ea0",
        };
      });
  }, [groupData, monthlyData, groupColors]);

  // Navigation handlers
  const handleRollingChartClick = useCallback((data: any) => {
    if (data?.activePayload?.[0]?.payload?.monthKey) {
      navigate(`/monthly?month=${data.activePayload[0].payload.monthKey}`);
    }
  }, [navigate]);

  const handleMomClick = useCallback((data: any) => {
    if (data?.activePayload?.[0]?.payload?.monthKey) {
      navigate(`/monthly?month=${data.activePayload[0].payload.monthKey}`);
    }
  }, [navigate]);

  const handleCategoryNav = useCallback((categoryId: string) => {
    navigate(`/categories?category=${encodeURIComponent(categoryId)}`);
  }, [navigate]);

  const toggleMerchantSort = (field: "date" | "amount") => {
    if (merchantSortField === field) {
      setMerchantSortDir(merchantSortDir === "desc" ? "asc" : "desc");
    } else {
      setMerchantSortField(field);
      setMerchantSortDir("desc");
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
            Trends & Insights
          </h2>
          <p className="text-white/70 text-sm mt-2">
            Patterns, recurring costs, and year-over-year trends
          </p>
        </div>
      </motion.div>

      {/* Rolling Average + Actual */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <ChartCard
          title="Monthly Actuals vs. Rolling 3-Month Average"
          subtitle="Click a month to drill down into its breakdown"
        >
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rollingAvgData} onClick={handleRollingChartClick} className="cursor-pointer">
                <defs>
                  <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#55a38b" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#55a38b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Monthly Actual"
                  stroke="#55a38b"
                  strokeWidth={2}
                  fill="url(#actualGrad)"
                />
                <Line
                  type="monotone"
                  dataKey="rolling3m"
                  name="3-Month Rolling Avg"
                  stroke="#c17c5e"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#c17c5e" }}
                />
                <ReferenceLine
                  y={Math.round(avgMonthlySpend)}
                  stroke="#8e8ea0"
                  strokeDasharray="6 4"
                  label={{
                    value: "Annual Avg",
                    position: "insideTopRight",
                    fill: "#8e8ea0",
                    fontSize: 10,
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </motion.div>

      {/* MoM Changes */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <ChartCard title="Month-over-Month Change" subtitle="Click a bar to view that month's breakdown">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={momChanges.slice(1)} barCategoryGap="20%" onClick={handleMomClick} className="cursor-pointer">
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
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="var(--color-border)" />
                <Bar dataKey="change" name="Change" radius={[4, 4, 4, 4]}>
                  {momChanges.slice(1).map((entry, i) => (
                    <Cell key={i} fill={entry.positive ? "#c17c5e" : "#55a38b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </motion.div>

      {/* Biggest Transactions + Recurring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <ChartCard title="Top 10 Biggest Transactions" subtitle="Click a category to explore">
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                    <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Category</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {biggestTransactions.map((t, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                      <td className="px-5 py-2 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-5 py-2 text-xs text-foreground max-w-[180px] truncate" title={`${t.description}${t.notes ? ` — ${t.notes}` : ""}`}>
                        {t.description}
                      </td>
                      <td className="px-5 py-2 text-xs hidden sm:table-cell">
                        <button
                          onClick={() => handleCategoryNav(t.categoryId)}
                          className="text-primary hover:text-primary/80 hover:underline transition-colors"
                        >
                          {t.category}
                        </button>
                      </td>
                      <td className="px-5 py-2 text-xs font-semibold text-right tabular-nums text-foreground">
                        {formatCurrencyExact(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <ChartCard
            title="Recurring Expenses"
            subtitle={`Merchants appearing in 6+ months (${recurringMerchants.length} found) · Click to view transactions`}
          >
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Merchant</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Months</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Avg/Mo</th>
                  </tr>
                </thead>
                <tbody>
                  {recurringMerchants.slice(0, 15).map((m, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer group"
                      onClick={() => {
                        setSelectedMerchant(m.matchKey);
                        setMerchantSortField("date");
                        setMerchantSortDir("desc");
                      }}
                    >
                      <td className="px-5 py-2 text-xs text-foreground max-w-[180px] truncate">
                        <div className="flex items-center gap-1.5">
                          <Repeat className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="group-hover:text-primary transition-colors">{m.name}</span>
                          <ArrowUpRight className="w-3 h-3 text-primary/0 group-hover:text-primary/60 transition-colors shrink-0" />
                        </div>
                      </td>
                      <td className="px-5 py-2 text-xs text-muted-foreground text-right tabular-nums">
                        {m.monthsActive}/12
                      </td>
                      <td className="px-5 py-2 text-xs font-medium text-right tabular-nums">
                        {formatCurrency(m.total)}
                      </td>
                      <td className="px-5 py-2 text-xs text-muted-foreground text-right tabular-nums hidden sm:table-cell">
                        {formatCurrency(m.avgPerMonth)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </motion.div>
      </div>

      {/* Group Trend Sparklines — clickable to navigate to categories filtered by group */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <ChartCard title="Group Trends Over the Year" subtitle="Click a group to explore its categories">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {groupTrends.map((g) => (
              <div
                key={g.id}
                className="bg-secondary/50 rounded-lg p-3 cursor-pointer hover:bg-secondary/80 hover:shadow-sm transition-all group"
                onClick={() => handleCategoryNav(g.id)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{g.name}</span>
                  <span className="tabular-nums text-xs font-semibold" style={{ color: g.color }}>
                    {formatCurrency(g.total)}
                  </span>
                </div>
                <div className="h-[60px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={g.data}>
                      <defs>
                        <linearGradient id={`grad-${g.name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={g.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={g.color} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={g.color}
                        strokeWidth={1.5}
                        fill={`url(#grad-${g.name})`}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </motion.div>

      {/* Merchant Transaction Modal */}
      <AnimatePresence>
        {selectedMerchant && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setSelectedMerchant(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between p-5 border-b border-border">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{selectedMerchant}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {merchantTransactions.length} transactions · Total: {formatCurrencyExact(merchantTotal)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedMerchant(null)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border">
                      <th
                        className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                        onClick={() => toggleMerchantSort("date")}
                      >
                        <span className="flex items-center gap-1">
                          Date
                          <ArrowUpDown className="w-3 h-3" />
                        </span>
                      </th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Description
                      </th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                        Category
                      </th>
                      <th
                        className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                        onClick={() => toggleMerchantSort("amount")}
                      >
                        <span className="flex items-center justify-end gap-1">
                          Amount
                          <ArrowUpDown className="w-3 h-3" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {merchantTransactions.map((t, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                        <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDate(t.date)}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-foreground max-w-[200px] truncate" title={t.description}>
                          {t.description}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                          {t.category}
                        </td>
                        <td className={`px-5 py-2.5 text-xs font-medium text-right whitespace-nowrap tabular-nums ${t.amount < 0 ? "text-eucalyptus" : "text-foreground"}`}>
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
