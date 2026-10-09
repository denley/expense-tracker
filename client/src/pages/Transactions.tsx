/*
  DESIGN: Scandinavian Analytical — Transactions
  The editing workhorse: filter by anything, sort, multi-select,
  bulk categorise / delete, inline row editing.
  Reads URL params: ?category= ?group= ?uncategorized=1 ?q=
  Below md the table becomes TransactionMobileList (tap → TransactionSheet,
  long-press → select) and the filters move into a bottom sheet.
*/
import { Fragment, useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Rule, Transaction } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import LoadingState from "@/components/LoadingState";
import TransactionEditDialog from "@/components/TransactionEditDialog";
import SplitTransactionDialog from "@/components/SplitTransactionDialog";
import RuleQuickDialog from "@/components/RuleQuickDialog";
import RuleRunReviewDialog from "@/components/RuleRunReviewDialog";
import ImportDialog from "@/components/ImportDialog";
import TransactionMobileList from "@/components/TransactionMobileList";
import TransactionSheet from "@/components/TransactionSheet";
import { CategoryPicker, CategoryTreeDropdown } from "@/components/pickers";
import { formatCurrency, formatCurrencyExact, formatDate, formatDayHeading, formatIsoDate } from "@/lib/utils";
import { transactionsToPortableCsv } from "@/lib/export";
import { downloadFile } from "@/lib/download";
import { dedupKey } from "@/lib/csv";
import { normalizeMerchant, ruleMatches, suggestPatternsForUncategorised, type RuleChange } from "@/lib/rules";
import {
  Search, ArrowUpDown, ArrowUp, ArrowDown, Plus, X, Trash2, Download, Filter,
  CheckSquare, PencilLine, Wand2, Copy, Lightbulb, Split, UploadCloud,
  MoreHorizontal, SlidersHorizontal, ChevronDown,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useMobile";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SortField = "date" | "amount" | "description" | "category";

const PAGE_SIZE = 100;

const SORT_OPTIONS: Array<{ value: `${SortField}-${"asc" | "desc"}`; label: string }> = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "amount-desc", label: "Largest amount" },
  { value: "amount-asc", label: "Smallest amount" },
  { value: "description-asc", label: "Description A–Z" },
  { value: "description-desc", label: "Description Z–A" },
  { value: "category-asc", label: "Category A–Z" },
  { value: "category-desc", label: "Category Z–A" },
];

