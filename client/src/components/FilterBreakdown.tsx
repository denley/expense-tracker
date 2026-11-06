/*
  The summary line above the Transactions list, always present so nothing
  moves while you type a search: how many rows, their total, and one row of
  chips for where the money went. With a category filter the chips split it by
  that category's sub-categories (a chip narrows the filter to it); otherwise
  by top-level category. Chips that don't fit scroll sideways.
*/
import { useMemo } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Transaction } from "@/lib/types";
import { formatCurrency, cn } from "@/lib/utils";

interface Props {
  rows: Transaction[];
  total: number;
  /** The category filter ("" = none) */
  category: string;
  onPick: (categoryId: string) => void;
}

interface Part {
  id: string;
  name: string;
  total: number;
  /** false for the "filed directly on the parent" part */
  pickable: boolean;
}

export default function FilterBreakdown({ rows, total, category, onPick }: Props) {
  const { tree, colorOf } = useExpenses();

  const parts = useMemo<Part[]>(() => {
    // Each row's bucket: the child of `category` it sits under (the category
    // itself for rows filed directly on it), or its top-level category
    const cache = new Map<string, string>();
    const bucketOf = (id: string): string => {
      const hit = cache.get(id);
      if (hit !== undefined) return hit;
      const chain: string[] = []; // id, parent, …, root
      for (let cur: string | null = id; cur !== null && !chain.includes(cur); ) {
        chain.push(cur);
        const parent: string | null = tree.byId.get(cur)?.parentId ?? null;
        cur = parent && tree.byId.has(parent) ? parent : null;
      }
      const at = category ? chain.indexOf(category) : -1;
      const bucket = !category ? chain[chain.length - 1] : at > 0 ? chain[at - 1] : at === 0 ? category : id;
      cache.set(id, bucket);
      return bucket;
    };
    const totals = new Map<string, number>();
    for (const t of rows) {
      const b = bucketOf(t.categoryId);
      totals.set(b, (totals.get(b) ?? 0) + t.amount);
    }
    return Array.from(totals.entries())
      .map(([id, sum]) => ({
        id,
        name: id === category ? `${tree.byId.get(id)?.name ?? id} (direct)` : tree.byId.get(id)?.name ?? id,
        total: sum,
        pickable: id !== category,
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows, category, tree]);

  return (
    <div className="flex items-center gap-3 h-7 min-w-0">
      <p className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
        <span className="font-medium text-foreground tabular-nums">{rows.length.toLocaleString("en-AU")}</span>{" "}
        {rows.length === 1 ? "item" : "items"} ·{" "}
        <span className="font-medium text-foreground tabular-nums">{formatCurrency(total)}</span>
      </p>
      {parts.length > 1 && (
        <div
          className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] pr-6"
        >
          {parts.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!p.pickable}
              onClick={() => onPick(p.id)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-border bg-card text-[11px] whitespace-nowrap",
                p.pickable ? "hover:bg-accent transition-colors" : "cursor-default text-muted-foreground"
              )}
              title={p.pickable ? `Show only ${p.name}` : "Filed directly on this category, not a sub-category"}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorOf(p.id) }} />
              <span className="font-medium">{p.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatCurrency(p.total)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
