/*
  Shown after "Apply Rules": lists exactly which transactions were
  re-categorised, grouped by the rule that matched, with one-click undo.
*/
import { useMemo } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { RuleChange } from "@/lib/rules";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrencyExact, formatDate } from "@/lib/utils";
import { Wand2, Undo2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: RuleChange[];
}

export default function RuleRunReviewDialog({ open, onOpenChange, changes }: Props) {
  const { allTransactions, revertCategories, nameOf } = useExpenses();

  const txnById = useMemo(
    () => new Map(allTransactions.map((t) => [t.id, t])),
    [allTransactions]
  );

  // Group by rule pattern → assigned category
  const groups = useMemo(() => {
    const map = new Map<string, { pattern: string; to: string; items: RuleChange[] }>();
    for (const c of changes) {
      const key = `${c.pattern}|${c.toCategoryId}`;
      if (!map.has(key)) map.set(key, { pattern: c.pattern, to: nameOf(c.toCategoryId), items: [] });
      map.get(key)!.items.push(c);
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [changes, nameOf]);

  const undo = () => {
    // Only rows still filed where the run put them: never undo a later change
    revertCategories(changes.map((c) => ({ id: c.id, categoryId: c.fromCategoryId, ifCategoryId: c.toCategoryId })));
    toast.success(`Reverted ${changes.length} transaction${changes.length === 1 ? "" : "s"}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            Rules categorised {changes.length} transaction{changes.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Check the changes below — Undo puts every one back the way it was.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[420px] overflow-y-auto space-y-3 pr-1">
          {groups.map((g) => (
            <div key={`${g.pattern}→${g.to}`} className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-secondary/40 text-xs">
                <span className="font-medium">"{g.pattern}"</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium text-primary">{g.to}</span>
                <span className="text-muted-foreground ml-auto">
                  {g.items.length} transaction{g.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {g.items.map((c) => {
                    const t = txnById.get(c.id);
                    if (!t) return null;
                    return (
                      <tr key={c.id} className="border-t border-border/50">
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(t.date)}
                        </td>
                        <td className="px-3 py-1.5 max-w-[240px] truncate">{t.description}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground hidden sm:table-cell">
                          was {nameOf(c.fromCategoryId)}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {formatCurrencyExact(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          <button
            onClick={undo}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10"
          >
            <Undo2 className="w-3.5 h-3.5" /> Undo all
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            Looks good
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
