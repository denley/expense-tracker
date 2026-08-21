/*
  DESIGN: Scandinavian Analytical — Rules
  Dedicated manager for the auto-categorisation rules:
  - suggestions first: patterns covering the uncategorised pile, and merchants
    learned from already-categorised history
  - rules grouped by target category (in tree order) with a search filter
  - live per-rule stats: transactions matched, uncategorised it would cover,
    and conflicts (matches currently filed under a different category)
  - click a rule to edit it in the same dialog that creates rules
*/
import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useExpenses } from "@/contexts/ExpenseContext";
import LoadingState from "@/components/LoadingState";
import RuleQuickDialog from "@/components/RuleQuickDialog";
import RuleRunReviewDialog from "@/components/RuleRunReviewDialog";
import RuleOverlapsDialog, { type OverlapPair } from "@/components/RuleOverlapsDialog";
import {
  ruleMatches, suggestRulesFromHistory, suggestPatternsForUncategorised,
  type RuleChange,
} from "@/lib/rules";
import type { Rule } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import {
  Wand2, Plus, Trash2, Power, Lightbulb, Search, AlertTriangle, Pencil, Regex, ReceiptText, Layers,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/pickers";

interface RuleStats {
  /** Transactions this rule wins (first-match attribution, like a real run) */
  matches: number;
  /** …of which currently uncategorised (a run would fill these in) */
  uncat: number;
  /** …of which filed under a DIFFERENT category (conflicts with the rule) */
  conflicts: number;
}

const HISTORY_PREVIEW = 10;

export default function Rules() {
  const {
    loading, storedTransactions, tree, nameOf, pathOf, groupColors,
    rules, addRule, updateRule, deleteRule, runRules,
  } = useExpenses();

  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [dialog, setDialog] = useState<{ pattern: string; categoryId: string; edit?: Rule } | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [overlapsOpen, setOverlapsOpen] = useState(false);
  const [ruleRunChanges, setRuleRunChanges] = useState<RuleChange[] | null>(null);

  const uncatCount = useMemo(
    () => storedTransactions.filter((t) => !t.categoryId || t.categoryId === UNCATEGORIZED_ID).length,
    [storedTransactions]
  );

  // What a real run would do: attribute each transaction to its first matching
  // enabled rule, then split into uncategorised (fillable) vs conflicts
  const ruleStats = useMemo(() => {
    const stats = new Map<string, RuleStats>();
    const active = rules.filter((r) => r.enabled && r.categoryId && tree.byId.has(r.categoryId));
    if (active.length === 0) return stats;
    for (const t of storedTransactions) {
      const rule = active.find((r) => ruleMatches(r, t.description));
      if (!rule) continue;
      let s = stats.get(rule.id);
      if (!s) stats.set(rule.id, (s = { matches: 0, uncat: 0, conflicts: 0 }));
      s.matches++;
      if (!t.categoryId || t.categoryId === UNCATEGORIZED_ID) s.uncat++;
      else if (t.categoryId !== rule.categoryId) s.conflicts++;
    }
    return stats;
  }, [rules, storedTransactions, tree]);

  const totalConflicts = useMemo(
    () => [...ruleStats.values()].reduce((sum, s) => sum + s.conflicts, 0),
    [ruleStats]
  );

  // Transactions matched by 2+ enabled rules, aggregated into winner/loser
  // pairs when the rules disagree about the category (order decides those)
  const overlaps = useMemo(() => {
    const active = rules.filter((r) => r.enabled && r.categoryId && tree.byId.has(r.categoryId));
    const byPair = new Map<string, OverlapPair>();
    let agreeingCount = 0;
    if (active.length >= 2) {
      for (const t of storedTransactions) {
        const matching = active.filter((r) => ruleMatches(r, t.description));
        if (matching.length < 2) continue;
        const winner = matching[0];
        const losers = matching.slice(1).filter((r) => r.categoryId !== winner.categoryId);
        if (losers.length === 0) {
          agreeingCount++;
          continue;
        }
        for (const loser of losers) {
          const key = `${winner.id}|${loser.id}`;
          let p = byPair.get(key);
          if (!p) byPair.set(key, (p = { winner, loser, txns: [] }));
          p.txns.push(t);
        }
      }
    }
    const pairs = [...byPair.values()].sort((a, b) => b.txns.length - a.txns.length);
    return { pairs, agreeingCount };
  }, [rules, storedTransactions, tree]);

  const uncatSuggestions = useMemo(
    () => suggestPatternsForUncategorised(storedTransactions, rules),
    [storedTransactions, rules]
  );

  // Skip merchants an enabled rule already covers — the engine only dedupes
  // exact patterns, so "WOOLWORTHS 1234" would be suggested alongside a
  // broader "WOOLWORTHS" rule
  const historySuggestions = useMemo(() => {
    const active = rules.filter((r) => r.enabled);
    return suggestRulesFromHistory(storedTransactions, rules, (id) => tree.isArchived(id))
      .filter((s) => !active.some((r) => ruleMatches(r, s.pattern)));
  }, [storedTransactions, rules, tree]);

  // Search over pattern and target-category path, then group by category in
  // tree display order; rules pointing at deleted nodes sink to the bottom
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = q
      ? rules.filter(
          (r) =>
            r.pattern.toLowerCase().includes(q) ||
            pathOf(r.categoryId).toLowerCase().includes(q)
        )
      : rules;
    const byCat = new Map<string, Rule[]>();
    for (const r of shown) {
      const list = byCat.get(r.categoryId);
      if (list) list.push(r);
      else byCat.set(r.categoryId, [r]);
    }
    const ordered = [
      ...tree.nodes.map((n) => n.id).filter((id) => byCat.has(id)),
      ...[...byCat.keys()].filter((id) => !tree.byId.has(id)),
    ];
    return ordered.map((id) => ({
      categoryId: id,
      missing: !tree.byId.has(id),
      rules: [...byCat.get(id)!].sort((a, b) => a.pattern.localeCompare(b.pattern)),
    }));
  }, [rules, search, tree, pathOf]);

  const disabledCount = useMemo(() => rules.filter((r) => !r.enabled).length, [rules]);

  // The toast outlives this render — its Undo must call the LATEST addRule,
  // not the one captured before the delete re-rendered (which still closes
  // over a rules array containing the deleted rule)
  const addRuleRef = useRef(addRule);
  addRuleRef.current = addRule;

  const removeRule = (r: Rule) => {
    deleteRule(r.id);
    toast.success(`Deleted rule "${r.pattern}"`, {
      action: {
        label: "Undo",
        onClick: () =>
          addRuleRef.current({ pattern: r.pattern, isRegex: r.isRegex, categoryId: r.categoryId, enabled: r.enabled }),
      },
    });
  };

  const runOnUncategorised = () => {
    const { count, changes } = runRules({});
    if (count > 0) setRuleRunChanges(changes);
    else toast.info("No uncategorised matches");
  };

  if (loading) return <LoadingState />;

  const sectionCls = "bg-card rounded-xl border border-border p-5";
  const historyShown = showAllHistory ? historySuggestions : historySuggestions.slice(0, HISTORY_PREVIEW);

  return (
    <div className="space-y-6 max-w-[980px]">
      {/* Header + run actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Rules</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            "Description contains X → assign category." Rules run automatically during CSV
            import and on demand here. When several rules match, the first one in rules.csv wins.
          </p>
        </div>
        {rules.length > 0 && (
          <div className="flex gap-2">
            {rules.length >= 2 && (
              <button
                onClick={() => setOverlapsOpen(true)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent",
                  overlaps.pairs.length > 0 ? "text-terracotta" : "text-muted-foreground"
                )}
                title="Transactions matched by more than one rule, and which rule wins"
              >
                <Layers className="w-3.5 h-3.5" />
                Overlaps{overlaps.pairs.length > 0 && ` (${overlaps.pairs.length})`}
              </button>
            )}
            <button
              onClick={runOnUncategorised}
              disabled={uncatCount === 0}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Run on {uncatCount} uncategorised
            </button>
            <button
              onClick={() => setConfirmOverwrite(true)}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent text-muted-foreground"
            >
              Re-run on everything
            </button>
          </div>
        )}
      </motion.div>

      {/* Suggestions — the "what should I add next" queue, kept on top */}
      {(uncatSuggestions.length > 0 || historySuggestions.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className={cn(sectionCls, "space-y-4")}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Lightbulb className="w-4 h-4 text-sandstone" /> Suggested rules
            <span className="text-xs font-normal text-muted-foreground">— click one to review its matches before saving</span>
          </h3>

          {uncatSuggestions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Would cover your uncategorised transactions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {uncatSuggestions.map((s) => (
                  <button
                    key={s.pattern}
                    onClick={() => setDialog({ pattern: s.pattern, categoryId: s.suggestedCategoryId ?? "" })}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] border border-border hover:bg-accent hover:border-primary/40 transition-colors"
                    title={`Covers ${s.count} uncategorised transaction${s.count === 1 ? "" : "s"}`}
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
            </div>
          )}

          {historySuggestions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                From your history — merchants you always file the same way
              </p>
              <div className="flex flex-wrap gap-1.5">
                {historyShown.map((s) => (
                  <button
                    key={s.pattern}
                    onClick={() => setDialog({ pattern: s.pattern, categoryId: s.categoryId })}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] border border-border hover:bg-accent hover:border-primary/40 transition-colors"
                    title={`Seen ${s.count} times, always ${nameOf(s.categoryId)}`}
                  >
                    <span className="font-medium">"{s.pattern}"</span>
                    <span className="text-primary">→ {nameOf(s.categoryId)}</span>
                    <span className="text-muted-foreground">×{s.count}</span>
                  </button>
                ))}
                {historySuggestions.length > HISTORY_PREVIEW && (
                  <button
                    onClick={() => setShowAllHistory((v) => !v)}
                    className="px-2.5 py-1.5 rounded-full text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    {showAllHistory ? "Show fewer" : `+${historySuggestions.length - HISTORY_PREVIEW} more`}
                  </button>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* The rules, grouped by target category */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className={sectionCls}
      >
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules by pattern or category…"
              className={cn(inputCls, "pl-8")}
            />
          </div>
          <button
            onClick={() => setDialog({ pattern: "", categoryId: "" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" /> New rule
          </button>
        </div>

        {rules.length > 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            {rules.length} rule{rules.length === 1 ? "" : "s"}
            {disabledCount > 0 && <> · {disabledCount} disabled</>}
            {totalConflicts > 0 ? (
              <> · <span className="text-terracotta font-medium">{totalConflicts} conflicting transactions</span></>
            ) : (
              <> · no conflicts</>
            )}
          </p>
        )}

        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No rules yet. Add one above, or click a suggestion — you can also create rules
            straight from a transaction with its wand icon.
          </p>
        ) : groups.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No rules match your search.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const root = tree.rootOf(g.categoryId);
              const groupConflicts = g.rules.reduce(
                (sum, r) => sum + (ruleStats.get(r.id)?.conflicts ?? 0), 0
              );
              return (
                <div key={g.categoryId}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {g.missing ? (
                      <AlertTriangle className="w-3 h-3 text-terracotta" />
                    ) : (
                      <span
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: root ? groupColors[root.name] : undefined }}
                      />
                    )}
                    <span className={cn("text-xs font-semibold", g.missing ? "text-terracotta" : "text-foreground")}>
                      {g.missing ? `Deleted category (${g.categoryId})` : pathOf(g.categoryId)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {g.rules.length} rule{g.rules.length === 1 ? "" : "s"}
                      {groupConflicts > 0 && (
                        <> · <span className="text-terracotta">{groupConflicts} conflicting</span></>
                      )}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {g.rules.map((r) => {
                      const s = ruleStats.get(r.id);
                      return (
                        <div
                          key={r.id}
                          onClick={() => setDialog({ pattern: r.pattern, categoryId: r.categoryId, edit: r })}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/70",
                            "cursor-pointer hover:bg-accent/50 hover:border-primary/30 transition-colors",
                            !r.enabled && "opacity-50"
                          )}
                          title="Click to edit"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateRule(r.id, { enabled: !r.enabled });
                            }}
                            className={cn("shrink-0", r.enabled ? "text-eucalyptus" : "text-muted-foreground")}
                            title={r.enabled ? "Disable" : "Enable"}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-medium truncate">"{r.pattern}"</span>
                          {r.isRegex && (
                            <span title="Regular expression">
                              <Regex className="w-3 h-3 text-muted-foreground shrink-0" />
                            </span>
                          )}
                          <div className="flex-1" />
                          {r.enabled && (s?.conflicts ?? 0) > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-terracotta/15 text-terracotta whitespace-nowrap">
                              {s!.conflicts} conflicting
                            </span>
                          )}
                          {r.enabled && (
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                              {s ? (
                                <>
                                  {s.matches} matched
                                  {s.uncat > 0 && <> · <span className="text-primary">{s.uncat} to fill</span></>}
                                </>
                              ) : (
                                <span className="italic">no matches</span>
                              )}
                            </span>
                          )}
                          {!r.isRegex && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/transactions?q=${encodeURIComponent(r.pattern)}`);
                              }}
                              className="text-muted-foreground/60 hover:text-primary shrink-0"
                              title="View matching transactions"
                            >
                              <ReceiptText className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRule(r);
                            }}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                            title="Delete rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      <RuleQuickDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        seedPattern={dialog?.pattern ?? ""}
        seedCategoryId={dialog?.categoryId ?? ""}
        editRule={dialog?.edit ?? null}
      />

      {/* Re-run rules on everything confirmation */}
      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run rules on all transactions?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites the category of every transaction that matches a rule,
              including ones you categorised by hand.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const { count, changes } = runRules({ overwrite: true });
                if (count > 0) setRuleRunChanges(changes);
                else toast.info("No transactions matched a rule with a different category");
                setConfirmOverwrite(false);
              }}
            >
              Re-run rules
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RuleRunReviewDialog
        open={ruleRunChanges !== null}
        onOpenChange={(o) => !o && setRuleRunChanges(null)}
        changes={ruleRunChanges ?? []}
      />

      <RuleOverlapsDialog
        open={overlapsOpen}
        onOpenChange={setOverlapsOpen}
        pairs={overlaps.pairs}
        agreeingCount={overlaps.agreeingCount}
      />
    </div>
  );
}
