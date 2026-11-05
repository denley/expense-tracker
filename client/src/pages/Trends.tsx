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
import PageBanner from "@/components/PageBanner";
import { formatCurrency, formatCurrencyExact, formatDate, formatPercent, formatAxisDollars, formatMonthYear } from "@/lib/utils";
import { TrendingUp, Repeat, Zap, ArrowUpRight, ArrowUpDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, Legend,
  AreaChart, Area, ComposedChart, ReferenceLine,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import type { Transaction } from "@/lib/types";


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
      <PageBanner title="Trends & Insights" subtitle="Patterns over time, recurring costs and the biggest transactions" />

      {/* Rolling Average + Actual */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <ChartCard
          title="Monthly Actuals vs. Rolling 3-Month Average"
          subtitle="Click a month to drill down into its breakdown"
          viewKey="trends-rolling"
          table={{
            columns: [
              { label: "Month", cell: (r: (typeof rollingAvgData)[number]) => formatMonthYear(r.monthKey) },
              { label: "Spend", align: "right", cell: (r: (typeof rollingAvgData)[number]) => formatCurrency(r.actual) },
              { label: "3-month average", align: "right", cell: (r: (typeof rollingAvgData)[number]) => formatCurrency(r.rolling3m) },
            ],
            rows: [...rollingAvgData].reverse(),
            rowKey: (r: (typeof rollingAvgData)[number]) => r.monthKey,
            onRowClick: (r: (typeof rollingAvgData)[number]) => navigate(`/monthly?month=${r.monthKey}`),
          }}
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
                  tickFormatter={formatAxisDollars}
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
                    value: "Monthly avg",
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
        <ChartCard
          title="Month-over-Month Change"
          subtitle="Click a bar to view that month's breakdown"
          viewKey="trends-mom"
          table={{
            columns: [
              { label: "Month", cell: (r: (typeof momChanges)[number]) => formatMonthYear(r.monthKey) },
              { label: "Spend", align: "right", cell: (r: (typeof momChanges)[number]) => formatCurrency(r.total) },
              {
                label: "Change",
                align: "right",
                cell: (r: (typeof momChanges)[number]) => (
                  <span className={r.change > 0 ? "text-terracotta" : r.change < 0 ? "text-eucalyptus" : "text-muted-foreground"}>
                    {r.change > 0 ? "+" : ""}{formatCurrency(r.change)}
                  </span>
                ),
              },
            ],
            rows: [...momChanges].reverse(),
            rowKey: (r: (typeof momChanges)[number]) => r.monthKey,
            onRowClick: (r: (typeof momChanges)[number]) => navigate(`/monthly?month=${r.monthKey}`),
          }}
        >
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
                  tickFormatter={formatAxisDollars}
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
                        {m.monthsActive} of {monthlyData.length}
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
        <ChartCard title="Trends by Group" subtitle="Monthly spend per top-level category · Click a group to explore it">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {groupTrends.map((g, gi) => (
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
                        <linearGradient id={`spark-grad-${gi}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={g.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={g.color} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={g.color}
                        strokeWidth={1.5}
                        fill={`url(#spark-grad-${gi})`}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </motion.div>

      {/* Merchant transactions */}
      <Dialog open={!!selectedMerchant} onOpenChange={(open) => !open && setSelectedMerchant(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-5 pr-12 border-b border-border text-left">
            <DialogTitle className="text-sm font-semibold break-words">{selectedMerchant}</DialogTitle>
            <DialogDescription className="text-xs">
              {merchantTransactions.length} transactions · Total: {formatCurrencyExact(merchantTotal)}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th
                    className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider"
                    aria-sort={merchantSortField === "date" ? (merchantSortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button onClick={() => toggleMerchantSort("date")} className="flex items-center gap-1 uppercase hover:text-foreground">
                      Date
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Description
                  </th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                    Category
                  </th>
                  <th
                    className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider"
                    aria-sort={merchantSortField === "amount" ? (merchantSortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button onClick={() => toggleMerchantSort("amount")} className="ml-auto flex items-center justify-end gap-1 uppercase hover:text-foreground">
                      Amount
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {merchantTransactions.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
