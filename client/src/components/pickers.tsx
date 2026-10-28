/*
  Reusable category choosers for editing and browsing flows. Each is a button +
  popover with a search box over the tree, properly indented (a native <option>
  can't render hierarchy or search past the first letter). Typing on a focused
  chooser opens it with the search started; arrow keys + Enter pick. A search
  flattens the list to full-path matches (searchCategories in lib/tree).
  - CategoryPicker: ANY node is selectable (filing at a parent level is a
    feature — refine later). Archived subtrees sink to a trailing "Archived"
    section; one-off ("project") subtrees cluster after regular ones at each
    level (tree order). "New category" opens NewCategoryDialog (name, where it
    goes, one-off) seeded with the search text.
  - ParentPicker: choose a parent node (or top level) for create/move flows.
  - CategoryTreeDropdown: browse/filter chooser with (scoped) rolled-up totals.
  All match the app's compact form styling. Values are node ids.
*/
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { CategoryNode } from "@/lib/types";
import { PATH_SEP, searchCategories, validateName } from "@/lib/tree";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { ChevronsUpDown, CornerDownRight, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputCls =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

interface CategoryChooserProps {
  /** Selected node id, or "" */
  value: string;
  onChange: (categoryId: string) => void;
  /** Button content for the current value */
  label: ReactNode;
  title?: string;
  className?: string;
  /** The "" choice, listed above the tree while not searching (omit to require a node) */
  emptyLabel?: string;
  emptyDetail?: string;
  /** Candidates in display order (default: the whole tree) */
  nodes?: CategoryNode[];
  /** Archived subtrees in a trailing section instead of in place */
  archivedLast?: boolean;
  /** Right-aligned detail per node row (e.g. totals) */
  detail?: (id: string) => ReactNode;
  /** Offer "＋ New category"; receives the search text as the suggested name */
  onCreate?: (name: string) => void;
  contentClassName?: string;
  /** Focus the button on mount, so typing starts a search */
  autoFocus?: boolean;
}

/** Button + popover shared by every chooser below */
function CategoryChooser({
  value,
  onChange,
  label,
  title,
  className,
  contentClassName,
  onCreate,
  autoFocus,
  ...menu
}: CategoryChooserProps) {
  const [open, setOpen] = useState(false);
  // What the user typed on the closed button, to start the search with
  const [seed, setSeed] = useState("");
  // "New category" waits for the popover to close: its focus return to the
  // button would otherwise steal focus from whatever onCreate opens
  const pendingCreate = useRef<string | null>(null);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const typed = e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (typed || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSeed(typed ? e.key : "");
      setOpen(true);
    }
  };

  return (
    // Modal so the list scrolls inside dialogs (their scroll lock would swallow the wheel)
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setSeed("");
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          autoFocus={autoFocus}
          onKeyDown={onTriggerKeyDown}
          className={cn(inputCls, "flex items-center gap-2 text-left", className)}
        >
          {label}
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[calc(100vw-1rem)]",
          contentClassName
        )}
        onOpenAutoFocus={(e) => {
          // Radix would select the search text, so a seeded letter got typed over
          e.preventDefault();
          // On touch, let the list be scrolled and tapped without the keyboard covering it
          if (window.matchMedia?.("(pointer: coarse)").matches) return;
          (e.currentTarget as HTMLElement | null)?.querySelector("input")?.focus();
        }}
        onCloseAutoFocus={(e) => {
          const name = pendingCreate.current;
          if (name === null) return;
          pendingCreate.current = null;
          e.preventDefault();
          onCreate?.(name);
        }}
      >
        <CategoryMenu
          {...menu}
          value={value}
          initialQuery={seed}
          onPick={(id) => {
            setOpen(false);
            onChange(id);
          }}
          onCreate={
            onCreate &&
            ((name) => {
              pendingCreate.current = name;
              setOpen(false);
            })
          }
        />
      </PopoverContent>
    </Popover>
  );
}

type MenuRow =
  | { kind: "empty" }
  | { kind: "node"; node: CategoryNode; depth: number; archived: boolean }
  | { kind: "create" };

interface CategoryMenuProps
  extends Pick<CategoryChooserProps, "value" | "emptyLabel" | "emptyDetail" | "nodes" | "archivedLast" | "detail" | "onCreate"> {
  initialQuery: string;
  onPick: (categoryId: string) => void;
}

