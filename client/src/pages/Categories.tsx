/*
  DESIGN: Scandinavian Analytical — Category Drill-Down
  One view for the whole tree: the breakdown always shows the current node's
  children (plus a "(general)" row for spend filed directly on the node), and
  clicking a row re-roots the view. Breadcrumb navigates back up.
  The URL holds the view: ?category=<nodeId> and an optional period
  (?month=yyyy-mm, or ?from=&to= for other ranges). A period overrides the
  sidebar's time scope for the totals, breakdown and transactions; the monthly
  chart keeps showing the scope's months with the chosen one highlighted, and
  clicking a month focuses it. Links from Monthly and Compare carry their period.
  On wide screens a sidebar lists the whole tree with totals for the period.

  The global "hide one-offs" toggle applies here too, with one exception: once
  you drill into a one-off subtree it shows in full, otherwise the page you
  navigated to would be empty.
*/
import { useState, useMemo, useEffect, useCallback } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import ChartCard, { ColorLabel } from "@/components/ChartCard";
import StatCard from "@/components/StatCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import PageBanner from "@/components/PageBanner";
import TransactionEditDialog from "@/components/TransactionEditDialog";
import { CategoryPicker, CategoryTreeDropdown } from "@/components/pickers";
import { formatCurrency, formatCurrencyExact, formatPercent, formatDate, formatMonthYear } from "@/lib/utils";
import type { Transaction, CategoryNode } from "@/lib/types";
import { Tags, Hash, TrendingUp, ArrowUpDown, Search, Settings2, PencilLine, ExternalLink, ChevronRight, ChevronLeft, X } from "lucide-react";
import { type Period, monthPeriod, yearPeriod, rangePeriod, shiftMonthKey } from "@/lib/compare";
import { cn } from "@/lib/utils";
import ManageCategoriesDialog from "@/components/ManageCategoriesDialog";
import CategorySidebar from "@/components/CategorySidebar";
import { toastWithUndo } from "@/components/undoToast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation, useSearch } from "wouter";


const PAGE_SIZE = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The page's own period from its URL, or null to follow the sidebar scope */
function periodFromParams(params: URLSearchParams): Period | null {
  const month = params.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) return monthPeriod(month);
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return null;
  const m = monthPeriod(from.slice(0, 7));
  if (m.from === from && m.to === to) return m;
  if (from.slice(5) === "01-01" && to === `${from.slice(0, 4)}-12-31`) return yearPeriod(from.slice(0, 4));
  return rangePeriod(from, to);
}

/** "2026-10" when the period is exactly one calendar month (the ‹ › stepper works then) */
function monthKeyOf(p: Period | null): string | null {
  if (!p) return null;
  const m = monthPeriod(p.from.slice(0, 7));
  return m.from === p.from && m.to === p.to ? p.from.slice(0, 7) : null;
}

/** Per-node totals over a transaction list, rolled up through ancestors */
interface Rollup { total: number; count: number; direct: number; directCount: number }

