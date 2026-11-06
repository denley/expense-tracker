/*
  The Categories page's sidebar (wide screens only): the category tree in its
  usual order, with each node's total for the page's period, the path to the
  current category expanded (animated open/closed). Order doesn't change with
  the totals, so things stay put while stepping through months.
*/
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useExpenses } from "@/contexts/ExpenseContext";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import { formatCurrency, cn } from "@/lib/utils";

interface Props {
  /** Current node id ("" = all) */
  selection: string;
  /** Rolled-up totals per node id for the page's period */
  totals: Map<string, { total: number; count: number }>;
  grandTotal: number;
  /** e.g. "October 2026" or "All time" */
  periodLabel: string;
  onSelect: (id: string) => void;
  className?: string;
}

export default function CategorySidebar({ selection, totals, grandTotal, periodLabel, onSelect, className }: Props) {
  const { tree, colorOf } = useExpenses();

  // The selection and its ancestors are expanded
  const open = new Set<string>();
  for (let cur = selection ? tree.byId.get(selection) : undefined; cur; cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined) {
    open.add(cur.id);
  }

  // Archived categories and an empty Uncategorised only show when they have spend
  const visibleChildren = (parentId: string | null) =>
    (tree.children.get(parentId) ?? []).filter((node) => {
      const count = totals.get(node.id)?.count ?? 0;
      return count > 0 || !(tree.isArchived(node.id) || node.id === UNCATEGORIZED_ID);
    });

  const item = (active: boolean, muted: boolean) =>
    cn(
      "w-full flex items-center gap-2 py-1.5 pr-2.5 rounded-lg text-left text-xs transition-colors",
      active ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-accent",
      muted && !active && "opacity-50"
    );

  const branch = (parentId: string | null, depth: number) =>
    visibleChildren(parentId).map((node) => {
      const t = totals.get(node.id);
      const empty = !t || t.count === 0;
      const kids = visibleChildren(node.id).length > 0;
      const isOpen = open.has(node.id) && kids;
      return (
        <div key={node.id}>
          <button
            onClick={() => onSelect(node.id)}
            className={item(selection === node.id, empty)}
            style={{ paddingLeft: 4 + depth * 14 }}
            title={tree.pathOf(node.id)}
          >
            <ChevronRight
              className={cn(
                "w-3 h-3 shrink-0 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-90",
                !kids && "invisible"
              )}
            />
            <span className="w-2 h-2 rounded-full shrink-0 -ml-1" style={{ backgroundColor: colorOf(node.id) }} />
            <span className="flex-1 truncate">
              {node.name}
              {node.oneOff ? " ◈" : ""}
            </span>
            <span className={cn("tabular-nums text-[11px]", selection === node.id ? "text-primary" : "text-muted-foreground")}>
              {empty ? "—" : formatCurrency(t.total)}
            </span>
          </button>
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.div
                key="children"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                {branch(node.id, depth + 1)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });

  return (
    <nav className={cn("bg-card rounded-xl border border-border p-2 max-h-[calc(100vh-3rem)] overflow-y-auto", className)}>
      <p className="px-2.5 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {periodLabel}
      </p>
      <button onClick={() => onSelect("")} className={cn(item(selection === "", false), "pl-2.5")}>
        <span className="flex-1 truncate">All categories</span>
        <span className="tabular-nums text-[11px] text-muted-foreground">{formatCurrency(grandTotal)}</span>
      </button>
      {branch(null, 0)}
    </nav>
  );
}
