/*
  Edit (or create) a single transaction in a dialog.
  Pass transaction=null with open=true for "add transaction" mode.
  The group is derived from the category (strict tree) and shown read-only.
*/
import { useEffect, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Transaction } from "@/lib/types";
import { UNCATEGORIZED } from "@/lib/types";
import { uid } from "@/lib/db";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CategoryPicker, inputCls } from "@/components/pickers";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null; // null = create mode
}

export default function TransactionEditDialog({ open, onOpenChange, transaction }: Props) {
  const { updateTransactions, addTransactions, deleteTransactions, groupOf } = useExpenses();

  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(UNCATEGORIZED);
  const [account, setAccount] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setDate(transaction.dateStr);
      setDescription(transaction.description);
      setAmount(String(transaction.amount));
      setCategory(transaction.category);
      setAccount(transaction.account);
      setNotes(transaction.notes);
    } else {
      setDate(new Date().toISOString().slice(0, 10));
      setDescription("");
      setAmount("");
      setCategory(UNCATEGORIZED);
      setAccount("");
      setNotes("");
    }
  }, [open, transaction]);

  const save = () => {
    const amt = parseFloat(amount);
    if (!date || isNaN(amt)) {
      toast.error("A valid date and amount are required");
      return;
    }
    if (transaction) {
      updateTransactions([transaction.id], {
        date,
        description,
        amount: amt,
        category,
        account,
        notes,
      });
      toast.success("Transaction updated");
    } else {
      addTransactions([
        {
          id: uid(),
          date,
          description,
          amount: amt,
          category,
          group: groupOf(category),
          account,
          notes,
        },
      ]);
      toast.success("Transaction added");
    }
    onOpenChange(false);
  };

  const remove = () => {
    if (!transaction) return;
    deleteTransactions([transaction.id]);
    toast.success("Transaction deleted");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{transaction ? "Edit Transaction" : "Add Transaction"}</DialogTitle>
          <DialogDescription>
            {transaction
              ? "Change any field — edits are saved locally."
              : "Manually record a transaction."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Amount (negative = income/refund)
              </label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Merchant or description"
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Category <span className="normal-case font-normal">(group: {groupOf(category)})</span>
            </label>
            <CategoryPicker value={category} onChange={setCategory} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Account</label>
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="e.g. ANZ Visa"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          {transaction ? (
            <button
              onClick={remove}
              className="text-xs font-medium text-destructive hover:underline"
            >
              Delete transaction
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
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
              {transaction ? "Save Changes" : "Add Transaction"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
