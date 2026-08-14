/*
  Split one transaction into multiple parts, each with its own amount,
  category and optional label (saved as notes). Parts keep the parent's
  date, description and account so rules and imports keep matching.
  The part amounts must add up exactly to the original amount.
*/
import { useEffect, useMemo, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Transaction } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CategoryPicker, inputCls } from "@/components/pickers";
import { formatCurrencyExact, formatDate } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
}

interface PartDraft {
  amount: string;
  categoryId: string;
  notes: string;
}

const toCents = (amount: string) => Math.round(parseFloat(amount) * 100);

export default function SplitTransactionDialog({ open, onOpenChange, transaction }: Props) {
  const { splitTransaction } = useExpenses();
  const [parts, setParts] = useState<PartDraft[]>([]);

  useEffect(() => {
    if (!open || !transaction) return;
    setParts([
      { amount: "", categoryId: transaction.categoryId, notes: "" },
      { amount: "", categoryId: UNCATEGORIZED_ID, notes: "" },
    ]);
  }, [open, transaction]);

  const parentCents = transaction ? Math.round(transaction.amount * 100) : 0;

  const remainingCents = useMemo(() => {
    const sum = parts.reduce((s, p) => {
      const c = toCents(p.amount);
      return s + (isNaN(c) ? 0 : c);
    }, 0);
    return parentCents - sum;
  }, [parts, parentCents]);

  const setPart = (i: number, patch: Partial<PartDraft>) =>
    setParts((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const addPart = () =>
    setParts((prev) => [...prev, { amount: "", categoryId: UNCATEGORIZED_ID, notes: "" }]);

  const removePart = (i: number) => setParts((prev) => prev.filter((_, j) => j !== i));

  /** Put the unassigned remainder into the first empty part, or a new one */
  const fillRemaining = () => {
    const amount = (remainingCents / 100).toFixed(2);
    const idx = parts.findIndex((p) => {
      const c = toCents(p.amount);
      return isNaN(c) || c === 0;
    });
    if (idx >= 0) setPart(idx, { amount });
    else setParts((prev) => [...prev, { amount, categoryId: UNCATEGORIZED_ID, notes: "" }]);
  };

  const save = () => {
    if (!transaction) return;
    const cents = parts.map((p) => toCents(p.amount));
    if (cents.some((c) => isNaN(c) || c === 0)) {
      toast.error("Every part needs a non-zero amount");
      return;
    }
    if (cents.reduce((s, c) => s + c, 0) !== parentCents) {
      toast.error(`Parts must add up to ${formatCurrencyExact(transaction.amount)}`);
      return;
    }
    splitTransaction(
      transaction.id,
      parts.map((p, i) => ({
        amount: cents[i] / 100,
        categoryId: p.categoryId,
        notes: p.notes.trim(),
      }))
    );
    toast.success(`Split into ${parts.length} transactions`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
          <DialogDescription>
            Replace this transaction with parts you can categorise separately. The parts
            keep its date, description and account.
          </DialogDescription>
        </DialogHeader>

        {transaction && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-accent/50 px-3 py-2 text-xs">
              <span className="truncate font-medium text-foreground">
                {transaction.description}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatDate(transaction.date)} ·{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrencyExact(transaction.amount)}
                </span>
              </span>
            </div>

            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {parts.map((p, i) => (
                <div key={i} className="grid grid-cols-[96px_1fr_auto] sm:grid-cols-[96px_1fr_1fr_auto] gap-2 items-center">
                  <input
                    type="number"
                    step="0.01"
                    value={p.amount}
                    onChange={(e) => setPart(i, { amount: e.target.value })}
                    placeholder="0.00"
                    className={inputCls}
                    autoFocus={i === 0}
                  />
                  <CategoryPicker value={p.categoryId} onChange={(categoryId) => setPart(i, { categoryId })} />
                  <input
                    value={p.notes}
                    onChange={(e) => setPart(i, { notes: e.target.value })}
                    placeholder="Label (optional)"
                    className={`${inputCls} hidden sm:block`}
                  />
                  <button
                    onClick={() => removePart(i)}
                    disabled={parts.length <= 2}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="Remove part"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={addPart}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="w-3 h-3" /> Add part
              </button>
              {remainingCents !== 0 ? (
                <button
                  onClick={fillRemaining}
                  className="text-xs text-sandstone hover:underline tabular-nums"
                  title="Assign the unallocated remainder to an empty part"
                >
                  {formatCurrencyExact(remainingCents / 100)} unallocated — assign
                </button>
              ) : (
                <span className="text-xs text-eucalyptus">Fully allocated</span>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center gap-2 sm:justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            Split into {parts.length} parts
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