/** Scrolls `row` into view inside `list` only (scrollIntoView would also move the page) */
function scrollToRow(list: HTMLElement, row: HTMLElement, center: boolean) {
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (center) list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2;
  else if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/** Search box + list; mounted fresh on every open */
function CategoryMenu({
  value,
  emptyLabel,
  emptyDetail,
  nodes,
  archivedLast,
  detail,
  onCreate,
  initialQuery,
  onPick,
}: CategoryMenuProps) {
  const { tree } = useExpenses();
  const [query, setQuery] = useState(initialQuery);
  // Highlighted row; -1 = the selected one (or the best match while searching)
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const canCreate = !!onCreate;

  const rows = useMemo<MenuRow[]>(() => {
    const out: MenuRow[] = [];
    const nodeRow = (node: CategoryNode, depth: number): Extract<MenuRow, { kind: "node" }> => ({
      kind: "node",
      node,
      depth,
      archived: tree.isArchived(node.id),
    });
    const candidates = nodes ?? tree.nodes;
    if (q) {
      for (const node of searchCategories(tree, q, candidates)) out.push(nodeRow(node, 0));
    } else {
      if (emptyLabel !== undefined) out.push({ kind: "empty" });
      const all = candidates.map((node) => nodeRow(node, tree.depthOf(node.id)));
      // Depth-first order, so archived subtrees stay whole when moved to the end
      if (archivedLast) out.push(...all.filter((r) => !r.archived), ...all.filter((r) => r.archived));
      else out.push(...all);
    }
    if (canCreate) out.push({ kind: "create" });
    return out;
  }, [tree, nodes, q, emptyLabel, archivedLast, canCreate]);

  const selectedIndex = q
    ? 0
    : rows.findIndex((r) => (r.kind === "node" ? r.node.id === value : r.kind === "empty" && value === ""));
  const activeIndex = Math.min(active >= 0 ? active : Math.max(0, selectedIndex), rows.length - 1);

  // A new search starts at the top; no search centres the current value
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-index="${Math.max(0, selectedIndex)}"]`);
    if (q || !row) list.scrollTop = 0;
    else scrollToRow(list, row, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the search changes
  }, [q]);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, activeIndex + delta));
    setActive(next);
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${next}"]`);
    if (list && row) scrollToRow(list, row, false);
  };

  const choose = (row: MenuRow | undefined) => {
    if (!row) return;
    if (row.kind === "empty") onPick("");
    else if (row.kind === "node") onPick(row.node.id);
    else onCreate?.(q);
  };

  const rowCls = (i: number, selected: boolean) =>
    cn(
      "flex w-full items-center px-3 py-1.5 text-sm text-left",
      i === activeIndex && "bg-accent",
      selected && (i === activeIndex ? "bg-primary/15 text-primary" : "bg-primary/10 text-primary")
    );
  const rowProps = (i: number, row: MenuRow) => ({
    type: "button" as const,
    tabIndex: -1,
    "data-index": i,
    onMouseMove: () => i !== activeIndex && setActive(i),
    onClick: () => choose(row),
  });
  const matches = rows.some((r) => r.kind === "node");

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              move(e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "PageDown" || e.key === "PageUp") {
              e.preventDefault();
              move(e.key === "PageDown" ? 8 : -8);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(rows[activeIndex]);
            }
          }}
          placeholder="Search categories…"
          aria-label="Search categories"
          className="flex-1 min-w-0 bg-transparent text-base md:text-sm focus:outline-none"
        />
      </div>
      <div ref={listRef} className="relative max-h-[min(340px,50vh)] overflow-y-auto overscroll-contain py-1">
        {rows.map((row, i) => {
          if (row.kind === "empty") {
            return (
              <button key="__empty__" {...rowProps(i, row)} className={cn(rowCls(i, value === ""), "font-medium")}>
                <span className="truncate">{emptyLabel}</span>
                {emptyDetail && (
                  <span className="ml-auto shrink-0 pl-3 text-muted-foreground text-xs">{emptyDetail}</span>
                )}
              </button>
            );
          }
          if (row.kind === "create") {
            return (
              <button
                key="__create__"
                {...rowProps(i, row)}
                className={cn(rowCls(i, false), "text-primary", matches && "mt-1 border-t border-border/60")}
              >
                <Plus className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                <span className="truncate">{q ? `New category "${q}"…` : "New category…"}</span>
              </button>
            );
          }
          const { node, depth, archived } = row;
          // In the trailing section the header already says so
          const inArchivedSection = archivedLast && !q && archived;
          const prev = rows[i - 1];
          const firstArchived = inArchivedSection && !(prev?.kind === "node" && prev.archived);
          return (
            <div key={node.id}>
              {firstArchived && (
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Archived
                </p>
              )}
              <button
                {...rowProps(i, row)}
                className={cn(rowCls(i, node.id === value), archived && "opacity-50")}
                style={{ paddingLeft: 12 + depth * 18 }}
              >
                {depth > 0 && <CornerDownRight className="w-3 h-3 mr-1.5 shrink-0 text-muted-foreground/50" />}
                <span className="truncate">
                  {q ? tree.pathOf(node.id) : node.name}
                  {node.oneOff ? " ◈" : ""}
                  {archived && !inArchivedSection ? " (archived)" : ""}
                </span>
                {detail?.(node.id)}
              </button>
            </div>
          );
        })}
        {q && !matches && (
          <p className="px-3 py-3 text-xs text-muted-foreground">No categories match "{q}"</p>
        )}
      </div>
    </>
  );
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
  /** Offer "＋ New category…" (off where the picker can't grow into a form) */
  allowCreate?: boolean;
  /** Focus on mount, so typing starts a search */
  autoFocus?: boolean;
}

