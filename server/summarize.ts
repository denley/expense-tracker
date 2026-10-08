/*
  Human-readable summaries of a change, computed by diffing a file's old and
  new content. Used for every write regardless of who made it (the app, the
  agent API, a direct file edit), so the activity log never depends on the
  writer describing itself.

  A summary is counts per kind ("recategorised": 12) plus a few examples;
  counts add up when consecutive edits are coalesced into one log entry.
*/
import { csvToTransactions } from "../client/src/lib/export";
import { csvToNodes, csvToRules, jsonToProfiles, WS_FILES } from "../client/src/lib/files";
import { buildTree, type CategoryTree } from "../client/src/lib/tree";
import type { StoredTransaction } from "../client/src/lib/types";

export interface ChangeSummary {
  counts: Record<string, number>;
  examples: string[];
}

const MAX_EXAMPLES = 4;

const money = (n: number) => `$${n.toFixed(2)}`;
const quote = (s: string) => `"${s.length > 40 ? s.slice(0, 39) + "…" : s}"`;

function txnFieldsChanged(a: StoredTransaction, b: StoredTransaction): string[] {
  const fields: string[] = [];
  if (a.date !== b.date) fields.push("date");
  if (a.description !== b.description) fields.push("description");
  if (a.amount !== b.amount) fields.push("amount");
  if (a.account !== b.account) fields.push("account");
  if (a.notes !== b.notes) fields.push("notes");
  return fields;
}

export function summarizeTransactions(
  oldText: string | undefined,
  newText: string,
  tree: CategoryTree
): ChangeSummary {
  const before = (oldText !== undefined && csvToTransactions(oldText)) || [];
  const after = csvToTransactions(newText);
  if (after === null) return { counts: { unreadable: 1 }, examples: [] };
  const oldById = new Map(before.map((t) => [t.id, t]));
  const newIds = new Set(after.map((t) => t.id));
  const counts: Record<string, number> = {};
  const examples: string[] = [];
  const bump = (k: string, example?: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
    if (example && examples.length < MAX_EXAMPLES) examples.push(example);
  };
  for (const t of after) {
    const prev = oldById.get(t.id);
    if (!prev) {
      bump("added", `+ ${t.date} ${quote(t.description)} ${money(t.amount)}`);
      continue;
    }
    if (prev.categoryId !== t.categoryId) {
      bump("recategorised", `${quote(t.description)} → ${tree.pathOf(t.categoryId)}`);
    }
    const fields = txnFieldsChanged(prev, t);
    if (fields.length) bump("edited", `${quote(t.description)}: ${fields.join(", ")}`);
  }
  for (const t of before) {
    if (!newIds.has(t.id)) bump("deleted", `− ${t.date} ${quote(t.description)} ${money(t.amount)}`);
  }
  return { counts, examples };
}

export function summarizeCategories(oldText: string | undefined, newText: string): ChangeSummary {
  const before = oldText ? csvToNodes(oldText) : [];
  const after = csvToNodes(newText);
  const oldTree = buildTree(before);
  const newTree = buildTree(after);
  const counts: Record<string, number> = {};
  const examples: string[] = [];
  const bump = (k: string, example: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
    if (examples.length < MAX_EXAMPLES) examples.push(example);
  };
  const oldById = new Map(before.map((n) => [n.id, n]));
  for (const n of after) {
    const prev = oldById.get(n.id);
    if (!prev) {
      bump("category-added", `+ ${newTree.pathOf(n.id)}`);
      continue;
    }
    if (prev.name !== n.name) bump("category-renamed", `${quote(prev.name)} → ${quote(n.name)}`);
    if ((prev.parentId ?? null) !== (n.parentId ?? null)) {
      bump("category-moved", `${oldTree.pathOf(n.id)} → ${newTree.pathOf(n.id)}`);
    }
    if (!!prev.archived !== !!n.archived) {
      bump(n.archived ? "category-archived" : "category-restored", newTree.pathOf(n.id));
    }
    if (
      !!prev.oneOff !== !!n.oneOff ||
      prev.color !== n.color ||
      prev.budget !== n.budget ||
      prev.notes !== n.notes
    ) {
      bump("category-edited", newTree.pathOf(n.id));
    }
  }
  const newIds = new Set(after.map((n) => n.id));
  for (const n of before) if (!newIds.has(n.id)) bump("category-deleted", `− ${oldTree.pathOf(n.id)}`);
  return { counts, examples };
}

