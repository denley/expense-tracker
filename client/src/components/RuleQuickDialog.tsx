/*
  Create an auto-categorisation rule from a single transaction:
  - editable match pattern (pre-filled with the normalized merchant name)
  - category to assign
  - live preview of every transaction the pattern matches, split into
    uncategorised / already this category / categorised differently
  - save the rule alone, or save it and categorise the matches now
*/
import { useEffect, useMemo, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CategoryPicker, inputCls } from "@/components/pickers";
import { formatCurrencyExact, formatDate } from "@/lib/utils";
import { Wand2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled match pattern, e.g. the normalized merchant name */
  seedPattern: string;
  /** Pre-selected category node id ("" = none yet) */
  seedCategoryId: string;
}

export default function RuleQuickDialog({ open, onOpenChange, seedPattern, seedCategoryId }: Props) {
  const { allTransactions, rules, addRule, updateTransactions, nameOf } = useExpenses();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reassignOthers, setReassignOthers] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPattern(seedPattern);
    setCategoryId(seedCategoryId);
    setReassignOthers(false);
  }, [open, seedPattern, seedCategoryId]);

  const trimmed = pattern.trim();
  const tooShort = trimmed.length < 3;

  const matches = useMemo(() => {
    if (tooShort) return [];
    const q = trimmed.toLowerCase();
    return allTransactions.filter((t) => t.description.toLowerCase().includes(q));
  }, [allTransactions, trimmed, tooShort]);

  const uncat = useMemo(() => matches.filter((t) => t.categoryId === UNCATEGORIZED_ID), [matches]);
  const alreadyThis = useMemo(
    () => matches.filter((t) => categoryId && t.categoryId === categoryId),
    [matches, categoryId]
  );
  const others = useMemo(
    () => matches.filter((t) => t.categoryId !== UNCATEGORIZED_ID && (!categoryId || t.categoryId !== categoryId)),
    [matches, categoryId]
  );

  const existingRule = useMemo(
    () => rules.find((r) => !r.isRegex && r.pattern.trim().toLowerCase() === trimmed.toLowerCase()),
    [rules, trimmed]
  );

  const applyCount = uncat.length + (reassignOthers ? others.length : 0);

  const save = (applyNow: boolean) => {
    if (tooShort) {
      toast.error("Use at least 3 characters so the rule doesn't over-match");
      return;
    }
    if (!categoryId) {
      toast.error("Pick the category the rule assigns");
      return;
    }
    addRule({ pattern: trimmed, isRegex: false, categoryId, enabled: true });
    if (applyNow && applyCount > 0) {
      const ids = [...uncat, ...(reassignOthers ? others : [])].map((t) => t.id);
      updateTransactions(ids, { categoryId });
      toast.success(
        `Rule saved — categorised ${ids.length} transaction${ids.length === 1 ? "" : "s"} as ${nameOf(categoryId)}`
      );
    } else {
      toast.success(`Rule saved: "${trimmed}" → ${nameOf(categoryId)}`);
    }
    onOpenChange(false);
  };

  const previewRows = matches.slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" /> Create categorisation rule
          </DialogTitle>
          <DialogDescription>
            "Description contains the pattern → assign the category." Applies to future imports,
            and optionally to matching transactions right now.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Description contains
              </label>
              <input
                autoFocus
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder='e.g. "WOOLWORTHS"'
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Assign category
              </label>
              <CategoryPicker value={categoryId} onChange={setCategoryId} allowEmpty emptyLabel="Choose category…" />
            </div>
          </div>

          {existingRule && (
            <p className="flex items-center gap-1.5 text-xs text-terracotta">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              A rule with this exact pattern already exists (→ {nameOf(existingRule.categoryId)}
              {existingRule.enabled ? "" : ", disabled"}). Saving adds a second one that never
              wins — edit the existing rule on the Data page instead.
            </p>
          )}

          {/* Live match summary */}
          <div className="bg-secondary/50 rounded-lg px-3 py-2 text-xs text-muted-foreground">
            {tooShort ? (
              "Type at least 3 characters to preview matches."
            ) : (
              <>
                Matches <span className="font-semibold text-foreground">{matches.length}</span>{" "}
                transaction{matches.length === 1 ? "" : "s"}:{" "}
                <span className="text-terracotta font-medium">{uncat.length} uncategorised</span>
                {categoryId && <> · {alreadyThis.length} already {nameOf(categoryId)}</>}
                {others.length > 0 && <> · {others.length} categorised differently</>}
              </>
            )}
          </div>

          {others.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={reassignOthers}
                onChange={(e) => setReassignOthers(e.target.checked)}
                className="accent-[var(--color-eucalyptus)]"
              />
              Also re-categorise the {others.length} currently in other categories
            </label>
          )}

          {previewRows.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="max-h-[180px] overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {previewRows.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 last:border-0">
                        <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(t.date)}
                        </td>
                        <td className="px-2.5 py-1.5 max-w-[200px] truncate">{t.description}</td>
                        <td
                          className={cn(
                            "px-2.5 py-1.5 whitespace-nowrap",
                            t.categoryId === UNCATEGORIZED_ID ? "text-terracotta" : "text-muted-foreground"
                          )}
                        >
                          {t.category}
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {formatCurrencyExact(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {matches.length > previewRows.length && (
                <p className="px-2.5 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                  …and {matches.length - previewRows.length} more
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => save(false)}
            className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
          >
            Save rule only
          </button>
          <button
            onClick={() => save(true)}
            disabled={applyCount === 0}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save & categorise {applyCount}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
