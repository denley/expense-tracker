/*
  DESIGN: Scandinavian Analytical — Dashboard Overview
  - Hero banner with generated image, KPI stat cards
  - Monthly trend bar chart, group doughnut, category horizontal bars
  - Warm natural palette, paper-like cards
  - INTERACTIVE: All chart elements are clickable for cross-page navigation
    - Monthly bars → /monthly?month=2025-XX
    - Group doughnut segments → /categories?group=XXX
    - Category bars → /categories?category=XXX
    - Cumulative chart → /monthly?month=2025-XX
    - Top Category KPI → /categories?category=XXX
*/
import { useMemo, useCallback } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import StatCard from "@/components/StatCard";
import ChartCard from "@/components/ChartCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import { formatCurrency, formatCurrencyExact, formatPercent } from "@/lib/utils";
import { CHART_HEX_COLORS } from "@/lib/types";
import { DollarSign, ShoppingCart, TrendingUp, Receipt, UploadCloud, FolderKanban } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area, ReferenceLine,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663325128704/SA2HSaHwj3kdEwrv6Yi87t/hero-dashboard-athhbv2VmJKH3Q4nBmSvqg.webp";

export default function Dashboard() {
  const {
    transactions, loading, totalSpend, monthlyData, categoryData, groupData,
    avgMonthlySpend, yearScope, projects, allTransactions, groupColors,
  } = useExpenses();
  const [, navigate] = useLocation();

  const topCategory = useMemo(() => categoryData[0], [categoryData]);

  const highestMonth = useMemo(
    () => monthlyData.reduce((max, m) => (m.total > max.total ? m : max), monthlyData[0]),
    [monthlyData]
  );

  const lowestMonth = useMemo(
    () => monthlyData.reduce((min, m) => (m.total < min.total ? m : min), monthlyData[0]),
    [monthlyData]
  );

  const dailyAvg = useMemo(() => {
    if (transactions.length === 0) return 0;
    const first = transactions[0].date.getTime();
    const last = transactions[transactions.length - 1].date.getTime();
    const days = Math.max(1, Math.round((last - first) / 86400000) + 1);
    return totalSpend / days;
  }, [totalSpend, transactions]);

  const activeProjects = useMemo(() => {
    const active = projects.filter((p) => p.status === "active");
    return active.map((p) => {
      let total = 0;
      let count = 0;
      for (const t of allTransactions) {
        if (t.group === p.name) {
          total += t.amount;
          count++;
        }
      }
      return { ...p, total, count };
    });
  }, [projects, allTransactions]);

  // With a single year of data, "all time" is just that year — label it as such
  const years = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.getFullYear()));
    return Array.from(set);
  }, [transactions]);
  const scopeLabel =
    yearScope !== "all" ? yearScope : years.length === 1 ? String(years[0]) : "All-Time";

  const monthlyChartData = useMemo(
    () => monthlyData.map((m) => ({
      name: m.label,
      total: Math.round(m.total),
      monthKey: m.month,
    })),
    [monthlyData]
  );

  const groupChartData = useMemo(
    () => groupData
      .filter((g) => g.total > 0)
      .map((g) => ({
        name: g.name,
        value: Math.round(g.total),
        color: groupColors[g.name] || "#8e8ea0",
      })),
    [groupData, groupColors]
  );

  const top15Categories = useMemo(
    () => categoryData.slice(0, 15).map((c, i) => ({
      name: c.name,
      total: Math.round(c.total),
      count: c.count,
      fill: CHART_HEX_COLORS[i % CHART_HEX_COLORS.length],
    })),
    [categoryData]
  );

  const cumulativeData = useMemo(() => {
    let cumulative = 0;
    return monthlyData.map((m) => {
      cumulative += m.total;
      return {
        name: m.label,
        cumulative: Math.round(cumulative),
        monthKey: m.month,
      };
    });
  }, [monthlyData]);

  // Navigation handlers
  const handleMonthClick = useCallback((data: any) => {
    if (data?.activePayload?.[0]?.payload?.monthKey) {
      navigate(`/monthly?month=${data.activePayload[0].payload.monthKey}`);
    }
  }, [navigate]);

  const handleGroupClick = useCallback((data: any) => {
    if (data?.name) {
      navigate(`/categories?group=${encodeURIComponent(data.name)}`);
    }
  }, [navigate]);

  const handleCategoryClick = useCallback((data: any) => {
    if (data?.activePayload?.[0]?.payload?.name) {
      navigate(`/categories?category=${encodeURIComponent(data.activePayload[0].payload.name)}`);
    }
  }, [navigate]);

  const handleCumulativeClick = useCallback((data: any) => {
    if (data?.activePayload?.[0]?.payload?.monthKey) {
      navigate(`/monthly?month=${data.activePayload[0].payload.monthKey}`);
    }
  }, [navigate]);

  const handleTopCategoryClick = useCallback(() => {
    if (topCategory) {
      navigate(`/categories?category=${encodeURIComponent(topCategory.name)}`);
    }
  }, [navigate, topCategory]);

  if (loading) return <LoadingState />;

  // Empty state — fresh install with no data
  if (transactions.length === 0) {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-2xl p-14 text-center"
        >
          <UploadCloud className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-bold text-foreground">No transactions yet</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Import a CSV export from your bank to get started. Columns and date formats are
            detected automatically, and you can save the mapping as a profile for next time.
          </p>
          <button
            onClick={() => navigate("/import")}
            className="mt-5 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            Import your first CSV
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative rounded-2xl overflow-hidden h-[200px] lg:h-[240px]"
      >
        <img
          src={HERO_IMG}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#2d3436]/80 via-[#2d3436]/50 to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-center px-6 lg:px-10">
          <h2 className="text-2xl lg:text-3xl font-bold text-white tracking-tight">
            {scopeLabel} Spending Overview
          </h2>
          <p className="text-white/70 text-sm mt-2 max-w-md">
            {transactions.length} transactions across {categoryData.length} categories,
            totalling {formatCurrency(totalSpend)}.
          </p>
        </div>
      </motion.div>

      {/* Active projects snapshot */}
      {activeProjects.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {activeProjects.slice(0, 4).map((p) => {
            const over = p.budget ? p.total > p.budget : false;
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/projects?project=${p.id}`)}
                className="bg-card rounded-xl border border-border p-4 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2 mb-1.5 min-w-0">
                  <FolderKanban className="w-3.5 h-3.5 shrink-0" style={{ color: p.color }} />
                  <span className="text-xs font-semibold truncate">{p.name}</span>
                </div>
                <div className="text-lg font-semibold tabular-nums">{formatCurrency(p.total)}</div>
                {p.budget ? (
                  <div className="mt-2">
                    <div className="w-full bg-secondary rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${Math.min((p.total / p.budget) * 100, 100)}%`,
                          backgroundColor: over ? "#c0392b" : p.color,
                        }}
                      />
                    </div>
                    <p className={`text-[10px] mt-1 ${over ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {over
                        ? `${formatCurrency(p.total - p.budget)} over budget`
                        : `${formatCurrency(p.budget - p.total)} of ${formatCurrency(p.budget)} left`}
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground mt-1">{p.count} transactions</p>
                )}
              </div>
            );
          })}
        </motion.div>
      )}

      {/* KPI Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          label="Total Spend"
          value={formatCurrency(totalSpend)}
          subtitle={yearScope === "all" ? "All time" : `Year ${yearScope}`}
          icon={<DollarSign className="w-4 h-4" />}
        />
        <StatCard
          label="Monthly Average"
          value={formatCurrency(avgMonthlySpend)}
          subtitle={`Daily avg: ${formatCurrency(dailyAvg)}`}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="Transactions"
          value={transactions.length.toString()}
          subtitle={`Avg ${formatCurrencyExact(totalSpend / transactions.length)} each`}
          icon={<Receipt className="w-4 h-4" />}
        />
        <StatCard
          label="Top Category"
          value={topCategory?.name || "—"}
          subtitle={topCategory ? `${formatCurrency(topCategory.total)} (${formatPercent((topCategory.total / totalSpend) * 100)})` : ""}
          icon={<ShoppingCart className="w-4 h-4" />}
          onClick={handleTopCategoryClick}
        />
      </motion.div>

      {/* Monthly Trend + Group Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-2"
        >
          <ChartCard
            title="Monthly Spending"
            subtitle={`Highest: ${highestMonth?.label} (${formatCurrency(highestMonth?.total || 0)}) · Lowest: ${lowestMonth?.label} (${formatCurrency(lowestMonth?.total || 0)}) · Click a bar to drill down`}
          >
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyChartData}
                  barCategoryGap="20%"
                  onClick={handleMonthClick}
                  className="cursor-pointer"
                >
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
                  <ReferenceLine
                    y={Math.round(avgMonthlySpend)}
                    stroke="#c9a96e"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    label={{
                      value: `Avg: $${(avgMonthlySpend / 1000).toFixed(1)}k`,
                      position: "right",
                      fontSize: 11,
                      fill: "#c9a96e",
                      fontWeight: 600,
                    }}
                  />
                  <Bar dataKey="total" name="Spend" fill="#55a38b" radius={[4, 4, 0, 0]} />
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
          <ChartCard title="Spending by Group" subtitle="Click a segment to explore categories">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={groupChartData}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    onClick={handleGroupClick}
                    className="cursor-pointer"
                  >
                    {groupChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px", cursor: "pointer" }}
                    onClick={(e: any) => {
                      if (e?.value) {
                        navigate(`/categories?group=${encodeURIComponent(e.value)}`);
                      }
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>
      </div>

      {/* Category Breakdown + Cumulative */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="lg:col-span-2"
        >
          <ChartCard title="Top 15 Categories" subtitle="Click a bar to view category details">
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top15Categories}
                  layout="vertical"
                  barCategoryGap="12%"
                  onClick={handleCategoryClick}
                  className="cursor-pointer"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={130}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]}>
                    {top15Categories.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <ChartCard title="Cumulative Spend" subtitle="Click a point to view that month">
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={cumulativeData}
                  onClick={handleCumulativeClick}
                  className="cursor-pointer"
                >
                  <defs>
                    <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#55a38b" stopOpacity={0.3} />
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
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative"
                    stroke="#55a38b"
                    strokeWidth={2}
                    fill="url(#cumGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>
      </div>
    </div>
  );
}