export function summarizeRules(
  oldText: string | undefined,
  newText: string,
  tree: CategoryTree
): ChangeSummary {
  const before = oldText ? csvToRules(oldText) : [];
  const after = csvToRules(newText);
  const counts: Record<string, number> = {};
  const examples: string[] = [];
  const bump = (k: string, example: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
    if (examples.length < MAX_EXAMPLES) examples.push(example);
  };
  const oldById = new Map(before.map((r) => [r.id, r]));
  for (const r of after) {
    const prev = oldById.get(r.id);
    const label = `${quote(r.pattern)} → ${tree.pathOf(r.categoryId)}`;
    if (!prev) bump("rule-added", `+ ${label}`);
    else if (prev.enabled !== r.enabled) bump(r.enabled ? "rule-enabled" : "rule-disabled", label);
    else if (prev.pattern !== r.pattern || prev.categoryId !== r.categoryId || prev.isRegex !== r.isRegex) {
      bump("rule-edited", label);
    }
  }
  const newIds = new Set(after.map((r) => r.id));
  for (const r of before) if (!newIds.has(r.id)) bump("rule-deleted", `− ${quote(r.pattern)}`);
  const order = (list: typeof before) => list.map((r) => r.id).filter((id) => oldById.has(id) && newIds.has(id));
  if (Object.keys(counts).length === 0 && order(before).join() !== order(after).join()) {
    bump("rule-reordered", "priority order changed");
  }
  return { counts, examples };
}

export function summarizeProfiles(oldText: string | undefined, newText: string): ChangeSummary {
  const before = oldText ? jsonToProfiles(oldText) : [];
  const after = jsonToProfiles(newText);
  const counts: Record<string, number> = {};
  const examples: string[] = [];
  const oldById = new Map(before.map((p) => [p.id, JSON.stringify(p)]));
  for (const p of after) {
    if (oldById.get(p.id) !== JSON.stringify(p)) {
      counts["profile-saved"] = (counts["profile-saved"] ?? 0) + 1;
      examples.push(p.name);
    }
  }
  const newIds = new Set(after.map((p) => p.id));
  for (const p of before) {
    if (!newIds.has(p.id)) {
      counts["profile-deleted"] = (counts["profile-deleted"] ?? 0) + 1;
      examples.push(`− ${p.name}`);
    }
  }
  return { counts, examples: examples.slice(0, MAX_EXAMPLES) };
}

/** Summarize a set of file changes; `tree` names categories (use the newest tree) */
export function summarizeChanges(
  changes: Array<{ name: string; oldText: string | undefined; newText: string }>,
  newCategoriesText: string | undefined
): ChangeSummary {
  const tree = buildTree(newCategoriesText ? csvToNodes(newCategoriesText) : []);
  const merged: ChangeSummary = { counts: {}, examples: [] };
  for (const c of changes) {
    const s =
      c.name === WS_FILES.transactions ? summarizeTransactions(c.oldText, c.newText, tree)
      : c.name === WS_FILES.categories ? summarizeCategories(c.oldText, c.newText)
      : c.name === WS_FILES.rules ? summarizeRules(c.oldText, c.newText, tree)
      : summarizeProfiles(c.oldText, c.newText);
    mergeSummary(merged, s);
  }
  return merged;
}

export function mergeSummary(into: ChangeSummary, add: ChangeSummary): ChangeSummary {
  for (const [k, n] of Object.entries(add.counts)) into.counts[k] = (into.counts[k] ?? 0) + n;
  for (const e of add.examples) if (into.examples.length < MAX_EXAMPLES) into.examples.push(e);
  return into;
}

const PHRASES: Record<string, [string, string]> = {
  added: ["Added", "transaction"],
  recategorised: ["Recategorised", "transaction"],
  edited: ["Edited", "transaction"],
  deleted: ["Deleted", "transaction"],
  unreadable: ["Left transactions.csv unreadable", ""],
  "category-added": ["Added", "category"],
  "category-renamed": ["Renamed", "category"],
  "category-moved": ["Moved", "category"],
  "category-archived": ["Archived", "category"],
  "category-restored": ["Restored", "category"],
  "category-edited": ["Edited", "category"],
  "category-deleted": ["Deleted", "category"],
  "rule-added": ["Added", "rule"],
  "rule-enabled": ["Enabled", "rule"],
  "rule-disabled": ["Disabled", "rule"],
  "rule-edited": ["Edited", "rule"],
  "rule-deleted": ["Deleted", "rule"],
  "rule-reordered": ["Reordered rules", ""],
  "profile-saved": ["Saved", "bank profile"],
  "profile-deleted": ["Deleted", "bank profile"],
};

const plural = (noun: string, n: number) =>
  n === 1 ? noun : noun === "category" ? "categories" : `${noun}s`;

/** "Recategorised 12 transactions, added 1 rule" */
export function renderSummary(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const [kind, [verb, noun]] of Object.entries(PHRASES)) {
    const n = counts[kind];
    if (!n) continue;
    parts.push(noun ? `${verb} ${n} ${plural(noun, n)}` : verb);
  }
  if (parts.length === 0) return "No visible changes";
  return parts.map((p, i) => (i === 0 ? p : p[0].toLowerCase() + p.slice(1))).join(", ");
}
