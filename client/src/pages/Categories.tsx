/*
  DESIGN: Scandinavian Analytical — Category Drill-Down
  One view for the whole tree: the breakdown always shows the current node's
  children (plus a "(general)" row for spend filed directly on the node), and
  clicking a row re-roots the view. Breadcrumb navigates back up.
  Reads ?category=<nodeId> from URL search params for cross-page navigation.

  The global "hide one-offs" toggle applies here too, with one exception: once
  you drill into a one-off subtree it shows in full, otherwise the page you
  navigated to would be empty.
*/
import { useState, useMemo, useEffect, useCallback } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard from "@/components/ChartCard";
import StatCard from "@/components/StatCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import TransactionEditDialog from "@/components/TransactionEditDialog";
import { CategoryPicker, CategoryTreeDropdown } from "@/components/pickers";
import { formatCurrency, formatCurrencyExact, formatPercent, formatDate } from "@/lib/utils";
import { CHART_HEX_COLORS, type Transaction, type CategoryNode } from "@/lib/types";
import { Tags, Hash, TrendingUp, ArrowUpDown, Search, Settings2, PencilLine, ExternalLink, ChevronRight } from "lucide-react";
import ManageCategoriesDialog from "@/components/ManageCategoriesDialog";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663325128704/SA2HSaHwj3kdEwrv6Yi87t/hero-categories-nKaX5EdJLEgSi5mB7M9UuF.webp";

const PAGE_SIZE = 50;

