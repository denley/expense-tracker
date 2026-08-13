/*
  DESIGN: Scandinavian Analytical — Transactions
  The editing workhorse: filter by anything, sort, multi-select,
  bulk categorise / delete, inline row editing.
  Reads URL params: ?category= ?group= ?uncategorized=1 ?q=
*/
import { useState, useMemo, useEffect, useCallback } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Transaction } from "@/lib/types";
import { UNCATEGORIZED } from "@/lib/types";
import LoadingState from "@/components/LoadingState";
import TransactionEditDialog from "@/components/TransactionEditDialog";
import SplitTransactionDialog from "@/components/SplitTransactionDialog";
import RuleQuickDialog from "@/components/RuleQuickDialog";
import RuleRunReviewDialog from "@/components/RuleRunReviewDialog";
import { CategoryPicker } from "@/components/pickers";
import { formatCurrency, formatCurrencyExact, formatDate } from "@/lib/utils";
import { transactionsToCsv, downloadFile } from "@/lib/export";
import { dedupKey } from "@/lib/csv";
import { normalizeMerchant, suggestPatternsForUncategorised, type RuleChange } from "@/lib/rules";
import {
  Search, ArrowUpDown, Plus, X, Trash2, Download, Filter,
  CheckSquare, PencilLine, Wand2, Copy, Lightbulb, Split,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SortField = "date" | "amount" | "description" | "category";

const PAGE_SIZE = 100;

export default function Transactions() {
  const {
    transactions, allTransactions, loading, categories, groups, accounts, groupColors,
    updateTransactions, deleteTransactions, runRules, rules,
  } = useExpenses();
  const [location] = useLocation();

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [group, setGroup] = useState("");
  const [account, setAccount] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [uncatOnly, setUncatOnly] = useState(false);
  const [dupOnly, setDupOnly] = useState(false);

  // Sort / paging / selection
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<number | null>(null);

  // Bulk edit state
  const [bulkCategory, setBulkCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit dialog
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Split dialog
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);

  // Rule-from-transaction dialog
  const [ruleSeed, setRuleSeed] = useState<{ pattern: string; category: string } | null>(null);

  // Post-"Apply Rules" review
  const [ruleRunChanges, setRuleRunChanges] = useState<RuleChange[] | null>(null);

  // URL params → filters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("category")) setCategory(params.get("category")!);
    if (params.get("group")) setGroup(params.get("group")!);
    if (params.get("q")) setSearch(params.get("q")!);
    if (params.get("uncategorized")) setUncatOnly(true);
    if (params.get("duplicates")) setDupOnly(true);
  }, [location]);

  // Transactions sharing a date + amount + description with at least one other
  const duplicateIds = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const t of allTransactions) {
      const key = dedupKey({ date: t.dateStr, amount: t.amount, description: t.description });
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(t.id);
    }
    const ids = new Set<string>();
    for (const group of byKey.values()) {
      if (group.length > 1) group.forEach((id) => ids.add(id));
    }
    return ids;
  }, [allTransactions]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      );
    }
    if (category) list = list.filter((t) => t.category === category);
    if (group) list = list.filter((t) => t.group === group);
    if (account) list = list.filter((t) => t.account === account);
    if (dateFrom) list = list.filter((t) => t.dateStr >= dateFrom);
    if (dateTo) list = list.filter((t) => t.dateStr <= dateTo);
    if (uncatOnly) list = list.filter((t) => t.category === UNCATEGORIZED);
    if (dupOnly) list = list.filter((t) => duplicateIds.has(t.id));

    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = a.date.getTime() - b.date.getTime(); break;
        case "amount": cmp = a.amount - b.amount; break;
        case "description": cmp = a.description.localeCompare(b.description); break;
        case "category": cmp = a.category.localeCompare(b.category); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [transactions, search, category, group, account, dateFrom, dateTo, uncatOnly, dupOnly, duplicateIds, sortField, sortDir]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const filteredTotal = useMemo(() => filtered.reduce((s, t) => s + t.amount, 0), [filtered]);
  const uncatCount = useMemo(
    () => transactions.filter((t) => t.category === UNCATEGORIZED).length,
    [transactions]
  );
  const dupCount = useMemo(
    () => transactions.filter((t) => duplicateIds.has(t.id)).length,
    [transactions, duplicateIds]
  );

  // Keywords that would cover several uncategorised transactions — click to draft a rule
  const ruleSuggestions = useMemo(
    () => suggestPatternsForUncategorised(transactions, rules),
    [transactions, rules]
  );

  const hasFilters = !!(search || category || group || account || dateFrom || dateTo || uncatOnly || dupOnly);

  const clearFilters = () => {
    setSearch(""); setCategory(""); setGroup(""); setAccount("");
    setDateFrom(""); setDateTo(""); setUncatOnly(false); setDupOnly(false);
    setVisibleCount(PAGE_SIZE);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Selection — supports shift-click ranges over the visible list
  const toggleSelect = useCallback((id: string, index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked !== null) {
        const [lo, hi] = [Math.min(lastClicked, index), Math.max(lastClicked, index)];
        const turnOn = !prev.has(id);
        for (let i = lo; i <= hi; i++) {
          const t = visible[i];
          if (t) turnOn ? next.add(t.id) : next.delete(t.id);
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    setLastClicked(index);
  }, [lastClicked, visible]);

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((t) => t.id)));
    }
  };

  const clearSelection = () => setSelected(new Set());
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  // Bulk actions
  const applyBulk = () => {
    if (!bulkCategory) {
      toast.error("Choose a category to apply");
      return;
    }
    updateTransactions(selectedIds, { category: bulkCategory });
    toast.success(`Categorised ${selectedIds.length} transaction${selectedIds.length === 1 ? "" : "s"} as ${bulkCategory}`);
    setBulkCategory("");
    clearSelection();
  };

  const doDelete = () => {
    deleteTransactions(selectedIds);
    toast.success(`Deleted ${selectedIds.length} transaction${selectedIds.length === 1 ? "" : "s"}`);
    setConfirmDelete(false);
    clearSelection();
  };

  const exportFiltered = () => {
    const csv = transactionsToCsv(
      filtered.map((t) => ({
        id: t.id, date: t.dateStr, description: t.description, amount: t.amount,
        category: t.category, group: t.group, account: t.account, notes: t.notes,
      }))
    );
    downloadFile(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
    toast.success(`Exported ${filtered.length} transactions`);
  };

  const applyRulesNow = () => {
    const { count, changes } = runRules({});
    if (count > 0) {
      setRuleRunChanges(changes);
    } else {
      toast.info("No uncategorised transactions matched your rules");
    }
  };

  if (loading) return <LoadingState />;

  const selectCls = "bg-background border border-border rounded-lg px-2.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-4">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Transactions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {transactions.length} transactions
            {hasFilters && <> · {formatCurrency(filteredTotal)} filtered total</>}
            {uncatCount > 0 && (
              <button
                onClick={() => { clearFilters(); setUncatOnly(true); }}
                className="ml-2 text-terracotta hover:underline font-medium"
              >
                {uncatCount} uncategorised →
              </button>
            )}
            {dupCount > 0 && (
              <button
                onClick={() => { clearFilters(); setDupOnly(true); }}
                className="ml-2 text-sandstone hover:underline font-medium"
                title="Transactions with the same date, amount and description as another"
              >
                {dupCount} possible duplicates →
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rules.length > 0 && uncatCount > 0 && (
            <button
              onClick={applyRulesNow}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Apply Rules
            </button>
          )}
          <button
            onClick={exportFiltered}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button
            onClick={() => { setEditTxn(null); setDialogOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </motion.div>

      {/* Filter bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="bg-card rounded-xl border border-border p-3 space-y-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search description, notes, category…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="w-full pl-8 pr-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={selectCls}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {accounts.length > 0 && (
            <select value={account} onChange={(e) => setAccount(e.target.value)} className={selectCls}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="w-3.5 h-3.5" />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selectCls} />
            <span>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selectCls} />
          </div>
          <button
            onClick={() => setUncatOnly(!uncatOnly)}
            className={cn(
              "px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-colors",
              uncatOnly
                ? "bg-terracotta/10 border-terracotta/40 text-terracotta"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            Uncategorised only
          </button>
          <button
            onClick={() => setDupOnly(!dupOnly)}
            className={cn(
              "px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-colors",
              dupOnly
                ? "bg-sandstone/10 border-sandstone/40 text-sandstone"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
            title="Transactions with the same date, amount and description as another"
          >
            Possible duplicates
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          )}
        </div>
      </motion.div>

      {/* Suggested rules covering the uncategorised pile */}
      {ruleSuggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="bg-card rounded-xl border border-border p-3"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-sandstone" />
            Suggested rules — keywords covering your uncategorised transactions (click to review)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ruleSuggestions.map((s) => (
              <button
                key={s.pattern}
                onClick={() => setRuleSeed({ pattern: s.pattern, category: s.suggestedCategory ?? "" })}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] border border-border hover:bg-accent hover:border-primary/40 transition-colors"
                title={`Covers ${s.count} uncategorised transaction${s.count === 1 ? "" : "s"} — opens the rule dialog to review the matches`}
              >
                <Wand2 className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">"{s.pattern}"</span>
                <span className="text-muted-foreground">×{s.count}</span>
                {s.suggestedCategory && (
                  <span className="text-primary">→ {s.suggestedCategory}</span>
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="bg-card rounded-xl border border-border overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    className="accent-[var(--color-eucalyptus)] cursor-pointer"
                    title={allVisibleSelected ? "Deselect all" : `Select all ${filtered.length} filtered`}
                  />
                </th>
                {(["date", "description", "category"] as SortField[]).map((f) => (
                  <th
                    key={f}
                    className={cn(
                      "text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none",
                      f === "category" && "hidden md:table-cell"
                    )}
                    onClick={() => toggleSort(f)}
                  >
                    <span className="flex items-center gap-1">
                      {f}
                      <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                ))}
                <th
                  className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                  onClick={() => toggleSort("amount")}
                >
                  <span className="flex items-center justify-end gap-1">
                    Amount
                    <ArrowUpDown className="w-3 h-3" />
                  </span>
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {visible.map((t, i) => (
                <tr
                  key={t.id}
                  className={cn(
                    "border-b border-border/50 hover:bg-accent/50 transition-colors",
                    selected.has(t.id) && "bg-primary/5"
                  )}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => {}}
                      onClick={(e) => toggleSelect(t.id, i, e.shiftKey)}
                      className="accent-[var(--color-eucalyptus)] cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {formatDate(t.date)}
                  </td>
                  <td className="px-3 py-2 text-xs text-foreground max-w-[280px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-medium">{t.notes || t.description}</span>
                      {duplicateIds.has(t.id) && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sandstone/15 text-sandstone text-[9px] font-semibold uppercase tracking-wide shrink-0"
                          title="Same date, amount and description as another transaction"
                        >
                          <Copy className="w-2.5 h-2.5" /> dup
                        </span>
                      )}
                    </div>
                    {t.notes && (
                      <div className="truncate text-[10px] text-muted-foreground">{t.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs hidden md:table-cell whitespace-nowrap">
                    <span
                      className={cn(
                        t.category === UNCATEGORIZED
                          ? "text-terracotta font-medium"
                          : "text-foreground"
                      )}
                    >
                      {t.category}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground ml-1.5"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ backgroundColor: groupColors[t.group] }}
                      />
                      {t.group}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-xs font-medium text-right whitespace-nowrap tabular-nums",
                      t.amount < 0 ? "text-eucalyptus" : "text-foreground"
                    )}
                  >
                    {formatCurrencyExact(t.amount)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center">
                      <button
                        onClick={() =>
                          setRuleSeed({
                            pattern: normalizeMerchant(t.description),
                            category: t.category === UNCATEGORIZED ? "" : t.category,
                          })
                        }
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                        title="Create rule from this transaction"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setSplitTxn(t)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Split into multiple transactions"
                      >
                        <Split className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setEditTxn(t); setDialogOpen(true); }}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Edit"
                      >
                        <PencilLine className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {transactions.length === 0
              ? "No transactions yet — import a CSV to get started."
              : "Nothing matches these filters."}
          </div>
        )}

        {filtered.length > visibleCount && (
          <div className="p-3 text-center border-t border-border">
            <button
              onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
              className="px-4 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
            >
              Show more ({filtered.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </motion.div>

      {/* Bulk edit bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 lg:left-[calc(50%+110px)] z-50 w-[calc(100%-2rem)] max-w-[720px]"
          >
            <div className="bg-card border border-border rounded-2xl shadow-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <CheckSquare className="w-3.5 h-3.5 text-primary" />
                  {selected.size} selected
                  <span className="text-muted-foreground font-normal">
                    · {formatCurrency(transactions.filter((t) => selected.has(t.id)).reduce((s, t) => s + t.amount, 0))}
                  </span>
                </span>
                <button
                  onClick={clearSelection}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CategoryPicker
                  value={bulkCategory}
                  onChange={setBulkCategory}
                  allowEmpty
                  emptyLabel="Choose category…"
                  className="flex-1 min-w-[220px]"
                />
                <button
                  onClick={applyBulk}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
                >
                  Apply to {selected.size}
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} transaction{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from your local data. Export a backup first if you're unsure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TransactionEditDialog open={dialogOpen} onOpenChange={setDialogOpen} transaction={editTxn} />

      <SplitTransactionDialog
        open={splitTxn !== null}
        onOpenChange={(o) => !o && setSplitTxn(null)}
        transaction={splitTxn}
      />

      <RuleQuickDialog
        open={ruleSeed !== null}
        onOpenChange={(o) => !o && setRuleSeed(null)}
        seedPattern={ruleSeed?.pattern ?? ""}
        seedCategory={ruleSeed?.category ?? ""}
      />

      <RuleRunReviewDialog
        open={ruleRunChanges !== null}
        onOpenChange={(o) => !o && setRuleRunChanges(null)}
        changes={ruleRunChanges ?? []}
      />
    </div>
  );
}
