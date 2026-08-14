/*
  Manage the category tree: one indented tree table over every node.
  Per node: inline rename, move (parent picker), one-off flag, color,
  archive/restore, delete (dissolve: children re-parent, transactions move to
  the parent, or Uncategorized for a top-level node).
  Since transactions reference nodes by id, all of this touches only
  categories.csv — history files are never rewritten by tree edits.
*/
import { useMemo, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { CategoryNode } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ParentPicker, inputCls } from "@/components/pickers";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  PencilLine, Check, X, Trash2, Archive, ArchiveRestore, Plus, CornerDownRight,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ManageCategoriesDialog({ open, onOpenChange }: Props) {
  const {
    allTransactions, tree,
    addNode, renameNode, moveNode, setNodeMeta, setNodeArchived, deleteNode,
  } = useExpenses();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryNode | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [newOneOff, setNewOneOff] = useState(false);

  // Stats across ALL data (management is global, not year-scoped), rolled up.
  const stats = useMemo(() => {
    const direct = new Map<string, { total: number; count: number }>();
    for (const t of allTransactions) {
      if (!direct.has(t.categoryId)) direct.set(t.categoryId, { total: 0, count: 0 });
      const s = direct.get(t.categoryId)!;
      s.total += t.amount;
      s.count++;
    }
    const rolled = new Map<string, { total: number; count: number; direct: number; directCount: number }>();
    for (const n of tree.nodes) {
      let total = 0;
      let count = 0;
      for (const id of tree.subtreeIds(n.id)) {
        const s = direct.get(id);
        if (s) {
          total += s.total;
          count += s.count;
        }
      }
      const d = direct.get(n.id);
      rolled.set(n.id, { total, count, direct: d?.total ?? 0, directCount: d?.count ?? 0 });
    }
    return rolled;
  }, [allTransactions, tree]);

  const commitRename = () => {
    if (!editingId) return;
    const node = tree.byId.get(editingId);
    const to = editValue.trim();
    if (node && to && to !== node.name) {
      if (renameNode(editingId, to)) {
        toast.success(`Renamed "${node.name}" to "${to}"`);
      }
    }
    setEditingId(null);
  };

  const commitAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const node = addNode(name, newParent || null, newOneOff ? { oneOff: true } : undefined);
    if (!node) return;
    toast.success(`Added "${name}"`);
    setNewName("");
    setNewOneOff(false);
    setAdding(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[720px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>
              The tree can nest to any depth, and transactions can be filed at any level.
              Mark a one-off cost centre (a trip, a renovation…) with ◈ — its subtree
              clusters at the end of pickers and can be hidden from trend charts.
              Tree changes never rewrite your transaction history. Totals include subcategories.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            {adding ? (
              <div className="flex flex-1 items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAdd();
                    if (e.key === "Escape") setAdding(false);
                  }}
                  placeholder="New category…"
                  className={cn(inputCls, "flex-1 min-w-0 !py-1.5 !text-xs")}
                />
                <span className="text-xs text-muted-foreground shrink-0">under</span>
                <ParentPicker
                  value={newParent}
                  onChange={setNewParent}
                  className="w-auto shrink-0 max-w-[35%] !py-1.5 !text-xs"
                />
                <label className="flex items-center gap-1 text-xs shrink-0 cursor-pointer" title="One-off cost centre (project)">
                  <input
                    type="checkbox"
                    checked={newOneOff}
                    onChange={(e) => setNewOneOff(e.target.checked)}
                    className="accent-[var(--color-eucalyptus)]"
                  />
                  one-off
                </label>
                <button
                  onClick={commitAdd}
                  className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium shrink-0"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="w-3 h-3" /> Add category
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="text-left py-2 pr-2 font-medium">Category</th>
                  <th className="text-right py-2 pr-2 font-medium">Total</th>
                  <th className="text-right py-2 pr-2 font-medium">Txns</th>
                  <th className="text-right py-2 font-medium w-[130px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tree.nodes.map((n) => {
                  const depth = tree.depthOf(n.id);
                  const s = stats.get(n.id);
                  const archived = tree.isArchived(n.id);
                  const selfArchived = !!n.archived;
                  return (
                    <tr
                      key={n.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-accent/40",
                        archived && "opacity-50"
                      )}
                    >
                      <td className="py-1.5 pr-2">
                        <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                          {depth > 0 && (
                            <CornerDownRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                          )}
                          {(depth === 0 || n.oneOff || n.color) && (
                            <input
                              type="color"
                              value={n.color ?? "#c9a96e"}
                              onChange={(e) => setNodeMeta(n.id, { color: e.target.value })}
                              className="w-4 h-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                              title="Chart color"
                            />
                          )}
                          {editingId === n.id ? (
                            <div className="flex flex-1 items-center gap-1">
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitRename();
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <button onClick={commitRename} className="p-1 text-eucalyptus hover:bg-accent rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setEditingId(null)} className="p-1 text-muted-foreground hover:bg-accent rounded">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (n.id === UNCATEGORIZED_ID) return;
                                setEditingId(n.id);
                                setEditValue(n.name);
                              }}
                              className="group flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                            >
                              {n.name}
                              {n.oneOff && <span title="One-off (project)">◈</span>}
                              {selfArchived && (
                                <span className="text-[9px] uppercase text-muted-foreground border border-border rounded px-1">
                                  archived
                                </span>
                              )}
                              {n.id !== UNCATEGORIZED_ID && (
                                <PencilLine className="w-3 h-3 opacity-0 group-hover:opacity-60" />
                              )}
                            </button>
                          )}
                        </div>
                        {movingId === n.id && (
                          <div className="flex items-center gap-1.5 mt-1" style={{ paddingLeft: depth * 16 }}>
                            <span className="text-[10px] text-muted-foreground shrink-0">Move under:</span>
                            <ParentPicker
                              value={n.parentId ?? ""}
                              excludeSubtreeOf={n.id}
                              onChange={(parentId) => {
                                if (moveNode(n.id, parentId || null)) {
                                  toast.success(`Moved "${n.name}"`);
                                }
                                setMovingId(null);
                              }}
                              className="w-auto !py-1 !px-2 !text-xs !rounded-md"
                            />
                            <button onClick={() => setMovingId(null)} className="p-1 text-muted-foreground hover:bg-accent rounded">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-xs tabular-nums">
                        {formatCurrency(s?.total ?? 0)}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-xs tabular-nums text-muted-foreground">
                        {s?.count ?? 0}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {n.id !== UNCATEGORIZED_ID && (
                          <>
                            <button
                              onClick={() => setMovingId(movingId === n.id ? null : n.id)}
                              className="p-1 text-muted-foreground hover:text-primary rounded"
                              title="Move in the tree"
                            >
                              <CornerDownRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setNodeMeta(n.id, { oneOff: !n.oneOff })}
                              className={cn(
                                "p-1 rounded text-xs leading-none",
                                n.oneOff ? "text-primary" : "text-muted-foreground hover:text-primary"
                              )}
                              title={n.oneOff ? "Unmark one-off" : "Mark as one-off cost centre (project)"}
                            >
                              ◈
                            </button>
                            <button
                              onClick={() => {
                                setNodeArchived(n.id, !selfArchived);
                                toast.success(selfArchived ? `Restored "${n.name}"` : `Archived "${n.name}"`);
                              }}
                              className="p-1 text-muted-foreground hover:text-primary rounded"
                              title={selfArchived ? "Restore" : "Archive (retire subtree from pickers, keep history)"}
                            >
                              {selfArchived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => setDeleteTarget(n)}
                              className="p-1 text-muted-foreground hover:text-destructive rounded"
                              title="Delete (children and transactions move to the parent)"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground py-2.5">
              Tip: to split a category up, add subcategories under it and re-file transactions
              gradually — spending filed on the parent stays valid ("general").
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete node confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {stats.get(deleteTarget.id)?.directCount ?? 0} transactions filed directly on it
                  will move to{" "}
                  {deleteTarget.parentId && tree.byId.has(deleteTarget.parentId)
                    ? `"${tree.byId.get(deleteTarget.parentId)!.name}"`
                    : "Uncategorized"}
                  , and any subcategories move up a level. Nothing is lost.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  const n = deleteNode(deleteTarget.id);
                  toast.success(`Deleted "${deleteTarget.name}" — ${n} transactions re-filed`);
                  setDeleteTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
