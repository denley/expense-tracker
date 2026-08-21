/*
  Create or edit an auto-categorisation rule:
  - editable match pattern (pre-filled with the normalized merchant name, or the
    rule being edited), with an optional regex mode
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
import { ruleMatches } from "@/lib/rules";
import type { Rule } from "@/lib/types";
import { formatCurrencyExact, formatDate } from "@/lib/utils";
import { Wand2, Pencil, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled match pattern, e.g. the normalized merchant name */
  seedPattern: string;
  /** Pre-selected category node id ("" = none yet) */
  seedCategoryId: string;
  /** When set, the dialog edits this rule in place instead of creating a new one */
  editRule?: Rule | null;
}

export default function RuleQuickDialog({ open, onOpenChange, seedPattern, seedCategoryId, editRule }: Props) {
  const { allTransactions, rules, addRule, updateRule, updateTransactions, nameOf } = useExpenses();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [reassignOthers, setReassignOthers] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPattern(editRule ? editRule.pattern : seedPattern);
    setCategoryId(editRule ? editRule.categoryId : seedCategoryId);
    setIsRegex(editRule?.isRegex ?? false);
    setReassignOthers(false);
  }, [open, seedPattern, seedCategoryId, editRule]);

  const trimmed = pattern.trim();
  const tooShort = trimmed.length < 3;

  const regexError = useMemo(() => {
    if (!isRegex || !trimmed) return false;
    try {
      new RegExp(trimmed, "i");
      return false;
    } catch {
      return true;
    }
  }, [isRegex, trimmed]);

  const matches = useMemo(() => {
    if (tooShort || regexError) return [];
    const probe = { pattern: trimmed, isRegex } as Rule;
    return allTransactions.filter((t) => ruleMatches(probe, t.description));
  }, [allTransactions, trimmed, isRegex, tooShort, regexError]);

  const uncat = useMemo(() => matches.filter((t) => t.categoryId === UNCATEGORIZED_ID), [matches]);
  const alreadyThis = useMemo(
    () => matches.filter((t) => categoryId && t.categoryId === categoryId),
    [matches, categoryId]
  );
  const others = useMemo(
    () => matches.filter((t) => t.categoryId !== UNCATEGORIZED_ID && (!categoryId || t.categoryId !== categoryId)),
    [matches, categoryId]
  );

  const duplicateRule = useMemo(
    () =>
      rules.find(
        (r) =>
          r.id !== editRule?.id &&
          !r.isRegex &&
          !isRegex &&
          r.pattern.trim().toLowerCase() === trimmed.toLowerCase()
      ),
    [rules, trimmed, isRegex, editRule]
  );

  const applyCount = uncat.length + (reassignOthers ? others.length : 0);

  const save = (applyNow: boolean) => {
    if (tooShort) {
      toast.error("Use at least 3 characters so the rule doesn't over-match");
      return;
    }
    if (regexError) {
      toast.error("The regular expression is invalid");
      return;
    }
    if (!categoryId) {
      toast.error("Pick the category the rule assigns");
      return;
    }
    if (editRule) {
      updateRule(editRule.id, { pattern: trimmed, isRegex, categoryId });
    } else {
      addRule({ pattern: trimmed, isRegex, categoryId, enabled: true });
    }
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

  // Conflicts first so they're never buried, then uncategorised, then the
  // already-correct rows; capped only to keep pathological patterns renderable
  const previewRows = [...others, ...uncat, ...alreadyThis].slice(0, 500);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editRule ? (
              <>
                <Pencil className="w-4 h-4 text-primary" /> Edit categorisation rule
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4 text-primary" /> Create categorisation rule
              </>
            )}
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
                Description {isRegex ? "matches regex" : "contains"}
              </label>
              <input
                autoFocus
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder='e.g. "WOOLWORTHS"'
                className={inputCls}
              />
              <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isRegex}
                  onChange={(e) => setIsRegex(e.target.checked)}
                  className="accent-[var(--color-eucalyptus)]"
                />
                Regular expression
              </label>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Assign category
              </label>
              <CategoryPicker value={categoryId} onChange={setCategoryId} allowEmpty emptyLabel="Choose category…" />
            </div>
          </div>

          {regexError && (
            <p className="flex items-center gap-1.5 text-xs text-terracotta">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Invalid regular expression.
            </p>
          )}

          {duplicateRule && (
            <p className="flex items-center gap-1.5 text-xs text-terracotta">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              A rule with this exact pattern already exists (→ {nameOf(duplicateRule.categoryId)}
              {duplicateRule.enabled ? "" : ", disabled"}).
              {editRule
                ? " Saving keeps both — consider deleting one on the Rules page."
                : " Saving adds a second one that never wins — edit the existing rule on the Rules page instead."}
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
              <div className="max-h-[240px] overflow-y-auto">
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
            {editRule ? "Save changes" : "Save rule only"}
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
