/*
  Reusable pickers for editing flows:
  - CategoryPicker: the whole tree as an indented native select. ANY node is
    selectable (filing at a parent level is a feature — refine later).
    Archived subtrees sink to a trailing "(archived)" section; one-off
    ("project") subtrees cluster after regular ones at each level (tree order).
    Creating a new category inline also asks where it goes in the tree.
  - ParentPicker: choose a parent node (or top level) for create/move flows.
  Both match the app's compact form styling. Values are node ids.
*/
import { useMemo, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { CategoryNode } from "@/lib/types";
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
}

export function CategoryPicker({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "— Keep unchanged —",
  defaultNewParentId = null,
  className,
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
