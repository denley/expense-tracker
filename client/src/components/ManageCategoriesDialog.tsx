/*
  Manage the category tree: rename (rename-to-existing = merge), move a
  category to another group, delete a category, rename groups.
  All operations rewrite every affected transaction and keep rules in sync.
*/
import { useMemo, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GroupPicker } from "@/components/pickers";
import { formatCurrency } from "@/lib/utils";
import { PencilLine, Check, X, Merge, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ManageCategoriesDialog({ open, onOpenChange }: Props) {
  const {
    allTransactions, categoryDefs, projects,
    renameCategory, setCategoryGroup, deleteCategory, renameGroup,
  } = useExpenses();

  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [mergeTarget, setMergeTarget] = useState<{ from: string; to: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupValue, setGroupValue] = useState("");

  // Stats across ALL data (management is global, not year-scoped).
  // Lists every category in the tree, including ones with no transactions yet.
  const catStats = useMemo(() => {
    const counts = new Map<string, { total: number; count: number }>();
    for (const t of allTransactions) {
      if (!counts.has(t.category)) counts.set(t.category, { total: 0, count: 0 });
      const s = counts.get(t.category)!;
      s.total += t.amount;
      s.count++;
    }
    return categoryDefs
      .map((d) => ({
        name: d.name,
        group: d.group,
        total: counts.get(d.name)?.total ?? 0,
        count: counts.get(d.name)?.count ?? 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [allTransactions, categoryDefs]);

  const groupStats = useMemo(() => {
    const map = new Map<string, { total: number; count: number; cats: Set<string> }>();
    for (const d of categoryDefs) {
      if (!map.has(d.group)) map.set(d.group, { total: 0, count: 0, cats: new Set() });
      map.get(d.group)!.cats.add(d.name);
    }
    for (const t of allTransactions) {
      if (!map.has(t.group)) map.set(t.group, { total: 0, count: 0, cats: new Set() });
      const s = map.get(t.group)!;
      s.total += t.amount;
      s.count++;
    }
    return Array.from(map.entries())
      .map(([name, s]) => {
        const project = projects.find((p) => p.name === name);
        return {
          name,
          total: s.total,
          count: s.count,
          cats: s.cats.size,
          isProject: !!project,
          isArchived: project?.status === "archived",
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [allTransactions, categoryDefs, projects]);

  const startRename = (cat: string) => {
    setEditingCat(cat);
    setEditValue(cat);
  };

  const commitRename = () => {
    if (!editingCat) return;
    const to = editValue.trim();
    if (!to || to === editingCat) {
      setEditingCat(null);
      return;
    }
    const exists = catStats.some((c) => c.name === to);
    if (exists) {
      setMergeTarget({ from: editingCat, to });
    } else {
      const n = renameCategory(editingCat, to);
      toast.success(`Renamed "${editingCat}" to "${to}" (${n} transactions)`);
    }
    setEditingCat(null);
  };

  const commitGroupRename = () => {
    if (!editingGroup) return;
    const to = groupValue.trim();
    if (to && to !== editingGroup) {
      const n = renameGroup(editingGroup, to);
      toast.success(`Renamed group "${editingGroup}" to "${to}" (${n} transactions)`);
    }
    setEditingGroup(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[680px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Manage Categories & Groups</DialogTitle>
            <DialogDescription>
              Every category belongs to exactly one group. Rename to fix errors, merge by
              renaming into an existing category, or move categories between groups.
              Changes apply to all years.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="categories" className="flex-1 min-h-0 flex flex-col">
            <TabsList>
              <TabsTrigger value="categories">Categories ({catStats.length})</TabsTrigger>
              <TabsTrigger value="groups">Groups ({groupStats.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="categories" className="flex-1 min-h-0 overflow-y-auto mt-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 pr-2 font-medium">Category</th>
                    <th className="text-left py-2 pr-2 font-medium w-[170px]">Group</th>
                    <th className="text-right py-2 pr-2 font-medium">Total</th>
                    <th className="text-right py-2 font-medium">Txns</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {catStats.map((c) => (
                    <tr key={c.name} className="border-b border-border/50 hover:bg-accent/40">
                      <td className="py-1.5 pr-2">
                        {editingCat === c.name ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename();
                                if (e.key === "Escape") setEditingCat(null);
                              }}
                              className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                              list="category-names"
                            />
                            <datalist id="category-names">
                              {catStats.filter((x) => x.name !== c.name).map((x) => (
                                <option key={x.name} value={x.name} />
                              ))}
                            </datalist>
                            <button onClick={commitRename} className="p-1 text-eucalyptus hover:bg-accent rounded">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setEditingCat(null)} className="p-1 text-muted-foreground hover:bg-accent rounded">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startRename(c.name)}
                            className="group flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                          >
                            {c.name}
                            <PencilLine className="w-3 h-3 opacity-0 group-hover:opacity-60" />
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <GroupPicker
                          value={c.group}
                          onChange={(g) => {
                            const n = setCategoryGroup(c.name, g);
                            toast.success(`Moved "${c.name}" to ${g} (${n} transactions)`);
                          }}
                          className="!py-1 !px-2 !text-xs !rounded-md"
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right text-xs tabular-nums">{formatCurrency(c.total)}</td>
                      <td className="py-1.5 text-right text-xs tabular-nums text-muted-foreground">{c.count}</td>
                      <td className="py-1.5 pl-1">
                        <button
                          onClick={() => setDeleteTarget(c.name)}
                          className="p-1 text-muted-foreground hover:text-destructive rounded"
                          title="Delete category"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted-foreground py-2.5">
                Tip: renaming a category to an existing name merges the two.
              </p>
            </TabsContent>

            <TabsContent value="groups" className="flex-1 min-h-0 overflow-y-auto mt-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 pr-2 font-medium">Group</th>
                    <th className="text-right py-2 pr-2 font-medium">Categories</th>
                    <th className="text-right py-2 pr-2 font-medium">Total</th>
                    <th className="text-right py-2 font-medium">Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {groupStats.map((g) => (
                    <tr key={g.name} className="border-b border-border/50 hover:bg-accent/40">
                      <td className="py-1.5 pr-2">
                        {editingGroup === g.name ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={groupValue}
                              onChange={(e) => setGroupValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitGroupRename();
                                if (e.key === "Escape") setEditingGroup(null);
                              }}
                              className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <button onClick={commitGroupRename} className="p-1 text-eucalyptus hover:bg-accent rounded">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setEditingGroup(null)} className="p-1 text-muted-foreground hover:bg-accent rounded">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingGroup(g.name); setGroupValue(g.name); }}
                            className="group flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                          >
                            {g.name}
                            {g.isProject && (
                              <span className="text-[9px] uppercase text-primary/70 border border-primary/30 rounded px-1">
                                {g.isArchived ? "archived project" : "project"}
                              </span>
                            )}
                            <PencilLine className="w-3 h-3 opacity-0 group-hover:opacity-60" />
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-xs tabular-nums text-muted-foreground">{g.cats}</td>
                      <td className="py-1.5 pr-2 text-right text-xs tabular-nums">{formatCurrency(g.total)}</td>
                      <td className="py-1.5 text-right text-xs tabular-nums text-muted-foreground">{g.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted-foreground py-2.5">
                Tip: renaming a group to an existing name merges the two. Renaming a project's
                group renames the project. To move a single category, use the Categories tab.
              </p>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Merge confirmation */}
      <AlertDialog open={!!mergeTarget} onOpenChange={(o) => !o && setMergeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Merge className="w-4 h-4" />
              Merge "{mergeTarget?.from}" into "{mergeTarget?.to}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All {catStats.find((c) => c.name === mergeTarget?.from)?.count ?? 0} transactions
              in "{mergeTarget?.from}" will be re-categorised as "{mergeTarget?.to}". This can't
              be split apart automatically afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mergeTarget) {
                  const n = renameCategory(mergeTarget.from, mergeTarget.to);
                  toast.success(`Merged ${n} transactions into "${mergeTarget.to}"`);
                  setMergeTarget(null);
                }
              }}
            >
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete category confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category "{deleteTarget}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {catStats.find((c) => c.name === deleteTarget)?.count ?? 0} transactions will be
              marked Uncategorized, and rules assigning this category will be removed. The
              transactions themselves are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  const n = deleteCategory(deleteTarget);
                  toast.success(`Deleted "${deleteTarget}" — ${n} transactions uncategorised`);
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
