/*
  DESIGN: Scandinavian Analytical — Projects
  One-off cost centres (a trip, a renovation, a baby). A project IS a group
  in the category tree, with metadata attached: budget, dates, color, status.
  Its spend shows up in the group pie alongside ongoing groups, and breaks
  down into its own categories.
*/
import { useState, useMemo, useEffect } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Project } from "@/lib/types";
import { PROJECT_COLORS, CHART_HEX_COLORS } from "@/lib/types";
import StatCard from "@/components/StatCard";
import ChartCard from "@/components/ChartCard";
import CustomTooltip from "@/components/CustomTooltip";
import LoadingState from "@/components/LoadingState";
import { inputCls } from "@/components/pickers";
import { formatCurrency, formatCurrencyExact, formatDate, formatPercent } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FolderKanban, Plus, PencilLine, Archive, ArchiveRestore, Trash2,
  Wallet, Hash, TrendingUp, CalendarRange, ArrowRight, Check, X, Merge,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area,
} from "recharts";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Projects() {
  const {
    loading, allTransactions, projects, categoryDefs, allGroups, categoryGroups,
    addProject, updateProject, deleteProject, addCategory, renameCategory, deleteCategory,
  } = useExpenses();
  const [, navigate] = useLocation();
  const [location] = useLocation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [starterCats, setStarterCats] = useState("");

  // Inline category management on the project detail card
  const [newCat, setNewCat] = useState("");
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeCats, setMergeCats] = useState<{ from: string; to: string } | null>(null);
  const [deletingCat, setDeletingCat] = useState<string | null>(null);

  const txnCountFor = (category: string) =>
    allTransactions.filter((t) => t.category === category).length;

  const commitCatRename = () => {
    if (!renamingCat) return;
    const to = renameValue.trim();
    if (!to || to === renamingCat) {
      setRenamingCat(null);
      return;
    }
    if (categoryGroups.has(to)) {
      // Renaming into an existing category merges the two — confirm first
      setMergeCats({ from: renamingCat, to });
    } else {
      const n = renameCategory(renamingCat, to);
      toast.success(`Renamed "${renamingCat}" to "${to}" (${n} transactions)`);
    }
    setRenamingCat(null);
  };

  const addCategoryToProject = (project: Project) => {
    const cat = newCat.trim();
    if (!cat) return;
    const existingGroup = categoryGroups.get(cat);
    if (existingGroup !== undefined) {
      toast.error(
        existingGroup === project.name
          ? `"${cat}" is already in this project`
          : `"${cat}" already exists in ${existingGroup} — pick a distinct name (e.g. "${project.name} – ${cat}")`
      );
      return;
    }
    addCategory(cat, project.name);
    setNewCat("");
    toast.success(`Added "${cat}" to ${project.name}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("project");
    if (p) setSelectedId(p);
  }, [location]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor(PROJECT_COLORS[projects.length % PROJECT_COLORS.length]);
    setBudget(""); setNotes("");
    setStarterCats("Food, Transport, Accommodation");
    setDialogOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setName(p.name);
    setColor(p.color);
    setBudget(p.budget ? String(p.budget) : "");
    setNotes(p.notes ?? "");
    setStarterCats("");
    setDialogOpen(true);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the project a name");
      return;
    }
    const clash = projects.find((p) => p.name === trimmed && p.id !== editing?.id);
    if (clash) {
      toast.error(`A project named "${trimmed}" already exists`);
      return;
    }
    // Project names must be unique among ALL groups, ongoing ones included
    if (trimmed !== editing?.name && allGroups.includes(trimmed)) {
      toast.error(`"${trimmed}" already exists as a group — pick a distinct name`);
      return;
    }
    const fields = {
      name: trimmed,
      color,
      budget: budget ? parseFloat(budget) : undefined,
      notes: notes || undefined,
    };
    if (editing) {
      updateProject(editing.id, fields);
      toast.success("Project updated");
    } else {
      const starters = starterCats.split(",").map((s) => s.trim()).filter(Boolean);
      const p = addProject({ ...fields, status: "active" }, starters);
      setSelectedId(p.id);
      toast.success(`Project created — categorise transactions into its categories to track it`);
    }
    setDialogOpen(false);
  };

  // Per-project stats (a project's transactions = its group's transactions)
  const projectStats = useMemo(() => {
    const map = new Map<string, { total: number; count: number; first?: Date; last?: Date }>();
    const byName = new Map(projects.map((p) => [p.name, p.id]));
    for (const p of projects) map.set(p.id, { total: 0, count: 0 });
    for (const t of allTransactions) {
      const pid = byName.get(t.group);
      if (!pid) continue;
      const s = map.get(pid)!;
      s.total += t.amount;
      s.count += 1;
      if (!s.first || t.date < s.first) s.first = t.date;
      if (!s.last || t.date > s.last) s.last = t.date;
    }
    return map;
  }, [projects, allTransactions]);

  const visibleProjects = useMemo(
    () =>
      projects
        .filter((p) => showArchived || p.status === "active")
        .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === "active" ? -1 : 1)),
    [projects, showArchived]
  );

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const selectedTxns = useMemo(
    () =>
      selected
        ? allTransactions
            .filter((t) => t.group === selected.name)
            .sort((a, b) => b.date.getTime() - a.date.getTime())
        : [],
    [selected, allTransactions]
  );

  const selectedCategoryDefs = useMemo(
    () => (selected ? categoryDefs.filter((d) => d.group === selected.name) : []),
    [selected, categoryDefs]
  );

  const selectedMonthly = useMemo(() => {
    if (!selected) return [];
    const map = new Map<string, number>();
    for (const t of selectedTxns) {
      const key = t.dateStr.slice(0, 7);
      map.set(key, (map.get(key) || 0) + t.amount);
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cumulative = 0;
    return entries.map(([month, total]) => {
      cumulative += total;
      const [y, m] = month.split("-");
      return {
        name: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} ${y.slice(2)}`,
        total: Math.round(total),
        cumulative: Math.round(cumulative),
      };
    });
  }, [selected, selectedTxns]);

  const selectedCategories = useMemo(() => {
    if (!selected) return [];
    const map = new Map<string, number>();
    for (const t of selectedTxns) map.set(t.category, (map.get(t.category) || 0) + t.amount);
    return Array.from(map.entries())
      .map(([cat, total]) => ({ name: cat, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);
  }, [selected, selectedTxns]);

  if (loading) return <LoadingState />;

  const selectedStats = selected ? projectStats.get(selected.id) : null;
  const budgetPct = selected?.budget && selectedStats
    ? (selectedStats.total / selected.budget) * 100
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Projects</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            One-off cost centres — a trip, a renovation, a baby. Each is a group with its own
            categories and budget, sitting alongside your ongoing groups in every chart.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {projects.some((p) => p.status === "archived") && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                showArchived ? "bg-accent border-border" : "border-border hover:bg-accent"
              )}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>
      </motion.div>

      {/* Empty state */}
      {projects.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-2xl p-12 text-center"
        >
          <FolderKanban className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No projects yet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Create a project for anything with a distinct cost you want to track — "Japan Trip",
            "Kitchen Reno", "New Baby". It becomes its own slice of the spending pie, with its
            own categories inside (Food, Transport, Materials…).
          </p>
          <button
            onClick={openCreate}
            className="mt-4 px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            Create your first project
          </button>
        </motion.div>
      )}

      {/* Project cards */}
      {visibleProjects.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {visibleProjects.map((p) => {
            const stats = projectStats.get(p.id)!;
            const pct = p.budget ? Math.min((stats.total / p.budget) * 100, 100) : null;
            const over = p.budget ? stats.total > p.budget : false;
            const isSelected = selectedId === p.id;
            const catCount = categoryDefs.filter((d) => d.group === p.name).length;
            return (
              <div
                key={p.id}
                onClick={() => { setSelectedId(isSelected ? null : p.id); setNewCat(""); setRenamingCat(null); }}
                className={cn(
                  "bg-card rounded-xl border p-5 cursor-pointer transition-all",
                  isSelected ? "border-primary/50 shadow-md" : "border-border hover:border-primary/30 hover:shadow-sm",
                  p.status === "archived" && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <h3 className="text-sm font-semibold text-foreground truncate">{p.name}</h3>
                    {p.status === "archived" && (
                      <span className="text-[9px] uppercase text-muted-foreground border border-border rounded px-1 py-0.5">archived</span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                      title="Edit"
                    >
                      <PencilLine className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateProject(p.id, { status: p.status === "active" ? "archived" : "active" });
                        toast.success(p.status === "active" ? "Project archived" : "Project restored");
                      }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                      title={p.status === "active" ? "Archive" : "Restore"}
                    >
                      {p.status === "active" ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="text-2xl font-semibold tabular-nums text-foreground">
                  {formatCurrency(stats.total)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stats.count} transaction{stats.count === 1 ? "" : "s"} · {catCount} categor{catCount === 1 ? "y" : "ies"}
                  {stats.first && stats.last && (
                    <> · {formatDate(stats.first)} – {formatDate(stats.last)}</>
                  )}
                </p>

                {p.budget && (
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>{formatPercent((stats.total / p.budget) * 100)} of {formatCurrency(p.budget)}</span>
                      <span className={over ? "text-destructive font-semibold" : ""}>
                        {over
                          ? `${formatCurrency(stats.total - p.budget)} over`
                          : `${formatCurrency(p.budget - stats.total)} left`}
                      </span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: over ? "#c0392b" : p.color,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 text-right">
                  <span className="text-[10px] text-primary/60 font-medium">
                    {isSelected ? "Hide details" : "Details →"}
                  </span>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Selected project detail */}
      {selected && selectedStats && (
        <motion.div
          key={selected.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selected.color }} />
            <h3 className="text-lg font-bold text-foreground">{selected.name}</h3>
            {selected.notes && <span className="text-xs text-muted-foreground">— {selected.notes}</span>}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Spent"
              value={formatCurrency(selectedStats.total)}
              icon={<Wallet className="w-4 h-4" />}
              subtitle={selected.budget ? `Budget: ${formatCurrency(selected.budget)}` : undefined}
            />
            <StatCard
              label="Transactions"
              value={String(selectedStats.count)}
              icon={<Hash className="w-4 h-4" />}
              subtitle={
                selectedStats.count > 0
                  ? `Avg ${formatCurrencyExact(selectedStats.total / selectedStats.count)}`
                  : undefined
              }
            />
            <StatCard
              label={budgetPct !== null ? "Budget Used" : "Categories"}
              value={budgetPct !== null ? formatPercent(budgetPct) : String(selectedCategoryDefs.length)}
              icon={<TrendingUp className="w-4 h-4" />}
              subtitle={
                budgetPct !== null && selected.budget
                  ? budgetPct > 100
                    ? `${formatCurrency(selectedStats.total - selected.budget)} over budget`
                    : `${formatCurrency(selected.budget - selectedStats.total)} remaining`
                  : undefined
              }
            />
            <StatCard
              label="Active Period"
              value={
                selectedStats.first && selectedStats.last
                  ? `${Math.max(1, Math.round((selectedStats.last.getTime() - selectedStats.first.getTime()) / 86400000))}d`
                  : "—"
              }
              icon={<CalendarRange className="w-4 h-4" />}
              subtitle={
                selectedStats.first && selectedStats.last
                  ? `${formatDate(selectedStats.first)} – ${formatDate(selectedStats.last)}`
                  : "No transactions yet"
              }
            />
          </div>

          {/* Project categories */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Categories in this project
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedCategoryDefs.map((d) =>
                renamingCat === d.name ? (
                  <span key={d.name} className="inline-flex items-center gap-1">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCatRename();
                        if (e.key === "Escape") setRenamingCat(null);
                      }}
                      className="w-[150px] px-2.5 py-1 text-[11px] bg-background border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button onClick={commitCatRename} className="p-1 rounded-full text-eucalyptus hover:bg-accent" title="Save">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setRenamingCat(null)} className="p-1 rounded-full text-muted-foreground hover:bg-accent" title="Cancel">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ) : (
                  <span
                    key={d.name}
                    className="inline-flex items-center rounded-full border transition-colors"
                    style={{ borderColor: `${selected.color}60` }}
                  >
                    <button
                      onClick={() => navigate(`/transactions?category=${encodeURIComponent(d.name)}`)}
                      className="pl-2.5 pr-1 py-1 text-[11px] font-medium hover:underline"
                      style={{ color: selected.color }}
                      title="View these transactions"
                    >
                      {d.name}
                    </button>
                    <button
                      onClick={() => { setRenamingCat(d.name); setRenameValue(d.name); }}
                      className="p-1 text-muted-foreground/60 hover:text-foreground"
                      title="Rename category"
                    >
                      <PencilLine className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setDeletingCat(d.name)}
                      className="p-1 pr-1.5 text-muted-foreground/60 hover:text-destructive"
                      title="Delete category"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                )
              )}
              {selectedCategoryDefs.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  None yet — add the first one:
                </p>
              )}
              {selected.status === "active" && (
                <span className="inline-flex items-center gap-1">
                  <input
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCategoryToProject(selected);
                    }}
                    placeholder="Add category…"
                    className="w-[130px] px-2.5 py-1 text-[11px] bg-background border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    onClick={() => addCategoryToProject(selected)}
                    disabled={!newCat.trim()}
                    className="p-1 rounded-full text-muted-foreground hover:text-primary hover:bg-accent disabled:opacity-40 transition-colors"
                    title="Add category to this project"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
          </div>

          {selectedTxns.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard title="Spend Over Time" subtitle="Cumulative">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedMonthly}>
                      <defs>
                        <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={selected.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={selected.color} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke={selected.color} strokeWidth={2} fill="url(#projGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="What the Money Went On" subtitle="Categories within this project">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedCategories.slice(0, 10)} layout="vertical" barCategoryGap="15%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} width={110} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]}>
                        {selectedCategories.slice(0, 10).map((_, i) => (
                          <Cell key={i} fill={CHART_HEX_COLORS[i % CHART_HEX_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No transactions in "{selected.name}" yet.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Go to Transactions, select the relevant rows, and bulk-categorise them into one of
                this project's categories — or set a default category during CSV import.
              </p>
            </div>
          )}

          {/* Recent transactions */}
          {selectedTxns.length > 0 && (
            <ChartCard
              title="Project Transactions"
              subtitle={`${selectedTxns.length} transactions`}
              action={
                <button
                  onClick={() => navigate(`/transactions?group=${encodeURIComponent(selected.name)}`)}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Edit in Transactions <ArrowRight className="w-3 h-3" />
                </button>
              }
            >
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <tbody>
                    {selectedTxns.slice(0, 15).map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                        <td className="px-5 py-2 text-xs text-muted-foreground whitespace-nowrap tabular-nums">{formatDate(t.date)}</td>
                        <td className="px-5 py-2 text-xs max-w-[300px] truncate">{t.notes || t.description}</td>
                        <td className="px-5 py-2 text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">{t.category}</td>
                        <td className={cn("px-5 py-2 text-xs font-medium text-right whitespace-nowrap tabular-nums", t.amount < 0 && "text-eucalyptus")}>
                          {formatCurrencyExact(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedTxns.length > 15 && (
                  <p className="text-xs text-muted-foreground text-center py-2.5">
                    Showing 15 of {selectedTxns.length} — open in Transactions to see all
                  </p>
                )}
              </div>
            </ChartCard>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => setDeleting(selected)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete project
            </button>
          </div>
        </motion.div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Project" : "New Project"}</DialogTitle>
            <DialogDescription>
              A project is its own group in the category tree — its categories and spend
              appear in every chart alongside your ongoing groups.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Japan Trip 2026"'
                className={inputCls}
              />
              {editing && name.trim() !== editing.name && (
                <p className="text-[10px] text-terracotta mt-1">
                  Renaming moves every transaction and category to the new group name.
                </p>
              )}
            </div>
            {!editing && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Starter categories (comma-separated, optional)
                </label>
                <input
                  value={starterCats}
                  onChange={(e) => setStarterCats(e.target.value)}
                  placeholder="Food, Transport, Accommodation"
                  className={inputCls}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Budget (optional)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. 8000"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Color</label>
                <div className="flex gap-1.5 pt-1.5">
                  {PROJECT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform",
                        color === c && "ring-2 ring-offset-2 ring-offset-card scale-110"
                      )}
                      style={{ backgroundColor: c, ["--tw-ring-color" as any]: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" className={inputCls} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              The active period comes from the project's transactions. When it's over, archive it —
              its categories retire from pickers and rules, while all history stays.
            </p>
          </div>
          <DialogFooter>
            <button
              onClick={() => setDialogOpen(false)}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
            >
              {editing ? "Save Changes" : "Create Project"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category merge confirmation (rename into an existing name) */}
      <AlertDialog open={!!mergeCats} onOpenChange={(o) => !o && setMergeCats(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Merge className="w-4 h-4" />
              Merge "{mergeCats?.from}" into "{mergeCats?.to}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              "{mergeCats?.to}" already exists
              {mergeCats && ` (in ${categoryGroups.get(mergeCats.to) ?? "another group"})`}. All{" "}
              {mergeCats ? txnCountFor(mergeCats.from) : 0} transactions in "{mergeCats?.from}"
              will move there, and "{mergeCats?.from}" disappears. This can't be split apart
              automatically afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mergeCats) {
                  const n = renameCategory(mergeCats.from, mergeCats.to);
                  toast.success(`Merged ${n} transactions into "${mergeCats.to}"`);
                  setMergeCats(null);
                }
              }}
            >
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Category delete confirmation */}
      <AlertDialog open={!!deletingCat} onOpenChange={(o) => !o && setDeletingCat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category "{deletingCat}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingCat ? txnCountFor(deletingCat) : 0} transactions will be marked
              Uncategorized (leaving this project), and rules assigning this category will be
              removed. The transactions themselves are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingCat) {
                  const n = deleteCategory(deletingCat);
                  toast.success(`Deleted "${deletingCat}" — ${n} transactions uncategorised`);
                  setDeletingCat(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the budget, dates and project card. The group itself, its categories
              and all transactions stay untouched — "{deleting?.name}" just becomes an ordinary
              group. (Prefer Archive if you might want the card back.)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) {
                  deleteProject(deleting.id);
                  if (selectedId === deleting.id) setSelectedId(null);
                  toast.success("Project removed — group and data kept");
                  setDeleting(null);
                }
              }}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
