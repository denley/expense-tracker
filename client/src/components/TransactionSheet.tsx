/*
  Phone action sheet for one transaction (opened by tapping a row): details,
  the category picker up front — the usual reason to tap — and full-size
  buttons for what the desktop row offers as small icons.
*/
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Rule, Transaction } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import { CategoryPicker } from "@/components/pickers";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCurrencyExact, formatDate, cn } from "@/lib/utils";
import { CheckSquare, PencilLine, Split, Wand2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The enabled rule matching this description, if any (Rule then edits it) */
  matchingRule: Rule | undefined;
  onRule: () => void;
  onSplit: () => void;
  onEdit: () => void;
  onSelect: () => void;
}

export default function TransactionSheet({
  transaction: t, open, onOpenChange, matchingRule, onRule, onSplit, onEdit, onSelect,
}: Props) {
  const { updateTransactions, nameOf } = useExpenses();
  if (!t) return null;

  // Close first so a follow-up dialog doesn't stack on the sheet
  const then = (action: () => void) => () => { onOpenChange(false); action(); };

  const actionCls =
    "flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border border-border text-xs font-medium text-foreground active:bg-accent";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl max-h-[85vh] overflow-y-auto gap-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="pr-10">
          <SheetTitle className="text-base leading-snug break-words">{t.description}</SheetTitle>
          <SheetDescription className="text-xs">
            {[formatDate(t.date), t.account].filter(Boolean).join(" · ")}
          </SheetDescription>
          <p
            className={cn(
              "text-2xl font-bold tabular-nums",
              t.amount < 0 ? "text-eucalyptus" : "text-foreground"
            )}
          >
            {formatCurrencyExact(t.amount)}
          </p>
          {t.notes && <p className="text-sm text-muted-foreground break-words">{t.notes}</p>}
        </SheetHeader>

        <div className="px-4 pb-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Category</span>
            <CategoryPicker
              value={t.categoryId}
              onChange={(id) => {
                if (id === t.categoryId) return;
                updateTransactions([t.id], { categoryId: id });
                toast.success(`Categorised as ${nameOf(id)}`);
                onOpenChange(false);
              }}
              className={cn(
                "text-base py-2.5",
                t.categoryId === UNCATEGORIZED_ID && "text-terracotta font-medium"
              )}
            />
          </label>

          <div className="grid grid-cols-4 gap-2">
            <button onClick={then(onRule)} className={actionCls}>
              <Wand2 className="w-5 h-5 text-primary" />
              {matchingRule ? "Edit rule" : "New rule"}
            </button>
            <button onClick={then(onSplit)} className={actionCls}>
              <Split className="w-5 h-5 text-muted-foreground" />
              Split
            </button>
            <button onClick={then(onEdit)} className={actionCls}>
              <PencilLine className="w-5 h-5 text-muted-foreground" />
              Edit
            </button>
            <button onClick={then(onSelect)} className={actionCls}>
              <CheckSquare className="w-5 h-5 text-muted-foreground" />
              Select
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            {matchingRule && <>Matched by rule "{matchingRule.pattern}" → {nameOf(matchingRule.categoryId)} · </>}
            Long-press a row to select several
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
