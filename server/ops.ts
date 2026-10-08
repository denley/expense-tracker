/*
  Operations behind the agent API. Pure: each takes the parsed workspace and
  returns what to write (Store.apply does the writing, logging, broadcasting).
  They reuse the app's own import detection, dedup and rule logic, so an
  agent's import behaves exactly like one done in the app's dialog.
*/
import type {
  AmountConvention,
  ColumnMapping,
  DateFormat,
  ImportProfile,
  Rule,
  StoredTransaction,
} from "../client/src/lib/types";
import type { WorkspaceData } from "../client/src/lib/files";
import {
  buildTree,
  ensurePaths,
  resolveCategoryIn,
  UNCATEGORIZED_ID,
  type CategoryTree,
} from "../client/src/lib/tree";
import { buildCandidates, dedupKey, detectImportSettings, parseCsvText } from "../client/src/lib/csv";
import {
  applyRules,
  suggestPatternsForUncategorised,
  suggestRulesFromHistory,
} from "../client/src/lib/rules";
import { uid } from "../client/src/lib/id";
import type { OpResult } from "./store";
import type { Undo } from "./activity";

export class OpError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const isUncat = (t: { categoryId: string }) => !t.categoryId || t.categoryId === UNCATEGORIZED_ID;

/** Resolve an id / path / unique name to a node id, or throw a helpful error */
function requireCategory(tree: CategoryTree, ref: unknown, allowArchived = false): string {
  if (typeof ref !== "string" || !ref.trim()) throw new OpError("category is required (an id, a full path, or a unique name)");
  const id = resolveCategoryIn(tree, ref);
  if (!id) {
    const needle = ref.trim().toLowerCase().split(/\s*>\s*/).pop() ?? "";
    const close = tree.nodes
      .filter((n) => n.name.toLowerCase().includes(needle) || needle.includes(n.name.toLowerCase()))
      .slice(0, 5)
      .map((n) => `${n.id} (${tree.pathOf(n.id)})`);
    throw new OpError(
      `Unknown category "${ref}"` +
        (close.length ? `. Close matches: ${close.join("; ")}` : ". GET /api/categories lists them; POST /api/categories creates one")
    );
  }
  if (!allowArchived && tree.isArchived(id)) {
    throw new OpError(`Category "${tree.pathOf(id)}" is archived; pass allowArchived to file into it anyway`);
  }
  return id;
}

function viewTxn(t: StoredTransaction, tree: CategoryTree) {
  return {
    id: t.id,
    date: t.date,
    description: t.description,
    amount: t.amount,
    categoryId: t.categoryId,
    category: tree.pathOf(t.categoryId),
    account: t.account,
    notes: t.notes,
    ...(t.originalAmount !== undefined ? { originalAmount: t.originalAmount, fxRate: t.fxRate } : {}),
  };
}