export function CategoryPicker({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "— Keep unchanged —",
  defaultNewParentId = null,
  className,
  allowCreate = true,
  autoFocus,
}: CategoryPickerProps) {
  const { tree, pathOf } = useExpenses();
  // Suggested name while the new-category dialog is open
  const [creating, setCreating] = useState<string | null>(null);

  const node = value ? tree.byId.get(value) : undefined;
  const text = node
    ? `${node.name}${node.oneOff ? " ◈" : ""}`
    : value || (allowEmpty ? emptyLabel : "Choose category…");
  return (
    <>
      <CategoryChooser
        value={value}
        onChange={onChange}
        label={<span className={cn("flex-1 min-w-0 truncate", !value && "text-muted-foreground")}>{text}</span>}
        title={node ? pathOf(value) : undefined}
        className={className}
        autoFocus={autoFocus}
        emptyLabel={allowEmpty ? emptyLabel : undefined}
        archivedLast
        onCreate={allowCreate ? setCreating : undefined}
      />
      {allowCreate && (
        <NewCategoryDialog
          open={creating !== null}
          onOpenChange={(open) => !open && setCreating(null)}
          initialName={creating ?? ""}
          defaultParentId={defaultNewParentId}
          onCreated={onChange}
        />
      )}
    </>
  );
}

interface NewCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  defaultParentId?: string | null;
  /** Called with the new node's id once it's added */
  onCreated: (categoryId: string) => void;
}

/** Name, place in the tree and one-off flag for a category made from a picker */
export function NewCategoryDialog({
  open,
  onOpenChange,
  initialName,
  defaultParentId = null,
  onCreated,
}: NewCategoryDialogProps) {
  const { tree, addNode, pathOf } = useExpenses();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [oneOff, setOneOff] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setParent(defaultParentId && tree.byId.has(defaultParentId) ? defaultParentId : "");
    setOneOff(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on each open only
  }, [open]);

  const trimmed = name.trim();
  const error = trimmed ? validateName(tree, trimmed, parent || null) : null;
  // Inside a one-off subtree the new node is one-off anyway
  const inheritsOneOff = !!parent && tree.isOneOff(parent);

  const create = () => {
    if (!trimmed || error) return;
    const node = addNode(trimmed, parent || null, oneOff && !inheritsOneOff ? { oneOff: true } : undefined);
    if (!node) return; // validation toast already shown
    onCreated(node.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[420px]"
        // Caret after the suggested name (Radix would select it, so typing replaced it)
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>Pick where it sits in the tree; you can move it later.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
              placeholder="e.g. Pets"
              className={cn(inputCls, "text-base md:text-sm")}
            />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Inside</span>
            <ParentPicker value={parent} onChange={setParent} />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={oneOff || inheritsOneOff}
              disabled={inheritsOneOff}
              onChange={(e) => setOneOff(e.target.checked)}
              className="accent-[var(--color-eucalyptus)]"
            />
            <span>
              One-off cost centre ◈ <span className="text-muted-foreground">(a trip, a renovation…)</span>
              {inheritsOneOff && <span className="text-muted-foreground"> — already, from its parent</span>}
            </span>
          </label>
          {trimmed && (
            <p className={cn("text-xs", error ? "text-terracotta" : "text-muted-foreground")}>
              {error ?? (
                <>
                  Creates{" "}
                  <span className="font-medium text-foreground">
                    {parent ? `${pathOf(parent)}${PATH_SEP}${trimmed}` : trimmed}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <DialogFooter className="flex gap-2 sm:justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={!trimmed || !!error}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
 * Browse/filter chooser: shows the selected full path and lists one-off
 * markers and (scoped) rolled-up totals, archived nodes in place.
 */
export function CategoryTreeDropdown({
  value,
  onChange,
  allLabel,
  allDetail,
  className,
}: CategoryTreeDropdownProps) {
  const { tree, nodeStats, pathOf } = useExpenses();

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
    <CategoryChooser
      value={value}
      onChange={onChange}
      label={
        <>
          <span className="flex-1 min-w-0 truncate font-medium">{selectedLabel}</span>
          {!value && allDetail && (
            <span className="shrink-0 text-muted-foreground text-xs">{allDetail}</span>
          )}
        </>
      }
      className={className}
      contentClassName="min-w-[320px]"
      emptyLabel={allLabel}
      emptyDetail={allDetail}
      detail={rowStats}
    />
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
  const { tree, pathOf } = useExpenses();

  const candidates = useMemo(() => {
    const excluded = excludeSubtreeOf ? tree.subtreeIds(excludeSubtreeOf) : new Set<string>();
    return tree.nodes.filter((n) => !excluded.has(n.id) && !tree.isArchived(n.id));
  }, [tree, excludeSubtreeOf]);

  const node = value ? tree.byId.get(value) : undefined;
  return (
    <CategoryChooser
      value={value}
      onChange={onChange}
      label={<span className="flex-1 min-w-0 truncate">{node?.name ?? (value || "(top level)")}</span>}
      title={node ? `Under ${pathOf(value)}` : "Where in the tree"}
      className={className}
      emptyLabel="(top level)"
      nodes={candidates}
    />
  );
}