export default function Transactions() {
  const {
    transactions, allTransactions, loading, accounts, accountCoverage, groupColors, tree, nameOf,
    updateTransactions, deleteTransactions, runRules, rules,
  } = useExpenses();
  const [location] = useLocation();
  const isMobile = useIsMobile();

  // Filters (category = a node id; matching includes the whole subtree)
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
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

  // Phone: row action sheet, filter sheet, collapsed rule suggestions
  const [sheetTxn, setSheetTxn] = useState<Transaction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Split dialog
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);

  // Rule-from-transaction dialog (edits the matching rule when one exists)
  const [ruleSeed, setRuleSeed] = useState<{ pattern: string; categoryId: string; edit?: Rule } | null>(null);

  // Post-"Apply Rules" review
  const [ruleRunChanges, setRuleRunChanges] = useState<RuleChange[] | null>(null);

  // CSV import — the whole page is a drop target; dragDepth handles dragleave
  // firing as the cursor crosses child elements
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const isCsvDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const onImported = (uncategorised: number) => {
    setImportFile(null);
    if (uncategorised > 0) { clearFilters(); setUncatOnly(true); }
  };

  // URL params → filters (?category= is a node id)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("category")) setCategory(params.get("category")!);
    if (params.get("q")) setSearch(params.get("q")!);
    if (params.get("uncategorized")) setUncatOnly(true);
    if (params.get("duplicates")) setDupOnly(true);
  }, [location]);

  // Transactions sharing a date + amount + description with at least one other
  const duplicateIds = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const t of allTransactions) {
      const key = dedupKey({ date: t.dateStr, amount: t.amount, description: t.description, originalAmount: t.originalAmount });
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
          t.path.toLowerCase().includes(q)
      );
    }
    if (category) {
      const subtree = tree.subtreeIds(category);
      list = list.filter((t) => subtree.has(t.categoryId));
    }
    if (account) list = list.filter((t) => t.account === account);
    if (dateFrom) list = list.filter((t) => t.dateStr >= dateFrom);
    if (dateTo) list = list.filter((t) => t.dateStr <= dateTo);
    if (uncatOnly) list = list.filter((t) => t.categoryId === UNCATEGORIZED_ID);
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
  }, [transactions, search, category, tree, account, dateFrom, dateTo, uncatOnly, dupOnly, duplicateIds, sortField, sortDir]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const dayTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of filtered) totals.set(t.dateStr, (totals.get(t.dateStr) ?? 0) + t.amount);
    return totals;
  }, [filtered]);
  const filteredTotal = useMemo(() => filtered.reduce((s, t) => s + t.amount, 0), [filtered]);
  const uncatCount = useMemo(
    () => transactions.filter((t) => t.categoryId === UNCATEGORIZED_ID).length,
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

  const hasFilters = !!(search || category || account || dateFrom || dateTo || uncatOnly || dupOnly);
  const sheetFilterCount = [category, account, dateFrom || dateTo, uncatOnly, dupOnly].filter(Boolean).length;
  const sortValue = `${sortField}-${sortDir}` as const;
  const isDefaultSort = sortValue === "date-desc";
  const groupByDay = sortField === "date";

  const clearFilters = () => {
    setSearch(""); setCategory(""); setAccount("");
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

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  // Bulk actions
  const applyBulk = () => {
    if (!bulkCategory) {
      toast.error("Choose a category to apply");
      return;
    }
    updateTransactions(selectedIds, { categoryId: bulkCategory });
    toast.success(`Categorised ${selectedIds.length} transaction${selectedIds.length === 1 ? "" : "s"} as ${nameOf(bulkCategory)}`);
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
    const csv = transactionsToPortableCsv(
      filtered.map((t) => ({
        id: t.id, date: t.dateStr, description: t.description, amount: t.amount,
        categoryId: t.categoryId, account: t.account, notes: t.notes,
        ...(t.originalAmount !== undefined ? { originalAmount: t.originalAmount } : {}),
        ...(t.fxRate !== undefined ? { fxRate: t.fxRate } : {}),
      })),
      tree
    );
    downloadFile(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
    toast.success(`Exported ${filtered.length} transactions`);
  };

  const matchingRuleFor = (t: Transaction) => rules.find((r) => r.enabled && ruleMatches(r, t.description));

  // Edit the rule that already catches this description, else draft one from it
  const openRuleFor = (t: Transaction) => {
    const rule = matchingRuleFor(t);
    setRuleSeed(
      rule
        ? { pattern: rule.pattern, categoryId: rule.categoryId, edit: rule }
        : { pattern: normalizeMerchant(t.description), categoryId: t.categoryId === UNCATEGORIZED_ID ? "" : t.categoryId }
    );
  };

  // Rows load as the end of the list scrolls near (the button stays as a fallback);
  // re-observing after each page re-checks whether the end is still in view
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMore = filtered.length > visibleCount;
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((c) => c + PAGE_SIZE); },
      { rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  const applyRulesNow = () => {
    const { count, changes } = runRules({});
    if (count > 0) {
      setRuleRunChanges(changes);
    } else {
      toast.info("No uncategorised transactions matched your rules");
    }
  };

  if (loading) return <LoadingState />;

  // Opaque: sticky table cells stay stuck for the rest of the table, so each day's
  // header covers the previous ones rather than pushing them off
  const dayHeaderCell =
    "sticky top-[var(--mobile-topbar-h,0px)] z-10 px-3 py-1.5 bg-secondary border-b border-border/50";
  const selectCls = "bg-background border border-border rounded-lg px-2.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div
      // Room to scroll the last rows out from under the bulk bar
      className={cn("space-y-4 relative", selected.size > 0 && "pb-36")}
      onDragEnter={(e) => { if (isCsvDrag(e)) { e.preventDefault(); setDragDepth((d) => d + 1); } }}
      onDragOver={(e) => { if (isCsvDrag(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (isCsvDrag(e)) setDragDepth((d) => Math.max(0, d - 1)); }}
      onDrop={(e) => {
        if (!isCsvDrag(e)) return;
        e.preventDefault();
        setDragDepth(0);
        const file = e.dataTransfer.files?.[0];
        if (file) setImportFile(file);
      }}
    >
      {dragDepth > 0 && (
        <div className="fixed inset-0 lg:left-[220px] z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <div className="border-2 border-dashed border-primary rounded-2xl px-12 py-10 text-center bg-card">
            <UploadCloud className="w-10 h-10 mx-auto text-primary mb-3" />
            <p className="text-sm font-medium text-foreground">Drop CSV to import</p>
          </div>
        </div>
      )}

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-start md:items-center justify-between gap-3"
      >
        <div className="flex-1 min-w-0 md:flex-initial">
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
          {accountCoverage.length > 0 && (
            <p
              className="text-xs text-muted-foreground mt-1"
              title="Latest transaction per account across all years — export from your bank from here onwards"
            >
              Data until:{" "}
              {accountCoverage.map((c, i) => (
                <span key={c.account}>
                  {i > 0 && " · "}
                  <span className="font-medium text-foreground">{c.account}</span>{" "}
                  {formatIsoDate(c.to)}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInput.current?.click()}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
            title="Import a bank CSV — or just drop one anywhere on this page"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Import CSV
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setImportFile(file);
              e.target.value = "";
            }}
          />
          {rules.length > 0 && uncatCount > 0 && (
            <button
              onClick={applyRulesNow}
              className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Apply Rules
            </button>
          )}
          <button
            onClick={exportFiltered}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
          <button
            onClick={() => { setEditTxn(null); setDialogOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2.5 md:py-2 rounded-lg text-sm md:text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4 md:w-3.5 md:h-3.5" />
            Add
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="md:hidden p-2.5 rounded-lg border border-border hover:bg-accent transition-colors"
                aria-label="More actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                <UploadCloud /> Import CSV
              </DropdownMenuItem>
              {rules.length > 0 && uncatCount > 0 && (
                <DropdownMenuItem onSelect={applyRulesNow}>
                  <Wand2 /> Apply Rules
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={exportFiltered}>
                <Download /> Export {hasFilters ? "filtered" : "all"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>

      {/* Filter bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="hidden md:block bg-card rounded-xl border border-border p-3 space-y-2.5"
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
          <CategoryTreeDropdown
            value={category}
            onChange={setCategory}
            allLabel="All categories"
            className="w-auto min-w-[180px] max-w-[280px] !py-2 !text-xs"
          />
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

      {/* Phone filter bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="md:hidden space-y-2"
      >
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="w-full pl-9 pr-3 py-2.5 text-base bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={() => setFiltersOpen(true)}
            className={cn(
              "flex items-center gap-1.5 px-3 rounded-lg border text-sm font-medium transition-colors",
              sheetFilterCount > 0 || !isDefaultSort
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-foreground"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {sheetFilterCount > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] leading-5 text-center">
                {sheetFilterCount}
              </span>
            )}
          </button>
        </div>
        {(sheetFilterCount > 0 || !isDefaultSort) && (
          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5">
            {category && <FilterChip label={nameOf(category)} onRemove={() => setCategory("")} />}
            {account && <FilterChip label={account} onRemove={() => setAccount("")} />}
            {(dateFrom || dateTo) && (
              <FilterChip
                label={dateFrom && dateTo
                  ? `${formatIsoDate(dateFrom)} – ${formatIsoDate(dateTo)}`
                  : dateFrom ? `From ${formatIsoDate(dateFrom)}` : `Until ${formatIsoDate(dateTo)}`}
                onRemove={() => { setDateFrom(""); setDateTo(""); }}
              />
            )}
            {uncatOnly && <FilterChip label="Uncategorised" onRemove={() => setUncatOnly(false)} />}
            {dupOnly && <FilterChip label="Possible duplicates" onRemove={() => setDupOnly(false)} />}
            {!isDefaultSort && (
              <FilterChip
                label={SORT_OPTIONS.find((o) => o.value === sortValue)?.label ?? ""}
                onRemove={() => { setSortField("date"); setSortDir("desc"); }}
              />
            )}
          </div>
        )}
      </motion.div>

      {/* Suggested rules covering the uncategorised pile */}
      {ruleSuggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="bg-card rounded-xl border border-border p-3"
        >
          <p className="hidden md:flex items-center gap-1.5 text-xs font-medium text-foreground mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-sandstone" />
            Suggested rules — keywords covering your uncategorised transactions (click to review)
          </p>
          <button
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="md:hidden flex w-full items-center gap-1.5 text-sm font-medium text-foreground"
          >
            <Lightbulb className="w-4 h-4 text-sandstone" />
            {ruleSuggestions.length} suggested rule{ruleSuggestions.length === 1 ? "" : "s"}
            <span className="text-xs font-normal text-muted-foreground">for uncategorised</span>
            <ChevronDown className={cn("w-4 h-4 ml-auto text-muted-foreground transition-transform", showSuggestions && "rotate-180")} />
          </button>
          <div className={cn("flex-wrap gap-1.5 mt-2.5 md:mt-0", showSuggestions ? "flex" : "hidden md:flex")}>
            {ruleSuggestions.map((s) => (
              <button
                key={s.pattern}
                onClick={() => setRuleSeed({ pattern: s.pattern, categoryId: s.suggestedCategoryId ?? "" })}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] border border-border hover:bg-accent hover:border-primary/40 transition-colors"
                title={`Covers ${s.count} uncategorised transaction${s.count === 1 ? "" : "s"} — opens the rule dialog to review the matches`}
              >
                <Wand2 className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">"{s.pattern}"</span>
                <span className="text-muted-foreground">×{s.count}</span>
                {s.suggestedCategoryId && (
                  <span className="text-primary">→ {nameOf(s.suggestedCategoryId)}</span>
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
        // overflow-clip (not hidden) keeps the sticky day headers working
        className="bg-card rounded-xl border border-border overflow-clip"
      >
        {isMobile ? (
          <TransactionMobileList
            rows={visible}
            groupByDay={groupByDay}
            dayTotals={dayTotals}
            selected={selected}
            duplicateIds={duplicateIds}
            onOpen={(t) => { setSheetTxn(t); setSheetOpen(true); }}
            onToggleSelect={(t) => toggleOne(t.id)}
            onCategory={(t, id) => {
              updateTransactions([t.id], { categoryId: id });
              toast.success(`Categorised as ${nameOf(id)}`);
            }}
          />
        ) : (
        // Horizontal scroll only where the table can be too wide: a scroll container
        // would also stop the day headers sticking, and from xl the columns always fit
        <div className="overflow-x-auto xl:overflow-visible">
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
                {/* w-px columns shrink to their content, so the spare width goes to Category,
                    whose content sits right beside the actions: what happened on the left,
                    what to do about it on the right */}
                <SortHeader field="date" sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="w-px" />
                <SortHeader field="description" sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="w-px" />
                <SortHeader field="amount" sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="w-px pl-8" alignRight />
                <SortHeader field="category" sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="hidden md:table-cell pl-6" alignRight />
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {visible.map((t, i) => (
                <Fragment key={t.id}>
                {groupByDay && t.dateStr !== visible[i - 1]?.dateStr && (
                  <tr className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <td colSpan={3} className={dayHeaderCell}>{formatDayHeading(t.date)}</td>
                    <td className={cn(dayHeaderCell, "text-right tabular-nums normal-case")}>
                      {formatCurrency(dayTotals.get(t.dateStr) ?? 0)}
                    </td>
                    <td colSpan={2} className={dayHeaderCell} />
                  </tr>
                )}
                <tr
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
                  {/* Grouped by day, the date lives in the day header */}
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {!groupByDay && formatDate(t.date)}
                  </td>
                  <td className="px-3 py-2 text-xs text-foreground">
                    <div className="w-[240px] lg:w-[300px] xl:w-[360px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium">{t.description}</span>
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
                        <div className="truncate text-[10px] text-muted-foreground">{t.notes}</div>
                      )}
                    </div>
                  </td>
                  <td
                    className={cn(
                      "pl-8 pr-3 py-2 text-xs font-medium text-right whitespace-nowrap tabular-nums",
                      t.amount < 0 ? "text-eucalyptus" : "text-foreground"
                    )}
                  >
                    {formatCurrencyExact(t.amount)}
                  </td>
                  {/* Right-aligned against the actions: "• Group  Category ⌄", picker last so the
                      chevrons line up; the label is left out when it would repeat the category */}
                  <td className="pl-6 pr-3 py-2 text-xs hidden md:table-cell">
                    <div className="flex flex-wrap items-center justify-end gap-x-1.5">
                      {t.group !== t.category && (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground">
                          <span
                            className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ backgroundColor: groupColors[t.group] }}
                          />
                          {t.group}
                        </span>
                      )}
                      <CategoryPicker
                        value={t.categoryId}
                        onChange={(id) => {
                          if (id !== t.categoryId) updateTransactions([t.id], { categoryId: id });
                        }}
                        className={cn(
                          "w-auto max-w-[220px] py-1 px-1.5 text-xs border-transparent bg-transparent hover:border-border hover:bg-background cursor-pointer",
                          t.categoryId === UNCATEGORIZED_ID && "text-terracotta font-medium"
                        )}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center">
                      {(() => {
                        const matchingRule = matchingRuleFor(t);
                        return (
                          <button
                            onClick={() => openRuleFor(t)}
                            className={cn(
                              "p-1.5 rounded-md hover:bg-accent transition-colors",
                              matchingRule
                                ? "text-primary/60 hover:text-primary"
                                : "text-muted-foreground hover:text-primary"
                            )}
                            title={
                              matchingRule
                                ? `Matched by rule "${matchingRule.pattern}" → ${nameOf(matchingRule.categoryId)} — click to edit it`
                                : "Create rule from this transaction"
                            }
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                          </button>
                        );
                      })()}
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {visible.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {transactions.length === 0
              ? "No transactions yet — drop a bank CSV here to get started."
              : "Nothing matches these filters."}
          </div>
        )}

        {hasMore && (
          <div ref={loadMoreRef} className="p-3 text-center border-t border-border">
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
                <div className="flex items-center gap-3">
                  {selected.size < filtered.length && (
                    <button
                      onClick={() => setSelected(new Set(filtered.map((t) => t.id)))}
                      className="md:hidden text-xs font-medium text-primary py-1"
                    >
                      Select all {filtered.length}
                    </button>
                  )}
                  <button
                    onClick={clearSelection}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 py-1"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CategoryPicker
                  value={bulkCategory}
                  onChange={setBulkCategory}
                  allowEmpty
                  emptyLabel="Choose category…"
                  className="flex-1 basis-full md:basis-auto min-w-0 md:min-w-[220px] text-base md:text-sm"
                />
                <button
                  onClick={applyBulk}
                  className="flex-1 md:flex-initial px-3.5 py-2.5 md:py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
                >
                  Apply to {selected.size}
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 md:py-2 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10"
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

      <TransactionSheet
        transaction={sheetTxn}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        matchingRule={sheetTxn ? matchingRuleFor(sheetTxn) : undefined}
        onRule={() => sheetTxn && openRuleFor(sheetTxn)}
        onSplit={() => setSplitTxn(sheetTxn)}
        onEdit={() => { setEditTxn(sheetTxn); setDialogOpen(true); }}
        onSelect={() => sheetTxn && toggleOne(sheetTxn.id)}
      />

      {/* Phone filters + sort */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[85vh] overflow-y-auto gap-0 pb-[max(0px,env(safe-area-inset-bottom))]"
          // Focus the panel, not the sort select: phones open a focused select's picker
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        >
          <SheetHeader>
            <SheetTitle>Filter & sort</SheetTitle>
          </SheetHeader>
          <div className="px-4 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Sort by</span>
              <select
                value={sortValue}
                onChange={(e) => {
                  const [field, dir] = e.target.value.split("-") as [SortField, "asc" | "desc"];
                  setSortField(field);
                  setSortDir(dir);
                }}
                className={cn(selectCls, "w-full text-base py-2.5")}
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Category</span>
              <CategoryTreeDropdown
                value={category}
                onChange={setCategory}
                allLabel="All categories"
                className="!text-base"
              />
            </div>
            {accounts.length > 0 && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Account</span>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className={cn(selectCls, "w-full text-base py-2.5")}
                >
                  <option value="">All accounts</option>
                  {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1.5 min-w-0">
                <span className="text-xs font-medium text-muted-foreground">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className={cn(selectCls, "w-full text-base py-2.5")}
                />
              </label>
              <label className="block space-y-1.5 min-w-0">
                <span className="text-xs font-medium text-muted-foreground">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={cn(selectCls, "w-full text-base py-2.5")}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setUncatOnly(!uncatOnly)}
                className={cn(
                  "px-3.5 py-2 rounded-full text-sm font-medium border transition-colors",
                  uncatOnly
                    ? "bg-terracotta/10 border-terracotta/40 text-terracotta"
                    : "border-border text-muted-foreground"
                )}
              >
                Uncategorised only
              </button>
              <button
                onClick={() => setDupOnly(!dupOnly)}
                className={cn(
                  "px-3.5 py-2 rounded-full text-sm font-medium border transition-colors",
                  dupOnly
                    ? "bg-sandstone/10 border-sandstone/40 text-sandstone"
                    : "border-border text-muted-foreground"
                )}
              >
                Possible duplicates
              </button>
            </div>
          </div>
          <SheetFooter className="flex-row">
            <button
              onClick={() => { clearFilters(); setSortField("date"); setSortDir("desc"); }}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-border"
            >
              Reset
            </button>
            <button
              onClick={() => setFiltersOpen(false)}
              className="flex-[2] py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground"
            >
              Show {filtered.length} transaction{filtered.length === 1 ? "" : "s"}
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
        seedCategoryId={ruleSeed?.categoryId ?? ""}
        editRule={ruleSeed?.edit ?? null}
      />

      <RuleRunReviewDialog
        open={ruleRunChanges !== null}
        onOpenChange={(o) => !o && setRuleRunChanges(null)}
        changes={ruleRunChanges ?? []}
      />

      <ImportDialog file={importFile} onClose={() => setImportFile(null)} onImported={onImported} />
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1 shrink-0 pl-3 pr-2 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-xs font-medium text-primary"
    >
      {label}
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

interface SortHeaderProps {
  field: SortField;
  sortField: SortField;
  sortDir: "asc" | "desc";
  onSort: (field: SortField) => void;
  className?: string;
  alignRight?: boolean;
}

/** Column header that sorts by its field; the active one shows its direction */
function SortHeader({ field, sortField, sortDir, onSort, className, alignRight }: SortHeaderProps) {
  const active = field === sortField;
  const Icon = !active ? ArrowUpDown : sortDir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-xs font-medium uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap",
        alignRight ? "text-right" : "text-left",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
      onClick={() => onSort(field)}
    >
      <span className={cn("flex items-center gap-1", alignRight && "justify-end")}>
        {field}
        <Icon className={cn("w-3 h-3", !active && "opacity-40")} />
      </span>
    </th>
  );
}