function accountCoverage(txns: StoredTransaction[]) {
  const map = new Map<string, { account: string; from: string; to: string; count: number }>();
  for (const t of txns) {
    const key = t.account || "(no account)";
    const c = map.get(key);
    if (!c) map.set(key, { account: key, from: t.date, to: t.date, count: 1 });
    else {
      if (t.date < c.from) c.from = t.date;
      if (t.date > c.to) c.to = t.date;
      c.count++;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.account.localeCompare(b.account));
}

/* ---------- Queries ---------- */

export function summary(ws: WorkspaceData) {
  const uncat = ws.transactions.filter(isUncat);
  const dates = ws.transactions.map((t) => t.date).sort();
  return {
    transactions: ws.transactions.length,
    range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    uncategorized: uncat.length,
    uncategorizedTotal: Math.round(uncat.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    accounts: accountCoverage(ws.transactions),
    categories: ws.nodes.length,
    rules: { total: ws.rules.length, enabled: ws.rules.filter((r) => r.enabled).length },
    importProfiles: ws.importProfiles.map((p) => ({ name: p.name, account: p.account })),
  };
}

export function listCategories(ws: WorkspaceData, includeArchived = false) {
  const tree = buildTree(ws.nodes);
  const counts = new Map<string, number>();
  for (const t of ws.transactions) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  return tree.nodes
    .filter((n) => includeArchived || !tree.isArchived(n.id))
    .map((n) => ({
      id: n.id,
      path: tree.pathOf(n.id),
      depth: tree.depthOf(n.id),
      ...(tree.isOneOff(n.id) ? { oneOff: true } : {}),
      ...(tree.isArchived(n.id) ? { archived: true } : {}),
      ...(n.budget !== undefined ? { budget: n.budget } : {}),
      ...(n.notes ? { notes: n.notes } : {}),
      transactions: counts.get(n.id) ?? 0,
    }));
}

export interface TxnQuery {
  uncategorized?: boolean;
  q?: string;
  account?: string;
  from?: string;
  to?: string;
  category?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
}

export function listTransactions(ws: WorkspaceData, query: TxnQuery) {
  const tree = buildTree(ws.nodes);
  let rows = ws.transactions;
  if (query.uncategorized) rows = rows.filter(isUncat);
  if (query.ids?.length) {
    const ids = new Set(query.ids);
    rows = rows.filter((t) => ids.has(t.id));
  }
  if (query.category) {
    const subtree = tree.subtreeIds(requireCategory(tree, query.category, true));
    rows = rows.filter((t) => subtree.has(t.categoryId));
  }
  if (query.account) rows = rows.filter((t) => t.account.toLowerCase() === query.account!.toLowerCase());
  if (query.from) rows = rows.filter((t) => t.date >= query.from!);
  if (query.to) rows = rows.filter((t) => t.date <= query.to!);
  if (query.q) {
    const q = query.q.toLowerCase();
    rows = rows.filter((t) => t.description.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
  }
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(Math.max(1, query.limit ?? 200), 10_000);
  return {
    total: sorted.length,
    offset,
    transactions: sorted.slice(offset, offset + limit).map((t) => viewTxn(t, tree)),
  };
}

export function suggestions(ws: WorkspaceData) {
  const tree = buildTree(ws.nodes);
  const archived = (id: string) => tree.isArchived(id);
  return {
    /** Recurring keywords in the uncategorised pile (rule candidates), with a category guess when history agrees */
    uncategorizedPatterns: suggestPatternsForUncategorised(ws.transactions, ws.rules, 20).map((s) => ({
      pattern: s.pattern,
      covers: s.count,
      ...(s.suggestedCategoryId && !archived(s.suggestedCategoryId)
        ? { suggestedCategoryId: s.suggestedCategoryId, suggestedCategory: tree.pathOf(s.suggestedCategoryId) }
        : {}),
    })),
    /** Merchants already categorised consistently that no rule covers yet */
    fromHistory: suggestRulesFromHistory(ws.transactions, ws.rules, archived)
      .slice(0, 30)
      .map((s) => ({ pattern: s.pattern, categoryId: s.categoryId, category: tree.pathOf(s.categoryId), count: s.count })),
  };
}

/* ---------- Changes ---------- */

export interface CategorizeItem {
  id: string;
  category?: string;
  categoryId?: string;
  notes?: string;
}

export function categorize(
  ws: WorkspaceData,
  items: CategorizeItem[],
  allowArchived = false
): OpResult<{ updated: number; unchanged: number; notFound: string[] }> {
  if (!Array.isArray(items) || items.length === 0) throw new OpError("items must be a non-empty array of {id, category}");
  const tree = buildTree(ws.nodes);
  const wanted = new Map<string, { categoryId?: string; notes?: string }>();
  for (const item of items) {
    if (!item?.id) throw new OpError("every item needs an id");
    const ref = item.categoryId ?? item.category;
    wanted.set(item.id, {
      ...(ref !== undefined ? { categoryId: requireCategory(tree, ref, allowArchived) } : {}),
      ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
    });
  }
  const undo: NonNullable<Undo["txnCategories"]> = [];
  let updated = 0;
  let unchanged = 0;
  const found = new Set<string>();
  const next = ws.transactions.map((t) => {
    const w = wanted.get(t.id);
    if (!w) return t;
    found.add(t.id);
    const categoryId = w.categoryId ?? t.categoryId;
    const notes = w.notes ?? t.notes;
    if (categoryId === t.categoryId && notes === t.notes) {
      unchanged++;
      return t;
    }
    updated++;
    if (categoryId !== t.categoryId) undo.push({ id: t.id, from: t.categoryId, to: categoryId });
    return { ...t, categoryId, notes };
  });
  const notFound = [...wanted.keys()].filter((id) => !found.has(id));
  return {
    changes: updated ? { transactions: next } : undefined,
    undo: undo.length ? { txnCategories: undo } : undefined,
    result: { updated, unchanged, notFound },
  };
}

export function addCategory(
  ws: WorkspaceData,
  input: { path?: string; oneOff?: boolean; color?: string; budget?: number; notes?: string }
): OpResult<{ id: string; path: string; created: string[] }> {
  if (typeof input?.path !== "string" || !input.path.trim()) {
    throw new OpError('path is required, e.g. "Travel > Japan 2027 > Food"');
  }
  const { ids, created } = ensurePaths(ws.nodes, [input.path]);
  const id = ids[input.path];
  const last = created.find((n) => n.id === id);
  if (last) {
    if (input.oneOff) last.oneOff = true;
    if (input.color) last.color = input.color;
    if (typeof input.budget === "number") last.budget = input.budget;
    if (input.notes) last.notes = input.notes;
  }
  const nodes = [...ws.nodes, ...created];
  return {
    changes: created.length ? { nodes } : undefined,
    undo: created.length ? { removeNodes: created.map((n) => n.id) } : undefined,
    result: { id, path: buildTree(nodes).pathOf(id), created: created.map((n) => n.id) },
  };
}

function ruleChanges(
  txns: StoredTransaction[],
  rules: Rule[],
  tree: CategoryTree,
  overwrite: boolean
): { next: StoredTransaction[]; undo: NonNullable<Undo["txnCategories"]> } {
  const { changes } = applyRules(txns, rules, (id) => tree.byId.has(id) && !tree.isArchived(id), { overwrite });
  const target = new Map(changes.map((c) => [c.id, c.toCategoryId]));
  return {
    next: txns.map((t) => (target.has(t.id) ? { ...t, categoryId: target.get(t.id)! } : t)),
    undo: changes.map((c) => ({ id: c.id, from: c.fromCategoryId, to: c.toCategoryId })),
  };
}

export function addRule(
  ws: WorkspaceData,
  input: { pattern?: string; isRegex?: boolean; category?: string; categoryId?: string; apply?: boolean },
  now = new Date()
): OpResult<{ rule: { pattern: string; isRegex: boolean; categoryId: string; category: string }; categorised: number; preview: ReturnType<typeof viewTxn>[] }> {
  const pattern = typeof input?.pattern === "string" ? input.pattern.trim() : "";
  if (!pattern) throw new OpError("pattern is required");
  const isRegex = !!input.isRegex;
  if (isRegex) {
    try {
      new RegExp(pattern, "i");
    } catch (e) {
      throw new OpError(`Invalid regex: ${(e as Error).message}`);
    }
  }
  const tree = buildTree(ws.nodes);
  const categoryId = requireCategory(tree, input.categoryId ?? input.category);
  const dup = ws.rules.find(
    (r) => r.pattern.toLowerCase() === pattern.toLowerCase() && r.isRegex === isRegex && r.categoryId === categoryId
  );
  if (dup) throw new OpError(`An identical rule already exists ("${dup.pattern}" → ${tree.pathOf(categoryId)})`);
  const rule: Rule = { id: uid(), pattern, isRegex, categoryId, enabled: true, createdAt: now.toISOString() };
  const shadowedBy = ws.rules.find(
    (r) => r.enabled && !r.isRegex && !isRegex && pattern.toLowerCase().includes(r.pattern.toLowerCase())
  );
  const rules = [...ws.rules, rule];
  let transactions: StoredTransaction[] | undefined;
  let txnUndo: NonNullable<Undo["txnCategories"]> = [];
  if (input.apply !== false) {
    const r = ruleChanges(ws.transactions, [rule], tree, false);
    if (r.undo.length) {
      transactions = r.next;
      txnUndo = r.undo;
    }
  }
  const touched = new Set(txnUndo.map((u) => u.id));
  return {
    changes: { rules, ...(transactions ? { transactions } : {}) },
    undo: { removeRules: [rule.createdAt], ...(txnUndo.length ? { txnCategories: txnUndo } : {}) },
    result: {
      rule: { pattern, isRegex, categoryId, category: tree.pathOf(categoryId) },
      categorised: txnUndo.length,
      preview: (transactions ?? [])
        .filter((t) => touched.has(t.id))
        .slice(0, 10)
        .map((t) => viewTxn(t, tree)),
      ...(shadowedBy
        ? { warning: `Earlier rule "${shadowedBy.pattern}" also matches these descriptions and takes priority` }
        : {}),
    },
  };
}

export function applyAllRules(ws: WorkspaceData, overwrite = false): OpResult<{ categorised: number }> {
  const tree = buildTree(ws.nodes);
  const r = ruleChanges(ws.transactions, ws.rules, tree, overwrite);
  return {
    changes: r.undo.length ? { transactions: r.next } : undefined,
    undo: r.undo.length ? { txnCategories: r.undo } : undefined,
    result: { categorised: r.undo.length },
  };
}

export interface NewTxn {
  date?: string;
  description?: string;
  amount?: number;
  account?: string;
  category?: string;
  categoryId?: string;
  notes?: string;
}

export function addTransactions(
  ws: WorkspaceData,
  rows: NewTxn[],
  opts: { skipDuplicates?: boolean; applyRules?: boolean } = {}
): OpResult<{ added: number; duplicates: number; ids: string[] }> {
  if (!Array.isArray(rows) || rows.length === 0) throw new OpError("transactions must be a non-empty array");
  const tree = buildTree(ws.nodes);
  const existing = new Set(ws.transactions.map(dedupKey));
  const base = uid();
  const added: StoredTransaction[] = [];
  let duplicates = 0;
  rows.forEach((r, i) => {
    if (typeof r?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      throw new OpError(`transactions[${i}].date must be yyyy-mm-dd`);
    }
    if (typeof r.amount !== "number" || !isFinite(r.amount)) {
      throw new OpError(`transactions[${i}].amount must be a number (positive = expense)`);
    }
    const ref = r.categoryId ?? r.category;
    const t: StoredTransaction = {
      id: base + i.toString(36),
      date: r.date,
      description: (r.description ?? "").trim(),
      amount: Math.round(r.amount * 100) / 100,
      categoryId: ref ? requireCategory(tree, ref) : UNCATEGORIZED_ID,
      account: r.account ?? "",
      notes: r.notes ?? "",
    };
    const key = dedupKey(t);
    if (opts.skipDuplicates !== false && existing.has(key)) {
      duplicates++;
      return;
    }
    existing.add(key);
    added.push(t);
  });
  let rowsOut = added;
  if (opts.applyRules !== false) {
    rowsOut = ruleChanges(added, ws.rules, tree, false).next;
  }
  return {
    changes: rowsOut.length ? { transactions: [...ws.transactions, ...rowsOut] } : undefined,
    undo: rowsOut.length ? { removeTxns: rowsOut.map((t) => t.id) } : undefined,
    result: { added: rowsOut.length, duplicates, ids: rowsOut.map((t) => t.id) },
  };
}

export interface ImportInput {
  csv?: string;
  account?: string;
  profile?: string;
  mapping?: ColumnMapping;
  dateFormat?: DateFormat;
  convention?: AmountConvention;
  fxRate?: number;
  category?: string;
  applyRules?: boolean;
  includeDuplicates?: boolean;
  dryRun?: boolean;
  saveProfile?: string;
}

/** A bank CSV export, same pipeline as the app's import dialog */
export function importCsv(ws: WorkspaceData, input: ImportInput) {
  if (typeof input?.csv !== "string" || !input.csv.trim()) throw new OpError("csv (the file's text) is required");
  const parsed = parseCsvText(input.csv);
  if (parsed.rows.length === 0) throw new OpError("No data rows found in the CSV");
  const tree = buildTree(ws.nodes);

  const detected = detectImportSettings(parsed, ws.importProfiles);
  let profile: ImportProfile | undefined = detected.profile;
  if (input.profile) {
    profile = ws.importProfiles.find((p) => p.name.toLowerCase() === input.profile!.toLowerCase());
    if (!profile) {
      throw new OpError(
        `No saved profile "${input.profile}". Saved: ${ws.importProfiles.map((p) => p.name).join(", ") || "none"}`
      );
    }
  }
  const mapping = input.mapping ?? profile?.mapping ?? detected.mapping;
  const dateFormat = input.dateFormat ?? profile?.dateFormat ?? detected.dateFormat;
  const convention = input.convention ?? profile?.amountConvention ?? detected.convention;
  const account = input.account ?? profile?.account ?? "";
  const fxRaw = input.fxRate ?? profile?.fxRate;
  const fxRate = fxRaw !== undefined && fxRaw > 0 && fxRaw !== 1 ? fxRaw : undefined;
  const importCategory = input.category ? requireCategory(tree, input.category) : undefined;

  const existingKeys = new Set(ws.transactions.map(dedupKey));
  const { candidates, errors } = buildCandidates(
    parsed.rows,
    mapping,
    dateFormat,
    convention,
    account,
    existingKeys,
    (s) => resolveCategoryIn(tree, s),
    (id) => tree.byId.has(id),
    fxRate
  );

  const included = candidates.filter((c) => input.includeDuplicates || !c.duplicate);
  let txns = included.map((c) => (importCategory ? { ...c.txn, categoryId: importCategory } : c.txn));
  let byRules = 0;
  if (input.applyRules !== false) {
    const r = ruleChanges(txns, ws.rules, tree, false);
    byRules = r.undo.length;
    txns = r.next;
  }
  // Category names from the file that didn't match the tree are created
  // (only for rows nothing else categorised), like the dialog does
  const unresolved = Array.from(
    new Set(included.filter((c, i) => c.unresolvedCategory && isUncat(txns[i])).map((c) => c.unresolvedCategory!))
  );
  const { ids: createdIds, created } = ensurePaths(ws.nodes, unresolved);
  if (unresolved.length) {
    txns = txns.map((t, i) => {
      const name = included[i].unresolvedCategory;
      return name && isUncat(t) && createdIds[name] ? { ...t, categoryId: createdIds[name] } : t;
    });
  }
  const nodes = created.length ? [...ws.nodes, ...created] : ws.nodes;
  const viewTree = created.length ? buildTree(nodes) : tree;

  const dates = txns.map((t) => t.date).sort();
  const coverage = accountCoverage(ws.transactions);
  const warnings: string[] = [];
  if (!account && mapping.account === undefined) {
    warnings.push("No account label: pass account (e.g. \"ANZ Visa\") so coverage per account stays meaningful");
  }
  for (const acct of new Set(txns.map((t) => t.account || "(no account)"))) {
    const have = coverage.find((c) => c.account === acct);
    const first = txns.filter((t) => (t.account || "(no account)") === acct).map((t) => t.date).sort()[0];
    if (have && first && Date.parse(first) - Date.parse(have.to) > 2 * 86_400_000) {
      warnings.push(`Gap for ${acct}: stored data ends ${have.to}, this file starts ${first}`);
    }
  }

  let importProfiles: ImportProfile[] | undefined;
  if (input.saveProfile?.trim() && !input.dryRun) {
    const name = input.saveProfile.trim();
    const prev = ws.importProfiles.find((p) => p.name === name);
    const saved: ImportProfile = {
      id: prev?.id ?? uid(),
      name,
      account,
      mapping,
      dateFormat,
      amountConvention: convention,
      hasHeader: parsed.hasHeader,
      ...(fxRate !== undefined ? { fxRate } : {}),
    };
    importProfiles = prev
      ? ws.importProfiles.map((p) => (p.id === prev.id ? saved : p))
      : [...ws.importProfiles, saved];
  }

  const uncategorized = txns.filter(isUncat);
  const result = {
    dryRun: !!input.dryRun,
    file: { rows: parsed.rows.length, hasHeader: parsed.hasHeader, header: parsed.header },
    settings: {
      mapping,
      dateFormat,
      convention,
      account,
      ...(profile ? { profile: profile.name } : {}),
      ...(fxRate !== undefined ? { fxRate } : {}),
    },
    imported: input.dryRun ? 0 : txns.length,
    new: txns.length,
    duplicatesSkipped: input.includeDuplicates ? 0 : candidates.filter((c) => c.duplicate).length,
    errors: errors.slice(0, 20).map((e) => ({ row: e.rowIndex + 1, reason: e.reason, cells: e.row })),
    range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    total: Math.round(txns.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    categorisedByRules: byRules,
    createdCategories: created.map((n) => viewTree.pathOf(n.id)),
    uncategorized: uncategorized.length,
    uncategorizedIds: uncategorized.map((t) => t.id),
    sample: txns.slice(0, 10).map((t) => viewTxn(t, viewTree)),
    warnings,
  };

  if (input.dryRun || (txns.length === 0 && !importProfiles)) return { result } as OpResult<typeof result>;
  return {
    changes: {
      ...(txns.length ? { transactions: [...ws.transactions, ...txns] } : {}),
      ...(created.length ? { nodes } : {}),
      ...(importProfiles ? { importProfiles } : {}),
    },
    undo: txns.length
      ? { removeTxns: txns.map((t) => t.id), ...(created.length ? { removeNodes: created.map((n) => n.id) } : {}) }
      : undefined,
    snapshot: txns.length ? "pre-import" : undefined,
    result,
  } as OpResult<typeof result>;
}

/** Revert an agent operation, leaving anything changed since alone */
export function undo(ws: WorkspaceData, recipe: Undo): OpResult<{ reverted: number; skipped: number }> {
  let reverted = 0;
  let skipped = 0;
  let transactions = ws.transactions;
  let nodes = ws.nodes;
  let rules = ws.rules;
  let txnsChanged = false;

  if (recipe.txnCategories?.length) {
    const byId = new Map(recipe.txnCategories.map((u) => [u.id, u]));
    transactions = transactions.map((t) => {
      const u = byId.get(t.id);
      if (!u) return t;
      if (t.categoryId !== u.to) {
        skipped++;
        return t;
      }
      reverted++;
      txnsChanged = true;
      return { ...t, categoryId: u.from };
    });
  }
  if (recipe.removeTxns?.length) {
    const ids = new Set(recipe.removeTxns);
    const before = transactions.length;
    transactions = transactions.filter((t) => !ids.has(t.id));
    reverted += before - transactions.length;
    if (before !== transactions.length) txnsChanged = true;
  }
  if (recipe.removeRules?.length) {
    const created = new Set(recipe.removeRules);
    const before = rules.length;
    rules = rules.filter((r) => !created.has(r.createdAt));
    reverted += before - rules.length;
  }
  if (recipe.removeNodes?.length) {
    const used = new Set([...transactions.map((t) => t.categoryId), ...rules.map((r) => r.categoryId)]);
    // children first so a created chain can go entirely
    for (const id of [...recipe.removeNodes].reverse()) {
      if (used.has(id) || nodes.some((n) => n.parentId === id)) {
        skipped++;
        continue;
      }
      nodes = nodes.filter((n) => n.id !== id);
      reverted++;
    }
  }
  return {
    changes: {
      ...(txnsChanged ? { transactions } : {}),
      ...(nodes !== ws.nodes ? { nodes } : {}),
      ...(rules !== ws.rules ? { rules } : {}),
    },
    result: { reverted, skipped },
  };
}