export default function Categories() {
  const {
    transactions, allTransactions, loading, tree, colorOf, nameOf, categorizeTransactions,
    hideOneOffs, analysisTransactions, scopeLabel, availableYears,
  } = useExpenses();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [manageOpen, setManageOpen] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [, navigate] = useLocation();

  // The view lives in the URL, so Back, reloads and links all work
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const categoryParam = params.get("category") ?? "";
  /** Current node id, or "" for the top level ("all") */
  const selection = categoryParam && tree.byId.has(categoryParam) ? categoryParam : "";
  const period = useMemo(() => periodFromParams(params), [params]);
  const periodMonth = monthKeyOf(period);

  const go = useCallback(
    (id: string, p: Period | null) => {
      const q = new URLSearchParams();
      if (id) q.set("category", id);
      const mk = monthKeyOf(p);
      if (mk) q.set("month", mk);
      else if (p) { q.set("from", p.from); q.set("to", p.to); }
      const s = q.toString();
      navigate(`/categories${s ? `?${s}` : ""}`);
    },
    [navigate]
  );
  const setSelection = (id: string) => go(id, period);
  const setPeriod = (p: Period | null) => go(selection, p);

  // Period picker: years and months with data (all time, newest first)
  const availableMonths = useMemo(
    () => Array.from(new Set(allTransactions.map((t) => t.dateStr.slice(0, 7)))).sort().reverse(),
    [allTransactions]
  );
  const periodYear =
    period && period.from.slice(5) === "01-01" && period.to === `${period.from.slice(0, 4)}-12-31` ? period.from.slice(0, 4) : null;
  const periodValue = !period ? "" : periodMonth ? `m:${periodMonth}` : periodYear ? `y:${periodYear}` : "custom";
  const periodFromValue = (v: string): Period | null | undefined => {
    if (v === "") return null;
    if (v.startsWith("m:")) return monthPeriod(v.slice(2));
    if (v.startsWith("y:")) return yearPeriod(v.slice(2));
    return period; // "custom": unchanged
  };
  /** ‹ › step by month or by year, whichever the period is */
  const stepKey = periodMonth ?? periodYear;
  const step = (delta: number) => {
    if (periodMonth) setPeriod(monthPeriod(shiftMonthKey(periodMonth, delta)));
    else if (periodYear) setPeriod(yearPeriod(String(Number(periodYear) + delta)));
  };

  const node = selection ? tree.byId.get(selection) : undefined;

  /** Hide one-off subtrees, unless we're already inside one */
  const excludeOneOffs = hideOneOffs && !(selection && tree.isOneOff(selection));
  /** The sidebar scope's transactions (the monthly chart always shows these months) */
  const scopedTransactions = excludeOneOffs ? analysisTransactions : transactions;
  /** What the totals, breakdown and lists cover: the page's period, else the scope */
  const baseTransactions = useMemo(() => {
    if (!period) return scopedTransactions;
    return allTransactions.filter(
      (t) =>
        t.dateStr >= period.from &&
        t.dateStr <= period.to &&
        !(excludeOneOffs && tree.isOneOff(t.categoryId))
    );
  }, [period, scopedTransactions, allTransactions, excludeOneOffs, tree]);

  const stats = useMemo(() => {
    const map = new Map<string, Rollup>();
    const get = (id: string) => {
      let r = map.get(id);
      if (!r) map.set(id, (r = { total: 0, count: 0, direct: 0, directCount: 0 }));
      return r;
    };
    for (const t of baseTransactions) {
      const self = get(t.categoryId);
      self.direct += t.amount;
      self.directCount += 1;
      const seen = new Set<string>();
      for (let cur: string | null = t.categoryId; cur !== null && !seen.has(cur); ) {
        seen.add(cur);
        const r = get(cur);
        r.total += t.amount;
        r.count += 1;
        const parent: string | null = tree.byId.get(cur)?.parentId ?? null;
        cur = parent && tree.byId.has(parent) ? parent : null;
      }
    }
    return map;
  }, [baseTransactions, tree]);

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
  useEffect(() => setVisibleCount(PAGE_SIZE), [selection, searchTerm, excludeOneOffs, period]);

  // Monthly trend for the selection over the sidebar scope (not the page's
  // period, so there are other months to click), months without spend kept
  const monthlyTrend = useMemo(() => {
    const subtree = selection ? tree.subtreeIds(selection) : null;
    const totals = new Map<string, number>();
    for (const t of scopedTransactions) {
      if (subtree && !subtree.has(t.categoryId)) continue;
      const key = t.dateStr.slice(0, 7);
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }
    const keys = Array.from(totals.keys()).sort();
    if (keys.length === 0) return [];
    const multiYear = keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
    const out: Array<{ key: string; name: string; total: number; exact: number }> = [];
    for (let key = keys[0]; key <= keys[keys.length - 1]; key = shiftMonthKey(key, 1)) {
      const [y, m] = key.split("-").map(Number);
      const base = new Date(y, m - 1, 1).toLocaleString("en-AU", { month: "short" });
      const exact = totals.get(key) ?? 0;
      out.push({ key, name: multiYear ? `${base} ${String(y).slice(2)}` : base, total: Math.round(exact), exact });
    }
    return out;
  }, [scopedTransactions, selection, tree]);

  // Click a month to focus the page on it; click it again to go back to the scope
  const handleTrendClick = useCallback(
    (data: any) => {
      const key: string | undefined = data?.activePayload?.[0]?.payload?.key;
      if (!key) return;
      go(selection, periodMonth === key ? null : monthPeriod(key));
    },
    [go, selection, periodMonth]
  );
  const inPeriod = (key: string) => !period || (key >= period.from.slice(0, 7) && key <= period.to.slice(0, 7));

  // Top merchants for the selection ("full" keeps the untruncated key for search links)
  const topMerchants = useMemo(() => {
    const map = new Map<string, { total: number; count: number; byCategory: Map<string, number> }>();
    for (const t of selectionTransactions) {
      const key = t.description;
      if (!map.has(key)) {
        map.set(key, { total: 0, count: 0, byCategory: new Map() });
      }
      const m = map.get(key)!;
      m.total += t.amount;
      m.count += 1;
      m.byCategory.set(t.categoryId, (m.byCategory.get(t.categoryId) ?? 0) + t.amount);
    }
    return Array.from(map.entries())
      .map(([full, data]) => {
        // Coloured like the category the merchant is mostly filed under
        const mainCategory = [...data.byCategory.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return {
          name: full.length > 40 ? full.substring(0, 40) + "..." : full,
          full,
          total: data.total,
          count: data.count,
          mainCategory,
          color: colorOf(mainCategory),
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [selectionTransactions, colorOf]);

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
      <PageBanner
        title="Categories"
        subtitle="Click into any category to see how it breaks down"
        scope={period ? (periodMonth ? formatMonthYear(periodMonth) : period.label) : undefined}
      />

      <div className="xl:grid xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6 xl:items-start">
        <CategorySidebar
          className="hidden xl:block sticky top-6"
          selection={selection}
          totals={stats}
          grandTotal={grandTotal}
          periodLabel={period ? (periodMonth ? formatMonthYear(periodMonth) : period.label) : scopeLabel}
          onSelect={(id) => { setSelection(id); setSearchTerm(""); }}
        />
        <div className="space-y-6 min-w-0">

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
                      navigate(
                        `/transactions?${new URLSearchParams({
                          ...(selection ? { category: selection } : {}),
                          ...(period ? { from: period.from, to: period.to } : {}),
                        }).toString()}`
                      )
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
              <div className="xl:hidden">
                <CategoryTreeDropdown
                  value={selection}
                  onChange={(id) => {
                    setSelection(id);
                    setSearchTerm("");
                  }}
                  allLabel="All Categories"
                  allDetail={`${formatCurrency(grandTotal)} · ${baseTransactions.length} transactions`}
                />
              </div>
              {/* The page's own period: always here, so any month or year is one pick away */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Period</span>
                <div className="inline-flex items-center rounded-lg border border-border bg-background text-xs font-semibold">
                  {stepKey && (
                    <button
                      onClick={() => step(-1)}
                      className="px-2 py-1.5 text-muted-foreground hover:text-foreground"
                      aria-label={periodYear ? "Previous year" : "Previous month"}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <select
                    value={periodValue}
                    onChange={(e) => setPeriod(periodFromValue(e.target.value) ?? null)}
                    className={cn(
                      "bg-background py-1.5 font-semibold focus:outline-none cursor-pointer",
                      stepKey ? "px-1" : "px-2.5"
                    )}
                    aria-label="Period"
                  >
                    <option value="">{scopeLabel} (sidebar scope)</option>
                    {period && !periodMonth && !periodYear && <option value="custom">{period.label}</option>}
                    <optgroup label="Years">
                      {[...availableYears].reverse().map((y) => <option key={y} value={`y:${y}`}>{y}</option>)}
                    </optgroup>
                    <optgroup label="Months">
                      {availableMonths.map((m) => <option key={m} value={`m:${m}`}>{formatMonthYear(m)}</option>)}
                    </optgroup>
                  </select>
                  {stepKey && (
                    <button
                      onClick={() => step(1)}
                      className="px-2 py-1.5 text-muted-foreground hover:text-foreground"
                      aria-label={periodYear ? "Next year" : "Next month"}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {period && (
                  <button
                    onClick={() => setPeriod(null)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <X className="w-3 h-3" />
                    {scopeLabel}
                  </button>
                )}
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
              label={selection ? "Total (incl. subcategories)" : "Total Spend"}
              value={formatCurrency(selectionStats.total)}
              subtitle={period ? period.label : scopeLabel}
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
              <ChartCard
                title={`${chartTitle} — Monthly Trend`}
                subtitle={
                  period
                    ? `${scopeLabel}, ${periodMonth ? formatMonthYear(periodMonth) : period.label} highlighted · Click it again to show ${scopeLabel}`
                    : "Spend per month, subcategories included · Click a month to focus on it"
                }
                viewKey="categories-monthly"
                table={{
                  columns: [
                    { label: "Month", cell: (m: (typeof monthlyTrend)[number]) => formatMonthYear(m.key) },
                    { label: "Spend", align: "right", cell: (m: (typeof monthlyTrend)[number]) => formatCurrencyExact(m.exact) },
                  ],
                  rows: [...monthlyTrend].reverse(),
                  rowKey: (m: (typeof monthlyTrend)[number]) => m.key,
                  onRowClick: (m: (typeof monthlyTrend)[number]) =>
                    go(selection, periodMonth === m.key ? null : monthPeriod(m.key)),
                }}
              >
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrend} barCategoryGap="20%" onClick={handleTrendClick} className="cursor-pointer">
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
                      <Bar dataKey="total" name="Spend" radius={[4, 4, 0, 0]}>
                        {monthlyTrend.map((m) => (
                          <Cell
                            key={m.key}
                            fill={selection ? colorOf(selection) : "#4a7c8a"}
                            fillOpacity={inPeriod(m.key) ? 1 : 0.3}
                          />
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
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <ChartCard
                title="Top Merchants"
                subtitle="Click a bar to review those transactions"
                viewKey="categories-merchants"
                table={{
                  columns: [
                    { label: "Merchant", cell: (m: (typeof topMerchants)[number]) => <ColorLabel color={m.color}>{m.name}</ColorLabel> },
                    { label: "Txns", align: "right", cell: (m: (typeof topMerchants)[number]) => m.count },
                    { label: "Spend", align: "right", cell: (m: (typeof topMerchants)[number]) => formatCurrencyExact(m.total) },
                  ],
                  rows: topMerchants,
                  rowKey: (m: (typeof topMerchants)[number]) => m.full,
                  onRowClick: (m: (typeof topMerchants)[number]) => navigate(`/transactions?q=${encodeURIComponent(m.full)}`),
                }}
              >
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
                        {topMerchants.map((m) => (
                          <Cell key={m.full} fill={m.color} />
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
              subtitle={`${filteredTransactions.length} transactions · ${period ? period.label : scopeLabel}`}
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
                              toastWithUndo(`Moved to ${nameOf(categoryId)}`, categorizeTransactions([t.id], categoryId));
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

        </div>
      </div>

      <ManageCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} />
      <TransactionEditDialog
        open={editTxn !== null}
        onOpenChange={(o) => !o && setEditTxn(null)}
        transaction={editTxn}
      />
    </div>
  );
}
