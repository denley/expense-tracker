/*
  DESIGN: Scandinavian Analytical — Category Deep Dive
  - Hero banner with categories image
  - Category selector with optgroups by group, plus group-level and "All" options
  - Monthly trend, top merchants, transaction table
  - Reads ?category= or ?group= from URL search params for cross-page navigation
*/
import { useState, useMemo, useEffect } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard from "@/components/ChartCard";
import StatCard from "@/components/StatCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import { formatCurrency, formatCurrencyExact, formatPercent, formatDate } from "@/lib/utils";
import { CHART_HEX_COLORS } from "@/lib/types";
import { Tags, Hash, TrendingUp, ArrowUpDown, Search, Layers, Settings2 } from "lucide-react";
import ManageCategoriesDialog from "@/components/ManageCategoriesDialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663325128704/SA2HSaHwj3kdEwrv6Yi87t/hero-categories-nKaX5EdJLEgSi5mB7M9UuF.webp";

// Selection can be: "all", "group:Groceries", or a category name like "Groceries"
type SelectionType = "all" | string;

function isGroupSelection(val: string): boolean {
  return val.startsWith("group:");
}

function getGroupName(val: string): string {
  return val.replace("group:", "");
}

export default function Categories() {
  const { transactions, loading, categoryData, totalSpend, monthlyData, groupData } = useExpenses();
  const [selection, setSelection] = useState<SelectionType>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [manageOpen, setManageOpen] = useState(false);
  const [location] = useLocation();

  // Read URL search params for cross-page navigation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const categoryParam = params.get("category");
    const groupParam = params.get("group");

    if (categoryParam && categoryData.some((c) => c.name === categoryParam)) {
      setSelection(categoryParam);
    } else if (groupParam) {
      // Navigate to the group view
      setSelection(`group:${groupParam}`);
    }
  }, [location, categoryData]);

  // Default to "all" if nothing selected
  const activeSelection = selection || "all";

  // Determine what we're viewing
  const isAll = activeSelection === "all";
  const isGroup = isGroupSelection(activeSelection);
  const activeGroupName = isGroup ? getGroupName(activeSelection) : null;
  const activeCategoryName = !isAll && !isGroup ? activeSelection : null;

  // Group categories by group for the optgroup selector
  const groupedCategories = useMemo(() => {
    const groups = new Map<string, typeof categoryData>();
    for (const c of categoryData) {
      if (!groups.has(c.group)) {
        groups.set(c.group, []);
      }
      groups.get(c.group)!.push(c);
    }
    // Sort groups by total spend
    return Array.from(groups.entries())
      .map(([group, cats]) => ({
        group,
        categories: cats,
        total: cats.reduce((s, c) => s + c.total, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [categoryData]);

  // Compute stats for the active selection
  const selectionStats = useMemo(() => {
    if (isAll) {
      return {
        label: "All Categories",
        total: totalSpend,
        count: transactions.length,
        avgPerTransaction: transactions.length > 0 ? totalSpend / transactions.length : 0,
        shareOfTotal: 100,
        groupLabel: "All Groups",
      };
    }
    if (isGroup && activeGroupName) {
      const groupInfo = groupData.find((g) => g.name === activeGroupName);
      const groupTxns = transactions.filter((t) => t.group === activeGroupName);
      const total = groupTxns.reduce((s, t) => s + t.amount, 0);
      return {
        label: activeGroupName,
        total,
        count: groupTxns.length,
        avgPerTransaction: groupTxns.length > 0 ? total / groupTxns.length : 0,
        shareOfTotal: totalSpend > 0 ? (total / totalSpend) * 100 : 0,
        groupLabel: `${groupInfo?.categories.length || 0} categories`,
      };
    }
    // Single category
    const cat = categoryData.find((c) => c.name === activeCategoryName);
    if (cat) {
      return {
        label: cat.name,
        total: cat.total,
        count: cat.count,
        avgPerTransaction: cat.avgPerTransaction,
        shareOfTotal: totalSpend > 0 ? (cat.total / totalSpend) * 100 : 0,
        groupLabel: `Group: ${cat.group}`,
      };
    }
    return { label: "—", total: 0, count: 0, avgPerTransaction: 0, shareOfTotal: 0, groupLabel: "" };
  }, [isAll, isGroup, activeGroupName, activeCategoryName, categoryData, groupData, transactions, totalSpend]);

  // Filter transactions based on selection
  const selectionTransactions = useMemo(() => {
    if (isAll) return transactions;
    if (isGroup && activeGroupName) return transactions.filter((t) => t.group === activeGroupName);
    return transactions.filter((t) => t.category === activeCategoryName);
  }, [transactions, isAll, isGroup, activeGroupName, activeCategoryName]);

  const filteredTransactions = useMemo(() => {
    let filtered = selectionTransactions;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.description.toLowerCase().includes(lower) ||
          t.notes.toLowerCase().includes(lower) ||
          t.category.toLowerCase().includes(lower)
      );
    }
    return [...filtered].sort((a, b) => {
      if (sortField === "date") {
        return sortDir === "desc"
          ? b.date.getTime() - a.date.getTime()
          : a.date.getTime() - b.date.getTime();
      }
      return sortDir === "desc" ? b.amount - a.amount : a.amount - b.amount;
    });
  }, [selectionTransactions, searchTerm, sortField, sortDir]);

  // Monthly trend for the selection
  const monthlyTrend = useMemo(() => {
    if (isAll) {
      return monthlyData.map((m) => ({
        name: m.label,
        total: Math.round(m.total),
      }));
    }
    if (isGroup && activeGroupName) {
      return monthlyData.map((m) => ({
        name: m.label,
        total: Math.round(m.groups[activeGroupName] || 0),
      }));
    }
    return monthlyData.map((m) => ({
      name: m.label,
      total: Math.round(m.categories[activeCategoryName!] || 0),
    }));
  }, [monthlyData, isAll, isGroup, activeGroupName, activeCategoryName]);

  // Top merchants for the selection
  const topMerchants = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of selectionTransactions) {
      const key = t.notes || t.description;
      const cleanKey = key.length > 40 ? key.substring(0, 40) + "..." : key;
      if (!map.has(cleanKey)) {
        map.set(cleanKey, { total: 0, count: 0 });
      }
      const m = map.get(cleanKey)!;
      m.total += t.amount;
      m.count += 1;
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [selectionTransactions]);

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  // Title for charts
  const chartTitle = isAll ? "All Categories" : isGroup ? activeGroupName! : activeCategoryName!;

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
            Category Deep Dive
          </h2>
          <p className="text-white/70 text-sm mt-2">
            Explore spending patterns by category or group
          </p>
        </div>
      </motion.div>

      {/* Category Selector with optgroups */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">
              Select Category or Group
            </label>
            <button
              onClick={() => setManageOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Manage categories
            </button>
          </div>
          <select
            value={activeSelection}
            onChange={(e) => {
              setSelection(e.target.value);
              setSearchTerm("");
            }}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {/* All option */}
            <option value="all">
              All Categories — {formatCurrency(totalSpend)} ({transactions.length} transactions)
            </option>

            {/* Groups and their categories */}
            {groupedCategories.map((g) => (
              <optgroup key={g.group} label={`── ${g.group} ──`}>
                {/* Group-level option */}
                <option value={`group:${g.group}`}>
                  ★ All {g.group} — {formatCurrency(g.total)}
                </option>
                {/* Individual categories in this group */}
                {g.categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} — {formatCurrency(c.total)} ({c.count} txns)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
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
          label={isAll ? "Total Spend" : isGroup ? "Group Total" : "Category Total"}
          value={formatCurrency(selectionStats.total)}
          icon={isGroup ? <Layers className="w-4 h-4" /> : <Tags className="w-4 h-4" />}
        />
        <StatCard
          label="Transactions"
          value={selectionStats.count.toString()}
          icon={<Hash className="w-4 h-4" />}
        />
        <StatCard
          label="Avg per Transaction"
          value={formatCurrencyExact(selectionStats.avgPerTransaction)}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="Share of Total"
          value={formatPercent(selectionStats.shareOfTotal)}
          subtitle={selectionStats.groupLabel}
        />
      </motion.div>

      {/* Monthly Trend + Top Merchants */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-2"
        >
          <ChartCard title={`${chartTitle} — Monthly Trend`} subtitle="Spend per month">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend} barCategoryGap="20%">
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
                    tickFormatter={(v) => `$${v.toLocaleString()}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Spend" fill="#4a7c8a" radius={[4, 4, 0, 0]} />
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
          <ChartCard title="Top Merchants" subtitle="By total spend">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topMerchants} layout="vertical" barCategoryGap="15%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${v.toLocaleString()}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]}>
                    {topMerchants.map((_, i) => (
                      <Cell key={i} fill={CHART_HEX_COLORS[i % CHART_HEX_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </motion.div>
      </div>

      {/* Category breakdown table — only shown for "All" or group views */}
      {(isAll || isGroup) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <ChartCard
            title={`Category Breakdown${isGroup ? ` — ${activeGroupName}` : ""}`}
            subtitle="Click a category to drill down"
          >
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Category
                    </th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Total
                    </th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                      Txns
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
                  {categoryData
                    .filter((c) => isAll || c.group === activeGroupName)
                    .map((c, i) => {
                      const pct = selectionStats.total > 0 ? (c.total / selectionStats.total) * 100 : 0;
                      return (
                        <tr
                          key={c.name}
                          className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer group"
                          onClick={() => setSelection(c.name)}
                        >
                          <td className="px-5 py-2.5 text-xs font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: CHART_HEX_COLORS[i % CHART_HEX_COLORS.length] }}
                              />
                              <span className="group-hover:text-primary transition-colors">{c.name}</span>
                              {!isGroup && (
                                <span className="text-[10px] text-muted-foreground hidden sm:inline">({c.group})</span>
                              )}
                              <span className="text-primary/0 group-hover:text-primary/60 transition-colors text-[10px]">→</span>
                            </div>
                          </td>
                          <td className="px-5 py-2.5 text-xs font-medium text-right tabular-nums">
                            {formatCurrency(c.total)}
                          </td>
                          <td className="px-5 py-2.5 text-xs text-muted-foreground text-right tabular-nums hidden sm:table-cell">
                            {c.count}
                          </td>
                          <td className="px-5 py-2.5 text-xs text-muted-foreground text-right tabular-nums">
                            {formatPercent(pct)}
                          </td>
                          <td className="px-5 py-2.5 hidden lg:table-cell">
                            <div className="w-full bg-secondary rounded-full h-2">
                              <div
                                className="h-2 rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.min(pct * (isAll ? 5 : 2), 100)}%`,
                                  backgroundColor: CHART_HEX_COLORS[i % CHART_HEX_COLORS.length],
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </motion.div>
      )}

      {/* Transaction Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: isAll || isGroup ? 0.45 : 0.4 }}
      >
        <ChartCard
          title={`${chartTitle} Transactions`}
          subtitle={`${filteredTransactions.length} transactions`}
          action={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 w-[180px]"
              />
            </div>
          }
        >
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th
                    className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort("date")}
                  >
                    <span className="flex items-center gap-1">
                      Date
                      <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Description
                  </th>
                  {(isAll || isGroup) && (
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                      Category
                    </th>
                  )}
                  <th
                    className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort("amount")}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Amount
                      <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.slice(0, 50).map((t, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/50 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatDate(t.date)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-foreground max-w-[250px] truncate">
                      {t.description}
                    </td>
                    {(isAll || isGroup) && (
                      <td className="px-5 py-2.5 text-xs hidden md:table-cell">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelection(t.category);
                          }}
                          className="text-primary hover:text-primary/80 hover:underline transition-colors"
                        >
                          {t.category}
                        </button>
                      </td>
                    )}
                    <td className={`px-5 py-2.5 text-xs font-medium text-right whitespace-nowrap tabular-nums ${t.amount < 0 ? "text-eucalyptus" : "text-foreground"}`}>
                      {formatCurrencyExact(t.amount)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate hidden lg:table-cell">
                      {t.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredTransactions.length > 50 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                Showing 50 of {filteredTransactions.length} transactions
              </p>
            )}
          </div>
        </ChartCard>
      </motion.div>

      <ManageCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}
