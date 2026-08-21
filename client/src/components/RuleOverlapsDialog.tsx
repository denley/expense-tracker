/*
  Inspect rule overlaps over the real transaction set: pairs of enabled rules
  that both match the same transactions but assign different categories, shown
  as "winner beats loser · N transactions" with samples. One-click fix per
  pair: move the losing rule ahead of the winner (rules.csv order = priority).
*/
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Rule, StoredTransaction } from "@/lib/types";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrencyExact, formatDate } from "@/lib/utils";
import { Layers, ArrowUp } from "lucide-react";
import { toast } from "sonner";

export interface OverlapPair {
  /** The rule that currently wins (earlier in rules.csv) */
  winner: Rule;
  /** The later rule it shadows, assigning a different category */
  loser: Rule;
  /** Transactions both rules match */
  txns: StoredTransaction[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairs: OverlapPair[];
  /** Transactions matched by several rules that all agree — order can't matter */
  agreeingCount: number;
}

const SAMPLE_ROWS = 5;

export default function RuleOverlapsDialog({ open, onOpenChange, pairs, agreeingCount }: Props) {
  const { nameOf, moveRuleBefore } = useExpenses();

  const ruleChip = (r: Rule) => (
    <span className="whitespace-nowrap">
      <span className="font-medium text-foreground">"{r.pattern}"</span>{" "}
      <span className="text-muted-foreground">→ {nameOf(r.categoryId)}</span>
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" /> Overlapping rules
          </DialogTitle>
          <DialogDescription>
            When a transaction matches several rules, the first one in rules.csv wins.
            Listed below are rule pairs that match the same transactions but disagree
            about the category — reorder them if the wrong one is winning.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {pairs.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-2">
              No conflicts — no transaction is matched by two rules that disagree about
              its category.
            </p>
          )}

          {pairs.map((p) => (
            <div key={`${p.winner.id}|${p.loser.id}`} className="border border-border rounded-lg p-3 space-y-2">
              <p className="text-xs leading-relaxed">
                {ruleChip(p.winner)}{" "}
                <span className="text-terracotta font-medium">wins over</span>{" "}
                {ruleChip(p.loser)}
                <span className="text-muted-foreground">
                  {" "}· {p.txns.length} transaction{p.txns.length === 1 ? "" : "s"}
                </span>
              </p>

              <div className="border border-border/60 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {p.txns.slice(0, SAMPLE_ROWS).map((t) => (
                      <tr key={t.id} className="border-b border-border/40 last:border-0">
                        <td className="px-2.5 py-1 whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(new Date(t.date))}
                        </td>
                        <td className="px-2.5 py-1 max-w-[260px] truncate">{t.description}</td>
                        <td className="px-2.5 py-1 text-right whitespace-nowrap tabular-nums">
                          {formatCurrencyExact(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.txns.length > SAMPLE_ROWS && (
                  <p className="px-2.5 py-1 text-[10px] text-muted-foreground border-t border-border/40">
                    …and {p.txns.length - SAMPLE_ROWS} more
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  moveRuleBefore(p.loser.id, p.winner.id);
                  toast.success(
                    `"${p.loser.pattern}" now runs before "${p.winner.pattern}"`
                  );
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-border hover:bg-accent"
              >
                <ArrowUp className="w-3 h-3" />
                Let "{p.loser.pattern}" win instead
              </button>
            </div>
          ))}

          {agreeingCount > 0 && (
            <p className="text-[11px] text-muted-foreground pt-1">
              {agreeingCount} other transaction{agreeingCount === 1 ? " is" : "s are"} matched
              by several rules that agree on the category — order doesn't matter there.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
