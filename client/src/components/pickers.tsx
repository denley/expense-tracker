/*
  Reusable pickers for editing flows:
  - CategoryPicker: the whole tree as an indented native select. ANY node is
    selectable (filing at a parent level is a feature — refine later).
    Archived subtrees sink to a trailing "(archived)" section; one-off
    ("project") subtrees cluster after regular ones at each level (tree order).
    Creating a new category inline also asks where it goes in the tree.
  - ParentPicker: choose a parent node (or top level) for create/move flows.
  - CategoryTreeDropdown: a popover with a searchable, properly indented tree
    (native <option> can't render hierarchy) — used for browse/filter choosers.
  All match the app's compact form styling. Values are node ids.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { CategoryNode } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency } from "@/lib/utils";
import { ChevronsUpDown, CornerDownRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputCls =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

const NEW_SENTINEL = "__new__";
const INDENT = " "; // em space — survives inside <option> labels

function optionLabel(node: CategoryNode, depth: number): string {
  return `${INDENT.repeat(depth)}${node.name}${node.oneOff ? " ◈" : ""}`;
}

interface CategoryPickerProps {
  /** Selected node id ("" when allowEmpty) */
  value: string;
  onChange: (categoryId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** Preselected parent when creating a new category inline */
  defaultNewParentId?: string | null;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
}