export default function Categories() {
  const {
    transactions, loading, tree, nodeStats, colorOf, nameOf, updateTransactions,
    hideOneOffs, analysisTransactions, analysisNodeStats,
  } = useExpenses();
  /** Current node id, or "" for the top level ("all") */
  const [selection, setSelection] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [manageOpen, setManageOpen] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [location, navigate] = useLocation();

  // Read URL search params for cross-page navigation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const categoryParam = params.get("category");
    if (categoryParam && tree.byId.has(categoryParam)) {
      setSelection(categoryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const node = selection ? tree.byId.get(selection) : undefined;

  /** Hide one-off subtrees, unless we're already inside one */
  const excludeOneOffs = hideOneOffs && !(selection && tree.isOneOff(selection));
  const baseTransactions = excludeOneOffs ? analysisTransactions : transactions;
  const stats = excludeOneOffs ? analysisNodeStats : nodeStats;

  // Breadcrumb: ancestors from the root down to the current node
  const breadcrumb = useMemo(() => {
    const chain: CategoryNode[] = [];
    let cur = node;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
    }
    return chain;
  }, [node, tree]);

  const selectionTransactions = useMemo(() => {
    if (!selection) return baseTransactions;
    const subtree = tree.subtreeIds(selection);
    return baseTransactions.filter((t) => subtree.has(t.categoryId));
  }, [baseTransactions, selection, tree]);

  const grandTotal = useMemo(
    () => baseTransactions.reduce((s, t) => s + t.amount, 0),
    [baseTransactions]
  );

  const selectionStats = useMemo(() => {
    const total = selectionTransactions.reduce((s, t) => s + t.amount, 0);
    const count = selectionTransactions.length;
    return {
      label: node?.name ?? "All Categories",
      total,
      count,
      avgPerTransaction: count > 0 ? total / count : 0,
      shareOfTotal: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
    };
  }, [selectionTransactions, node, grandTotal]);

  /**
   * Breakdown rows: the current node's children with activity, plus a
   * "(general)" row when transactions are filed directly on the node itself.
   */
  const breakdownRows = useMemo(() => {
    const children = tree.children.get(selection || null) ?? [];
    const rows = children
      .map((c) => {
        const s = stats.get(c.id);
        return s && s.count > 0
          ? { id: c.id, name: c.name, oneOff: !!c.oneOff, total: s.total, count: s.count, drillable: true }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (selection) {
      const s = stats.get(selection);
      if (s && s.directCount > 0 && rows.length > 0) {
        rows.push({
          id: selection,
          name: `${node?.name ?? ""} (general)`,
          oneOff: false,
          total: s.direct,
          count: s.directCount,
          drillable: false,
        });
      }
    }
    return rows.sort((a, b) => b.total - a.total);
  }, [tree, selection, stats, node]);

  const filteredTransactions = useMemo(() => {
    let filtered = selectionTransactions;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.description.toLowerCase().includes(lower) ||
          t.notes.toLowerCase().includes(lower) ||
          t.path.toLowerCase().includes(lower)
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

  // Back to the first page whenever the underlying list changes
  useEffect(() => setVisibleCount(PAGE_SIZE), [selection, searchTerm, excludeOneOffs]);

  // Monthly trend for the selection (rolled up over the subtree)
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { key: string; label: string; total: number }>();
    const multiYear = new Set(selectionTransactions.map((t) => t.date.getFullYear())).size > 1;
    for (const t of selectionTransactions) {
      const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) {
        const base = t.date.toLocaleString("en-AU", { month: "short" });
        map.set(key, {
          key,
          label: multiYear ? `${base} ${String(t.date.getFullYear()).slice(2)}` : base,
          total: 0,
        });
      }
      map.get(key)!.total += t.amount;
    }
    return Array.from(map.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((m) => ({ name: m.label, total: Math.round(m.total) }));
  }, [selectionTransactions]);

  // Top merchants for the selection ("full" keeps the untruncated key for search links)
  const topMerchants = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of selectionTransactions) {
      const key = t.notes || t.description;
      if (!map.has(key)) {
        map.set(key, { total: 0, count: 0 });
      }
      const m = map.get(key)!;
      m.total += t.amount;
      m.count += 1;
    }
    return Array.from(map.entries())
      .map(([full, data]) => ({
        name: full.length > 40 ? full.substring(0, 40) + "..." : full,
        full,
        ...data,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [selectionTransactions]);

  // Click a merchant bar → that merchant's transactions, ready to verify or fix
  const handleMerchantClick = useCallback(
    (data: any) => {
      const full = data?.activePayload?.[0]?.payload?.full;
      if (full) navigate(`/transactions?q=${encodeURIComponent(full)}`);
    },
    [navigate]
  );

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const chartTitle = node?.name ?? "All Categories";

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
            Category Drill-Down
          </h2>
          <p className="text-white/70 text-sm mt-2">
            Click into any category to see how it breaks down
          </p>
        </div>
      </motion.div>

      {/* Breadcrumb + quick jump */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav className="flex flex-wrap items-center gap-1 text-sm font-medium">
              <button
                onClick={() => setSelection("")}
                className={selection ? "text-primary hover:underline" : "text-foreground"}
              >
                All Categories
              </button>
              {breadcrumb.map((n, i) => (
                <span key={n.id} className="flex items-center gap-1">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  <button
                    onClick={() => setSelection(n.id)}
                    className={
                      i === breadcrumb.length - 1
                        ? "text-foreground"
                        : "text-primary hover:underline"
                    }
                  >
                    {n.name}
                    {n.oneOff ? " ◈" : ""}
                  </button>
                </span>
              ))}
            </nav>
            <div className="flex items-center gap-4">
              <button
                onClick={() =>
                  navigate(selection ? `/transactions?category=${encodeURIComponent(selection)}` : "/transactions")
                }
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                title="Open this selection in the Transactions list for filtering and bulk edits"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Transactions
              </button>
              <button
                onClick={() => setManageOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Manage categories
              </button>
            </div>
          </div>
          <CategoryTreeDropdown
            value={selection}
            onChange={(id) => {
              setSelection(id);
              setSearchTerm("");
            }}
            allLabel="All Categories"
            allDetail={`${formatCurrency(grandTotal)} · ${transactions.length} transactions`}
          />
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
          label={selection ? "Total (incl. subcategories)" : "Total Spend"}
          value={formatCurrency(selectionStats.total)}
          icon={<Tags className="w-4 h-4" />}
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
          subtitle={node ? tree.pathOf(node.id) : "All spending"}
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
          <ChartCard title={`${chartTitle} — Monthly Trend`} subtitle="Spend per month, subcategories included">
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
                  <Bar
                    dataKey="total"
                    name="Spend"
                    fill={selection ? colorOf(selection) : "#4a7c8a"}
                    radius={[4, 4, 0, 0]}
                  />
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
          <ChartCard title="Top Merchants" subtitle="Click a bar to review those transactions">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topMerchants}
                  layout="vertical"
                  barCategoryGap="15%"
                  onClick={handleMerchantClick}
                  className="cursor-pointer"
                >
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

      {/* Breakdown of the current node's children */}
      {breakdownRows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <ChartCard
            title={`Breakdown — ${chartTitle}`}
            subtitle='Click a row to drill down. "(general)" is spend filed directly on this category.'
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
                  {breakdownRows.map((r) => {
                    const pct = selectionStats.total !== 0 ? (r.total / selectionStats.total) * 100 : 0;
                    const color = r.drillable ? colorOf(r.id) : "var(--color-muted-foreground)";
                    return (
                      <tr
                        key={`${r.id}-${r.drillable}`}
                        className={`border-b border-border/50 transition-colors group ${
                          r.drillable ? "hover:bg-accent/50 cursor-pointer" : "opacity-80"
                        }`}
                        onClick={() => r.drillable && setSelection(r.id)}
                      >
                        <td className="px-5 py-2.5 text-xs font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className={r.drillable ? "group-hover:text-primary transition-colors" : "text-muted-foreground"}>
                              {r.name}
                              {r.oneOff ? " ◈" : ""}
                            </span>
                            {r.drillable && (
                              <span className="text-primary/0 group-hover:text-primary/60 transition-colors text-[10px]">→</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-xs font-medium text-right tabular-nums">
                          {formatCurrency(r.total)}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground text-right tabular-nums hidden sm:table-cell">
                          {r.count}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground text-right tabular-nums">
                          {formatPercent(pct)}
                        </td>
                        <td className="px-5 py-2.5 hidden lg:table-cell">
                          <div className="w-full bg-secondary rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(Math.abs(pct), 100)}%`,
                                backgroundColor: color,
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
        transition={{ duration: 0.5, delay: 0.4 }}
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
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Category
                  </th>
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
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.slice(0, visibleCount).map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-border/50 hover:bg-accent/50 transition-colors"
                  >
                    <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatDate(t.date)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-foreground max-w-[250px] truncate">
                      {t.description}
                    </td>
                    <td className="px-5 py-1.5 text-xs hidden md:table-cell">
                      <CategoryPicker
                        value={t.categoryId}
                        onChange={(categoryId) => {
                          if (categoryId === t.categoryId) return;
                          updateTransactions([t.id], { categoryId });
                          toast.success(`Moved to ${nameOf(categoryId)}`);
                        }}
                        className="!text-xs !py-1 !px-2 max-w-[180px]"
                      />
                    </td>
                    <td className={`px-5 py-2.5 text-xs font-medium text-right whitespace-nowrap tabular-nums ${t.amount < 0 ? "text-eucalyptus" : "text-foreground"}`}>
                      {formatCurrencyExact(t.amount)}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate hidden lg:table-cell">
                      {t.notes}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => setEditTxn(t)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Edit transaction"
                      >
                        <PencilLine className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredTransactions.length > visibleCount && (
              <div className="p-3 text-center border-t border-border">
                <button
                  onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
                >
                  Show more ({filteredTransactions.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        </ChartCard>
      </motion.div>

      <ManageCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} />
      <TransactionEditDialog
        open={editTxn !== null}
        onOpenChange={(o) => !o && setEditTxn(null)}
        transaction={editTxn}
      />
    </div>
  );
}
