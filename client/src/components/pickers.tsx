/*
  Reusable pickers for editing flows:
  - CategoryPicker: grouped native select; creating a new category also asks
    which group it belongs to (strict tree: category → exactly one group).
    Categories of archived projects sink to a trailing "(archived)" section,
    and archived groups are excluded from the new-category group list.
  - GroupPicker: native select with inline "create new"; hides archived groups
  Both match the app's compact form styling.
*/
import { useMemo, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const inputCls =
  "w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

const NEW_SENTINEL = "__new__";

interface CategoryPickerProps {
  value: string;
  onChange: (category: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** Preselected group when creating a new category (e.g. a project context) */
  defaultNewGroup?: string;
  className?: string;
}

export function CategoryPicker({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "— Keep unchanged —",
  defaultNewGroup,
  className,
}: CategoryPickerProps) {
  const { categoryGroups, allGroups, archivedGroups, addCategory } = useExpenses();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState(defaultNewGroup ?? "");

  const { activeGrouped, archivedGrouped } = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [cat, group] of categoryGroups) {
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(cat);
    }
    const entries = Array.from(map.entries())
      .map(([group, cats]) => ({ group, cats: cats.sort() }))
      .sort((a, b) => a.group.localeCompare(b.group));
    return {
      activeGrouped: entries.filter((e) => !archivedGroups.has(e.group)),
      archivedGrouped: entries.filter((e) => archivedGroups.has(e.group)),
    };
  }, [categoryGroups, archivedGroups]);

  const creatableGroups = useMemo(
    () => allGroups.filter((g) => !archivedGroups.has(g)),
    [allGroups, archivedGroups]
  );

  const commitCreate = () => {
    const name = newName.trim();
    const group = (newGroup || defaultNewGroup || creatableGroups[0] || "Other").trim();
    if (!name) return;
    const existingGroup = categoryGroups.get(name);
    if (existingGroup !== undefined) {
      toast.error(
        `"${name}" already exists in ${existingGroup} — pick a distinct name (e.g. "${group} – ${name}")`
      );
      return;
    }
    addCategory(name, group);
    onChange(name);
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
        <select
          value={newGroup || defaultNewGroup || creatableGroups[0] || "Other"}
          onChange={(e) => setNewGroup(e.target.value)}
          className={cn(inputCls, "w-auto shrink-0 max-w-[45%]")}
          title="Group for the new category"
        >
          {creatableGroups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <button
          onClick={commitCreate}
          className="px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium shrink-0"
        >
          Add
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_SENTINEL) setCreating(true);
        else onChange(e.target.value);
      }}
      className={cn(inputCls, className)}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {value && !categoryGroups.has(value) && <option value={value}>{value}</option>}
      {activeGrouped.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={NEW_SENTINEL}>＋ New category…</option>
      {archivedGrouped.map((g) => (
        <optgroup key={g.group} label={`${g.group} (archived)`}>
          {g.cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

interface GroupPickerProps {
  value: string;
  onChange: (group: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}

export function GroupPicker({ value, onChange, allowEmpty, emptyLabel = "— Keep unchanged —", className }: GroupPickerProps) {
  const { allGroups, archivedGroups } = useExpenses();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const options = useMemo(
    () => allGroups.filter((g) => !archivedGroups.has(g) || g === value),
    [allGroups, archivedGroups, value]
  );

  if (creating) {
    return (
      <div className={cn("flex gap-1.5", className)}>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              onChange(newName.trim());
              setCreating(false);
              setNewName("");
            }
            if (e.key === "Escape") setCreating(false);
          }}
          placeholder="New group name…"
          className={inputCls}
        />
        <button
          onClick={() => {
            if (newName.trim()) {
              onChange(newName.trim());
              setCreating(false);
              setNewName("");
            }
          }}
          className="px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium shrink-0"
        >
          Add
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_SENTINEL) setCreating(true);
        else onChange(e.target.value);
      }}
      className={cn(inputCls, className)}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((g) => (
        <option key={g} value={g}>
          {archivedGroups.has(g) ? `${g} (archived)` : g}
        </option>
      ))}
      <option value={NEW_SENTINEL}>＋ New group…</option>
    </select>
  );
}