export function CategoryPicker({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "— Keep unchanged —",
  defaultNewParentId = null,
  className,
  autoFocus,
  onBlur,
}: CategoryPickerProps) {
  const { tree, addNode, pathOf } = useExpenses();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>(defaultNewParentId ?? "");

  const { active, archived } = useMemo(() => {
    const active: Array<{ node: CategoryNode; depth: number }> = [];
    const archived: Array<{ node: CategoryNode; depth: number }> = [];
    // tree.nodes is already in depth-first display order; a subtree is archived
    // as soon as any ancestor is, so membership follows isArchived
    for (const node of tree.nodes) {
      const entry = { node, depth: tree.depthOf(node.id) };
      (tree.isArchived(node.id) ? archived : active).push(entry);
    }
    return { active, archived };
  }, [tree]);

  const commitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const node = addNode(name, newParent || null);
    if (!node) return; // validation toast already shown
    onChange(node.id);
    setCreating(false);
    setNewName("");
  };

  if (creating) {
    return (
      <div className={cn("flex gap-1.5", className)}>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCreate();
            if (e.key === "Escape") setCreating(false);
          }}
          placeholder="New category…"
          className={cn(inputCls, "flex-1 min-w-0")}
        />
        <ParentPicker
          value={newParent}
          onChange={setNewParent}
          className="w-auto shrink-0 max-w-[45%]"
        />
        <button
          onClick={commitCreate}
          className="px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium shrink-0"
        >
          Add
        </button>
      </div>
    );
  }

  const knownValue = value && tree.byId.has(value);
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_SENTINEL) setCreating(true);
        else onChange(e.target.value);
      }}
      className={cn(inputCls, className)}
      title={knownValue ? pathOf(value) : undefined}
      autoFocus={autoFocus}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === "Escape") onBlur?.(); }}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {value && !knownValue && <option value={value}>{value}</option>}
      {active.map(({ node, depth }) => (
        <option key={node.id} value={node.id}>
          {optionLabel(node, depth)}
        </option>
      ))}
      <option value={NEW_SENTINEL}>＋ New category…</option>
      {archived.length > 0 && (
        <optgroup label="Archived">
          {archived.map(({ node, depth }) => (
            <option key={node.id} value={node.id}>
              {optionLabel(node, depth)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

interface CategoryTreeDropdownProps {
  /** Selected node id, or "" for the all/root option */
  value: string;
  onChange: (categoryId: string) => void;
  /** Label for the "" option (omit to require picking a node) */
  allLabel?: string;
  /** Extra detail shown after the all-option label (e.g. total) */
  allDetail?: string;
  className?: string;
}

/**
 * Tree-aware chooser: a button + popover listing the whole tree with real
 * indentation, one-off markers and (scoped) rolled-up totals. Typing in the
 * search box switches to a flat full-path match list.
 */
export function CategoryTreeDropdown({
  value,
  onChange,
  allLabel,
  allDetail,
  className,
}: CategoryTreeDropdownProps) {
  const { tree, nodeStats, pathOf } = useExpenses();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // Fresh search + selection scrolled into view on every open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = setTimeout(() => selectedRef.current?.scrollIntoView({ block: "center" }), 0);
    return () => clearTimeout(t);
  }, [open]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!q) return tree.nodes;
    return tree.nodes.filter((n) => tree.pathOf(n.id).toLowerCase().includes(q));
  }, [tree, q]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const selectedLabel = value
    ? `${pathOf(value)}${tree.byId.get(value)?.oneOff ? " ◈" : ""}`
    : allLabel ?? "Choose category…";

  const rowStats = (id: string) => {
    const s = nodeStats.get(id);
    return s && s.count > 0 ? (
      <span className="ml-auto shrink-0 pl-3 text-muted-foreground tabular-nums">
        {formatCurrency(s.total)} <span className="opacity-60">({s.count})</span>
      </span>
    ) : null;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(inputCls, "flex items-center gap-2 text-left", className)}
        >
          <span className="flex-1 truncate font-medium">{selectedLabel}</span>
          {!value && allDetail && (
            <span className="shrink-0 text-muted-foreground text-xs">{allDetail}</span>
          )}
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[320px]"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rows.length > 0) pick(q ? rows[0].id : value);
            }}
            placeholder="Search categories…"
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>
        <div className="max-h-[340px] overflow-y-auto py-1">
          {allLabel !== undefined && !q && (
            <button
              onClick={() => pick("")}
              ref={value === "" ? selectedRef : undefined}
              className={cn(
                "flex w-full items-center px-3 py-1.5 text-sm font-medium hover:bg-accent",
                value === "" && "bg-primary/10 text-primary"
              )}
            >
              <span className="truncate">{allLabel}</span>
              {allDetail && (
                <span className="ml-auto shrink-0 pl-3 text-muted-foreground text-xs">{allDetail}</span>
              )}
            </button>
          )}
          {rows.map((n) => {
            const depth = q ? 0 : tree.depthOf(n.id);
            const archived = tree.isArchived(n.id);
            const selected = n.id === value;
            return (
              <button
                key={n.id}
                ref={selected ? selectedRef : undefined}
                onClick={() => pick(n.id)}
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-sm hover:bg-accent text-left",
                  selected && "bg-primary/10 text-primary",
                  archived && "opacity-50"
                )}
                style={{ paddingLeft: 12 + depth * 18 }}
              >
                {depth > 0 && (
                  <CornerDownRight className="w-3 h-3 mr-1.5 shrink-0 text-muted-foreground/50" />
                )}
                <span className="truncate">
                  {q ? tree.pathOf(n.id) : n.name}
                  {n.oneOff ? " ◈" : ""}
                  {archived ? " (archived)" : ""}
                </span>
                {rowStats(n.id)}
              </button>
            );
          })}
          {rows.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">No categories match "{query}"</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ParentPickerProps {
  /** Parent node id, or "" for top level */
  value: string;
  onChange: (parentId: string) => void;
  /** Node whose subtree to exclude (moving a node into itself is invalid) */
  excludeSubtreeOf?: string;
  className?: string;
}

export function ParentPicker({ value, onChange, excludeSubtreeOf, className }: ParentPickerProps) {
  const { tree } = useExpenses();

  const options = useMemo(() => {
    const excluded = excludeSubtreeOf ? tree.subtreeIds(excludeSubtreeOf) : new Set<string>();
    return tree.nodes
      .filter((n) => !excluded.has(n.id) && !tree.isArchived(n.id))
      .map((node) => ({ node, depth: tree.depthOf(node.id) }));
  }, [tree, excludeSubtreeOf]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, className)}
      title="Where in the tree"
    >
      <option value="">(top level)</option>
      {options.map(({ node, depth }) => (
        <option key={node.id} value={node.id}>
          {optionLabel(node, depth)}
        </option>
      ))}
    </select>
  );
}
