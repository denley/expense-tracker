/*
  Central data store, backed by the server.
  The source of truth is the server's data folder:
  transactions.csv / categories.csv / rules.csv / import-profiles.json.
  - Each file is a FileSync (lib/sync): edits apply locally at once and are
    written to the server as replayable updaters against the file's revision,
    so concurrent edits (other people, other tabs, agents) merge instead of
    clobbering each other
  - A live event stream reports every change on the server; changed files
    are re-read and anything made by someone else is announced
  - categories.csv is an arbitrary-depth tree (adjacency list). Transactions
    reference a node by id and may be filed on ANY node; reports roll
    descendants up into ancestors. Tree edits never rewrite transactions.csv.
  - A node flagged oneOff is a "project" (one-off cost centre); the
    hideOneOffs setting excludes those subtrees from the overview analytics.
*/
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  Transaction,
  StoredTransaction,
  CategoryNode,
  Rule,
  ImportProfile,
  Settings,
  MonthlyData,
  NodeStats,
} from "@/lib/types";

export interface AccountCoverage {
  account: string;
  from: string;
  to: string;
  count: number;
}
import { MONTH_LABELS, groupColor } from "@/lib/types";
import {
  buildTree,
  slugForName,
  validateName,
  resolveCategoryIn,
  ensurePaths,
  UNCATEGORIZED_ID,
  type CategoryTree,
} from "@/lib/tree";
import { dbGet, dbSet, KEYS } from "@/lib/db";
import { uid } from "@/lib/id";
import { csvToTransactions } from "@/lib/export";
import {
  WS_FILES,
  serializeTxns,
  nodesToCsv,
  csvToNodes,
  rulesToCsv,
  csvToRules,
  profilesToJson,
  jsonToProfiles,
  normalizeLoaded,
  serializeWorkspace,
  type WsFileName,
} from "@/lib/files";
import * as api from "@/lib/api";
import type { Actor, ActivityEntry } from "@/lib/api";
import { FileSync, type Updater } from "@/lib/sync";
import { applyRules, type RuleChange } from "@/lib/rules";
import { parseScope, scopeContains, scopeLabelOf } from "@/lib/scope";
import { toast } from "sonner";

export type WorkspaceStatus =
  | "checking" // booting, don't render anything yet
  | "connected"
  | "error"; // server unreachable, or its transactions.csv is unreadable

/** saved = everything is on the server; saving = writes queued; offline = retrying */
export type SyncStatus = "saved" | "saving" | "offline";

export interface TransactionChanges {
  categoryId?: string;
  account?: string;
  notes?: string;
  description?: string;
  date?: string; // ISO
  amount?: number;
}

interface ExpenseContextType {
  loading: boolean;
  error: string | null;

  // Server connection
  workspaceStatus: WorkspaceStatus;
  workspaceError: string | null;
  syncStatus: SyncStatus;
  /** Who the server says we are (Tailscale identity) */
  me: Actor | null;
  /** Where the server keeps the data (for display) */
  dataDir: string;
  /** Re-read every file from the server */
  reloadFromServer: () => Promise<void>;
  /** Retry the initial connection after an error */
  retryConnect: () => void;
  /** The most recent change on the server (bumps on every change event) */
  lastChange: { at: number; entry?: ActivityEntry } | null;

  /** Transactions within the current year scope (runtime form, sorted by date) */
  transactions: Transaction[];
  /** Every transaction regardless of scope */
  allTransactions: Transaction[];
  /** Raw stored form — for export and import dedup */
  storedTransactions: StoredTransaction[];

  /** The category tree */
  nodes: CategoryNode[];
  tree: CategoryTree;
  nameOf: (id: string) => string;
  pathOf: (id: string) => string;
  /** Chart color for a node: its own color, else its root's, else the name hash */
  colorOf: (id: string) => string;

  rules: Rule[];
  importProfiles: ImportProfile[];

  // Scope ("all", a year like "2025", or "range:from:to" — see lib/scope)
  yearScope: string;
  setYearScope: (scope: string) => void;
  availableYears: string[];
  /** Human-readable form of the current scope, e.g. "2025" or "1 Jun 2024 – 13 Aug 2025" */
  scopeLabel: string;

  /** Exclude one-off (project) subtrees from the overview analytics below */
  hideOneOffs: boolean;
  setHideOneOffs: (hide: boolean) => void;
  /** True when the scoped data actually contains one-off spending (show the toggle) */
  hasOneOffSpend: boolean;

  // Derived overview analytics (scoped; respect hideOneOffs)
  totalSpend: number;
  monthlyData: MonthlyData[];
  /** Root (top-level) buckets, sorted by rolled-up total desc */
  groupData: NodeStats[];
  /** Root bucket names with activity, sorted by total desc */
  groups: string[];
  avgMonthlySpend: number;
  groupColors: Record<string, string>;

  // Per-node aggregates (scoped; NOT filtered by hideOneOffs — used by drill-down)
  nodeStats: Map<string, NodeStats>;
  /** Scoped transactions with one-off subtrees removed when the toggle is on */
  analysisTransactions: Transaction[];
  /** nodeStats over analysisTransactions (identical to nodeStats when the toggle is off) */
  analysisNodeStats: Map<string, NodeStats>;

  accounts: string[];
  /** Date range held per account across ALL data (not year-scoped) — tells you what to export next */
  accountCoverage: AccountCoverage[];

  // Transaction actions
  addTransactions: (txns: StoredTransaction[]) => void;
  updateTransactions: (ids: string[], changes: TransactionChanges) => void;
  deleteTransactions: (ids: string[]) => void;
  /**
   * Replace one transaction with 2+ parts that must sum to its amount.
   * Parts keep the parent's date, description and account; each part gets
   * its own category, amount and notes. Single write — aggregates stay exact.
   */
  splitTransaction: (
    id: string,
    parts: Array<{ amount: number; categoryId: string; notes: string }>
  ) => void;
  /** Set each transaction's category individually (used to undo a rule run) */
  revertCategories: (items: Array<{ id: string; categoryId: string }>) => void;

  // Category tree management
  /** Returns the new node, or null (with a toast) if the name clashes among siblings */
  addNode: (
    name: string,
    parentId: string | null,
    meta?: Partial<Pick<CategoryNode, "oneOff" | "color" | "budget" | "notes">>
  ) => CategoryNode | null;
  renameNode: (id: string, name: string) => boolean;
  /** Re-parent a node (subtree moves with it). Returns false for cycles/clashes. */
  moveNode: (id: string, parentId: string | null) => boolean;
  setNodeMeta: (
    id: string,
    patch: Partial<Pick<CategoryNode, "oneOff" | "color" | "budget" | "notes">>
  ) => void;
  /** Archive/restore a subtree. Archiving disables rules pointing into it. */
  setNodeArchived: (id: string, archived: boolean) => void;
  /**
   * Dissolve a node: children re-parent to its parent, its transactions and
   * rules move to the parent (root nodes: transactions → Uncategorized,
   * rules deleted). Returns how many transactions were re-filed.
   */
  deleteNode: (id: string) => number;

  /** Resolve a category name or full path to a node id (import flows) */
  resolveCategory: (nameOrPath: string) => string | undefined;
  /**
   * Resolve-or-create a batch of names/paths in one write (path segments
   * become nested nodes). Returns name → node id.
   */
  ensureCategories: (nameOrPaths: string[]) => Record<string, string>;

  // Rules
  addRule: (r: Omit<Rule, "id" | "createdAt">) => void;
  updateRule: (id: string, patch: Partial<Rule>) => void;
  deleteRule: (id: string) => void;
  /** Change rule priority: move a rule directly before another (array order = rules.csv order = first-match priority) */
  moveRuleBefore: (id: string, beforeId: string) => void;
  runRules: (options: { overwrite?: boolean }) => { count: number; changes: RuleChange[] };

  // Import profiles
  saveImportProfile: (p: ImportProfile) => void;
  deleteImportProfile: (id: string) => void;

  /** Replace every data file on the server (backup restore / first upload). The server snapshots first. */
  replaceAllData: (
    data: {
      transactions: StoredTransaction[];
      nodes?: CategoryNode[];
      rules?: Rule[];
      importProfiles?: ImportProfile[];
    },
    reason: string
  ) => Promise<void>;
}

const ExpenseContext = createContext<ExpenseContextType | null>(null);

interface Syncs {
  txns: FileSync<StoredTransaction[]>;
  nodes: FileSync<CategoryNode[]>;
  rules: FileSync<Rule[]>;
  profiles: FileSync<ImportProfile[]>;
}

function parseTxnsStrict(text: string): StoredTransaction[] {
  const parsed = csvToTransactions(text);
  if (parsed === null) {
    throw new Error(
      "transactions.csv on the server couldn't be parsed (missing or invalid header row) — keeping the last good copy"
    );
  }
  return parsed;
}

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WorkspaceStatus>("checking");
  const [wsError, setWsError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("saved");
  const [me, setMe] = useState<Actor | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [lastChange, setLastChange] = useState<{ at: number; entry?: ActivityEntry } | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);

  const [stored, setStored] = useState<StoredTransaction[]>([]);
  const [nodes, setNodes] = useState<CategoryNode[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [importProfiles, setImportProfiles] = useState<ImportProfile[]>([]);
  const [settings, setSettings] = useState<Settings>({ yearScope: "all" });

  /**
   * Mutations may only persist once every file is loaded. Guards against a
   * half-booted (or crash-remounted) instance writing its empty in-memory
   * state over good data on the server.
   */
  const canMutateRef = useRef(false);
  const meRef = useRef<Actor | null>(null);

  // ---------- File syncs ----------
  const syncsRef = useRef<Syncs | null>(null);
  if (!syncsRef.current) {
    const all: Array<FileSync<any>> = [];
    const onStatus = () => {
      const offline = all.some((s) => s.offline);
      const busy = all.some((s) => s.hasPending);
      setSyncStatus(offline ? "offline" : busy ? "saving" : "saved");
    };
    const onError = (message: string) => toast.error(message);
    const make = <T,>(
      name: WsFileName,
      parse: (text: string) => T,
      serialize: (data: T) => string,
      onView: (data: T) => void
    ) => {
      const s = new FileSync<T>({
        name, parse, serialize, onView, onStatus, onError,
        put: api.putFile,
        fetch: api.getFile,
      });
      all.push(s);
      return s;
    };
    syncsRef.current = {
      txns: make(WS_FILES.transactions, parseTxnsStrict, serializeTxns, setStored),
      nodes: make(WS_FILES.categories, csvToNodes, nodesToCsv, setNodes),
      rules: make(WS_FILES.rules, csvToRules, rulesToCsv, setRules),
      profiles: make(WS_FILES.profiles, jsonToProfiles, profilesToJson, setImportProfiles),
    };
  }
  const syncs = syncsRef.current;

  const guardMutation = useCallback(() => {
    if (canMutateRef.current) return true;
    console.warn("Mutation ignored — data not fully loaded");
    toast.error("Data isn't loaded yet — change not saved");
    return false;
  }, []);

  const mutateTxns = useCallback(
    (fn: Updater<StoredTransaction[]>) => guardMutation() && syncs.txns.mutate(fn),
    [syncs, guardMutation]
  );
  const mutateNodes = useCallback(
    (fn: Updater<CategoryNode[]>) => guardMutation() && syncs.nodes.mutate(fn),
    [syncs, guardMutation]
  );
  const mutateRules = useCallback(
    (fn: Updater<Rule[]>) => guardMutation() && syncs.rules.mutate(fn),
    [syncs, guardMutation]
  );
  const mutateProfiles = useCallback(
    (fn: Updater<ImportProfile[]>) => guardMutation() && syncs.profiles.mutate(fn),
    [syncs, guardMutation]
  );
  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    void dbSet(KEYS.settings, next);
  }, []);

  const syncFor = useCallback(
    (name: string): FileSync<any> | undefined =>
      ({
        [WS_FILES.transactions]: syncs.txns,
        [WS_FILES.categories]: syncs.nodes,
        [WS_FILES.rules]: syncs.rules,
        [WS_FILES.profiles]: syncs.profiles,
      })[name],
    [syncs]
  );

  // ---------- Boot ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sett = await dbGet<Settings>(KEYS.settings).catch(() => undefined);
      if (sett && !cancelled) setSettings(sett);
      try {
        const ws = await api.getWorkspace();
        if (cancelled) return;
        meRef.current = ws.me;
        setMe(ws.me);
        setDataDir(ws.dataDir);
        syncs.nodes.load(ws.files[WS_FILES.categories]);
        syncs.rules.load(ws.files[WS_FILES.rules]);
        syncs.profiles.load(ws.files[WS_FILES.profiles]);
        syncs.txns.load(ws.files[WS_FILES.transactions]);
        canMutateRef.current = true;
        setWsError(null);
        setWsStatus("connected");
      } catch (e) {
        if (cancelled) return;
        setWsError(
          e instanceof api.ApiError && e.status === 403
            ? e.message
            : e instanceof Error
              ? e.message
              : "Couldn't reach the server"
        );
        setWsStatus("error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncs, connectAttempt]);

  const retryConnect = useCallback(() => {
    setLoading(true);
    setWsStatus("checking");
    setConnectAttempt((n) => n + 1);
  }, []);

  // ---------- Live changes ----------
  useEffect(() => {
    if (wsStatus !== "connected") return;
    let opened = false;
    const all = [syncs.txns, syncs.nodes, syncs.rules, syncs.profiles];
    return api.subscribeChanges(
      (ev) => {
        for (const [name, rev] of Object.entries(ev.files)) {
          if (rev) syncFor(name)?.remoteChanged(rev);
        }
        setLastChange({ at: Date.now(), entry: ev.entry });
        const entry = ev.entry;
        const mine = entry && entry.actor.login === meRef.current?.login && entry.source === "app";
        if (entry && !mine && entry.source !== "system") {
          toast.info(`${entry.actor.name}: ${entry.summary}`);
        }
      },
      () => {
        // (Re)connected: catch up on anything missed while the stream was down
        if (opened) for (const s of all) void s.refetch();
        opened = true;
        for (const s of all) s.retryNow();
      },
      () => {}
    );
  }, [wsStatus, syncs, syncFor]);

  // Warn before closing the tab with unsaved edits
  useEffect(() => {
    if (syncStatus === "saved") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [syncStatus]);

  const reloadFromServer = useCallback(async () => {
    try {
      const ws = await api.getWorkspace();
      for (const [name, state] of Object.entries(ws.files)) {
        const s = syncFor(name);
        if (s && !s.hasPending) s.load(state);
      }
      toast.success("Reloaded from the server");
    } catch {
      toast.error("Couldn't reach the server");
    }
  }, [syncFor]);

  // ---------- Category tree lookups ----------
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const nameOf = useCallback((id: string) => tree.byId.get(id)?.name ?? id, [tree]);
  const pathOf = useCallback((id: string) => tree.pathOf(id), [tree]);

  const colorOf = useCallback(
    (id: string) => {
      const node = tree.byId.get(id);
      if (node?.color) return node.color;
      const root = tree.rootOf(id);
      if (root?.color) return root.color;
      return groupColor(root?.name ?? id);
    },
    [tree]
  );

  // ---------- Runtime + scoped views ----------
  const allTransactions = useMemo(() => {
    const list = stored.map((t): Transaction => {
      const [y, m, d] = t.date.split("-").map(Number);
      return {
        ...t,
        date: new Date(y, m - 1, d),
        dateStr: t.date,
        account: t.account ?? "",
        category: nameOf(t.categoryId),
        path: tree.pathOf(t.categoryId),
        group: tree.rootOf(t.categoryId)?.name ?? t.categoryId,
      };
    });
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    return list;
  }, [stored, tree, nameOf]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const t of allTransactions) years.add(String(t.date.getFullYear()));
    return Array.from(years).sort();
  }, [allTransactions]);

  const yearScope = settings.yearScope || "all";
  const parsedScope = parseScope(yearScope);
  const effectiveScope =
    parsedScope.kind === "year" &&
    !availableYears.includes(parsedScope.year) &&
    availableYears.length > 0
      ? "all"
      : yearScope;
  const scope = useMemo(() => parseScope(effectiveScope), [effectiveScope]);

  const transactions = useMemo(() => {
    if (scope.kind === "all") return allTransactions;
    return allTransactions.filter((t) => scopeContains(scope, t.dateStr));
  }, [allTransactions, scope]);

  const scopeLabel = useMemo(() => scopeLabelOf(scope), [scope]);

  const setYearScope = useCallback(
    (scope: string) => persistSettings({ ...settings, yearScope: scope }),
    [settings, persistSettings]
  );

  const hideOneOffs = !!settings.hideOneOffs;
  const setHideOneOffs = useCallback(
    (hide: boolean) => persistSettings({ ...settings, hideOneOffs: hide }),
    [settings, persistSettings]
  );

  const hasOneOffSpend = useMemo(
    () => transactions.some((t) => tree.isOneOff(t.categoryId)),
    [transactions, tree]
  );

  /** Overview analytics exclude one-off subtrees when the toggle is on */
  const analysisTransactions = useMemo(
    () => (hideOneOffs ? transactions.filter((t) => !tree.isOneOff(t.categoryId)) : transactions),
    [transactions, tree, hideOneOffs]
  );

  // ---------- Derived analytics (scoped) ----------
  // Month labels carry the year whenever the scoped data spans more than one
  const multiYear = useMemo(
    () => new Set(transactions.map((t) => t.date.getFullYear())).size > 1,
    [transactions]
  );

  const totalSpend = useMemo(
    () => analysisTransactions.reduce((sum, t) => sum + t.amount, 0),
    [analysisTransactions]
  );

  const monthlyData = useMemo(() => {
    const map = new Map<string, MonthlyData>();
    for (const t of analysisTransactions) {
      const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) {
        const base = MONTH_LABELS[t.date.getMonth()];
        map.set(key, {
          month: key,
          label: multiYear ? `${base} ${String(t.date.getFullYear()).slice(2)}` : base,
          total: 0,
          count: 0,
          categories: {},
          groups: {},
        });
      }
      const m = map.get(key)!;
      m.total += t.amount;
      m.count += 1;
      m.categories[t.categoryId] = (m.categories[t.categoryId] || 0) + t.amount;
      m.groups[t.group] = (m.groups[t.group] || 0) + t.amount;
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [analysisTransactions, multiYear]);

  /** Per-node rollup over a transaction list */
  const statsOver = useCallback(
    (txns: Transaction[]): Map<string, NodeStats> => {
      const map = new Map<string, NodeStats>();
      const ensure = (id: string): NodeStats => {
        let s = map.get(id);
        if (!s) {
          const n = tree.byId.get(id);
          s = {
            id,
            name: n?.name ?? id,
            path: tree.pathOf(id),
            depth: tree.depthOf(id),
            parentId: n?.parentId && tree.byId.has(n.parentId) ? n.parentId : null,
            direct: 0,
            directCount: 0,
            total: 0,
            count: 0,
          };
          map.set(id, s);
        }
        return s;
      };
      for (const t of txns) {
        const self = ensure(t.categoryId);
        self.direct += t.amount;
        self.directCount += 1;
        // roll up through the ancestor chain (self included)
        let cur: string | null = t.categoryId;
        const seen = new Set<string>();
        while (cur !== null && !seen.has(cur)) {
          seen.add(cur);
          const s = ensure(cur);
          s.total += t.amount;
          s.count += 1;
          const n = tree.byId.get(cur);
          cur = n?.parentId && tree.byId.has(n.parentId) ? n.parentId : null;
        }
      }
      return map;
    },
    [tree]
  );

  /** All-nodes aggregates for the drill-down view (not filtered by hideOneOffs) */
  const nodeStats = useMemo(() => statsOver(transactions), [transactions, statsOver]);

  /** Same rollup with one-off subtrees dropped when the toggle is on */
  const analysisNodeStats = useMemo(
    () => (hideOneOffs ? statsOver(analysisTransactions) : nodeStats),
    [hideOneOffs, statsOver, analysisTransactions, nodeStats]
  );

  /** Root buckets for the overview charts (respects hideOneOffs) */
  const groupData = useMemo(() => {
    const roots = (tree.children.get(null) ?? [])
      .map((n) => analysisNodeStats.get(n.id))
      .filter((s): s is NodeStats => !!s && s.count > 0);
    return roots.sort((a, b) => b.total - a.total);
  }, [tree, analysisNodeStats]);

  const groups = useMemo(() => groupData.map((g) => g.name), [groupData]);

  const groupColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of tree.children.get(null) ?? []) {
      map[n.name] = n.color ?? groupColor(n.name);
    }
    return map;
  }, [tree]);

  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions) if (t.account) set.add(t.account);
    return Array.from(set).sort();
  }, [allTransactions]);

  const accountCoverage = useMemo(() => {
    const map = new Map<string, AccountCoverage>();
    for (const t of stored) {
      const key = t.account;
      if (!key) continue;
      const c = map.get(key);
      if (!c) map.set(key, { account: key, from: t.date, to: t.date, count: 1 });
      else {
        if (t.date < c.from) c.from = t.date;
        if (t.date > c.to) c.to = t.date;
        c.count++;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.account.localeCompare(b.account));
  }, [stored]);

  const avgMonthlySpend = useMemo(
    () => (monthlyData.length > 0 ? totalSpend / monthlyData.length : 0),
    [totalSpend, monthlyData]
  );

  // ---------- Transaction actions ----------
  // Every mutation goes through an updater applied to the latest copy, so it
  // can be replayed if someone else changed the file first. Values a caller
  // needs back (counts, new ids) are computed from the current local view.

  /** Register unknown category ids as root nodes so no transaction points nowhere */
  const registerUnknownIds = useCallback(
    (txns: StoredTransaction[]) => {
      const known = new Set(syncs.nodes.view.map((n) => n.id));
      const missing = new Set<string>();
      for (const t of txns) if (t.categoryId && !known.has(t.categoryId)) missing.add(t.categoryId);
      if (missing.size === 0) return;
      mutateNodes((prev) => {
        const have = new Set(prev.map((n) => n.id));
        const add = Array.from(missing).filter((id) => !have.has(id));
        return add.length ? [...prev, ...add.map((id) => ({ id, parentId: null, name: id }))] : prev;
      });
    },
    [syncs, mutateNodes]
  );

  const addTransactions = useCallback(
    (txns: StoredTransaction[]) => {
      const normalized = txns.map((t) => ({
        ...t,
        categoryId: t.categoryId || UNCATEGORIZED_ID,
      }));
      registerUnknownIds(normalized);
      const ids = new Set(normalized.map((t) => t.id));
      // replay-safe: never add the same id twice
      mutateTxns((prev) => [...prev.filter((t) => !ids.has(t.id)), ...normalized]);
    },
    [registerUnknownIds, mutateTxns]
  );

  const updateTransactions = useCallback(
    (ids: string[], changes: TransactionChanges) => {
      const idSet = new Set(ids);
      mutateTxns((prev) =>
        prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          return {
            ...t,
            categoryId: changes.categoryId ?? t.categoryId,
            account: changes.account ?? t.account,
            notes: changes.notes ?? t.notes,
            description: changes.description ?? t.description,
            date: changes.date ?? t.date,
            amount: changes.amount ?? t.amount,
          };
        })
      );
    },
    [mutateTxns]
  );

  const deleteTransactions = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      mutateTxns((prev) => prev.filter((t) => !idSet.has(t.id)));
    },
    [mutateTxns]
  );

  const splitTransaction = useCallback(
    (id: string, parts: Array<{ amount: number; categoryId: string; notes: string }>) => {
      if (parts.length < 2) return;
      const base = uid();
      mutateTxns((prev) => {
        const parent = prev.find((t) => t.id === id);
        if (!parent) return prev;
        const rows: StoredTransaction[] = parts.map((p, i) => ({
          id: base + i.toString(36),
          date: parent.date,
          description: parent.description,
          amount: p.amount,
          categoryId: p.categoryId || UNCATEGORIZED_ID,
          account: parent.account,
          notes: p.notes,
        }));
        return prev.flatMap((t) => (t.id === id ? rows : [t]));
      });
    },
    [mutateTxns]
  );

  const revertCategories = useCallback(
    (items: Array<{ id: string; categoryId: string }>) => {
      const byId = new Map(items.map((i) => [i.id, i.categoryId]));
      mutateTxns((prev) =>
        prev.map((t) => {
          const cat = byId.get(t.id);
          if (cat === undefined || cat === t.categoryId) return t;
          return { ...t, categoryId: cat };
        })
      );
    },
    [mutateTxns]
  );

  // ---------- Category tree management ----------
  const addNode = useCallback(
    (
      name: string,
      parentId: string | null,
      meta?: Partial<Pick<CategoryNode, "oneOff" | "color" | "budget" | "notes">>
    ): CategoryNode | null => {
      const err = validateName(tree, name, parentId);
      if (err) {
        toast.error(err);
        return null;
      }
      const node: CategoryNode = {
        id: slugForName(name.trim(), tree.byId.keys()),
        parentId,
        name: name.trim(),
        ...meta,
        createdAt: new Date().toISOString(),
      };
      mutateNodes((prev) => (prev.some((n) => n.id === node.id) ? prev : [...prev, node]));
      return node;
    },
    [tree, mutateNodes]
  );

  const renameNode = useCallback(
    (id: string, name: string): boolean => {
      const node = tree.byId.get(id);
      if (!node) return false;
      const err = validateName(tree, name, node.parentId, id);
      if (err) {
        toast.error(err);
        return false;
      }
      mutateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, name: name.trim() } : n)));
      return true;
    },
    [tree, mutateNodes]
  );

  const moveNode = useCallback(
    (id: string, parentId: string | null): boolean => {
      const node = tree.byId.get(id);
      if (!node) return false;
      if (parentId !== null && tree.subtreeIds(id).has(parentId)) {
        toast.error("Can't move a category into its own subtree");
        return false;
      }
      const err = validateName(tree, node.name, parentId, id);
      if (err) {
        toast.error(err);
        return false;
      }
      mutateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, parentId } : n)));
      return true;
    },
    [tree, mutateNodes]
  );

  const setNodeMeta = useCallback(
    (
      id: string,
      patch: Partial<Pick<CategoryNode, "oneOff" | "color" | "budget" | "notes">>
    ) => {
      mutateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    },
    [mutateNodes]
  );

  const setNodeArchived = useCallback(
    (id: string, archived: boolean) => {
      const node = tree.byId.get(id);
      if (!node) return;
      mutateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, archived } : n)));

      // Archiving retires the subtree's rules so future imports can't file
      // new spending into it. Restoring does NOT auto-re-enable them.
      if (archived) {
        const subtree = tree.subtreeIds(id);
        const affected = syncs.rules.view.filter((r) => r.enabled && subtree.has(r.categoryId));
        if (affected.length > 0) {
          mutateRules((prev) =>
            prev.map((r) => (r.enabled && subtree.has(r.categoryId) ? { ...r, enabled: false } : r))
          );
          toast.info(
            `Disabled ${affected.length} auto-categorisation rule${affected.length === 1 ? "" : "s"} pointing at "${node.name}"`
          );
        }
      }
    },
    [tree, syncs, mutateNodes, mutateRules]
  );

  const deleteNode = useCallback(
    (id: string): number => {
      const node = tree.byId.get(id);
      if (!node || id === UNCATEGORIZED_ID) return 0;
      const parentId = node.parentId && tree.byId.has(node.parentId) ? node.parentId : null;
      const txnTarget = parentId ?? UNCATEGORIZED_ID;
      const count = syncs.txns.view.filter((t) => t.categoryId === id).length;
      mutateTxns((prev) => prev.map((t) => (t.categoryId === id ? { ...t, categoryId: txnTarget } : t)));
      mutateNodes((prev) =>
        prev.filter((n) => n.id !== id).map((n) => (n.parentId === id ? { ...n, parentId } : n))
      );
      if (parentId) {
        mutateRules((prev) => prev.map((r) => (r.categoryId === id ? { ...r, categoryId: parentId } : r)));
      } else {
        mutateRules((prev) => prev.filter((r) => r.categoryId !== id));
      }
      return count;
    },
    [tree, syncs, mutateTxns, mutateNodes, mutateRules]
  );

  // ---------- Category resolution (import flows) ----------
  const resolveCategory = useCallback(
    (nameOrPath: string): string | undefined => resolveCategoryIn(tree, nameOrPath),
    [tree]
  );

  const ensureCategories = useCallback(
    (nameOrPaths: string[]): Record<string, string> => {
      const { ids, created } = ensurePaths(syncs.nodes.view, nameOrPaths);
      if (created.length > 0) {
        mutateNodes((prev) => {
          const have = new Set(prev.map((n) => n.id));
          return [...prev, ...created.filter((n) => !have.has(n.id))];
        });
      }
      return ids;
    },
    [syncs, mutateNodes]
  );

  // ---------- Rules ----------
  const addRule = useCallback(
    (r: Omit<Rule, "id" | "createdAt">) => {
      const rule = { ...r, id: uid(), createdAt: new Date().toISOString() };
      mutateRules((prev) => [...prev, rule]);
    },
    [mutateRules]
  );

  const updateRule = useCallback(
    (id: string, patch: Partial<Rule>) => {
      mutateRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [mutateRules]
  );

  const deleteRule = useCallback(
    (id: string) => mutateRules((prev) => prev.filter((r) => r.id !== id)),
    [mutateRules]
  );

  const moveRuleBefore = useCallback(
    (id: string, beforeId: string) => {
      if (id === beforeId) return;
      mutateRules((prev) => {
        const rule = prev.find((r) => r.id === id);
        if (!rule) return prev;
        const rest = prev.filter((r) => r.id !== id);
        const at = rest.findIndex((r) => r.id === beforeId);
        if (at < 0) return prev;
        return [...rest.slice(0, at), rule, ...rest.slice(at)];
      });
    },
    [mutateRules]
  );

  const runRules = useCallback(
    (options: { overwrite?: boolean }) => {
      const { count, changes } = applyRules(
        syncs.txns.view,
        syncs.rules.view,
        (id) => tree.byId.has(id),
        options
      );
      if (count > 0) {
        const target = new Map(changes.map((c) => [c.id, c.toCategoryId]));
        mutateTxns((prev) =>
          prev.map((t) => (target.has(t.id) ? { ...t, categoryId: target.get(t.id)! } : t))
        );
      }
      return { count, changes };
    },
    [syncs, tree, mutateTxns]
  );

  // ---------- Import profiles ----------
  const saveImportProfile = useCallback(
    (p: ImportProfile) => {
      mutateProfiles((prev) =>
        prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]
      );
    },
    [mutateProfiles]
  );

  const deleteImportProfile = useCallback(
    (id: string) => mutateProfiles((prev) => prev.filter((p) => p.id !== id)),
    [mutateProfiles]
  );

  // ---------- Restore / upload ----------
  const replaceAllData = useCallback(
    async (
      data: {
        transactions: StoredTransaction[];
        nodes?: CategoryNode[];
        rules?: Rule[];
        importProfiles?: ImportProfile[];
      },
      reason: string
    ) => {
      const norm = normalizeLoaded(data.transactions, data.nodes ?? []);
      const texts = serializeWorkspace({
        transactions: norm.txns,
        nodes: norm.nodes,
        rules: data.rules ?? [],
        importProfiles: data.importProfiles ?? [],
      });
      await api.replaceWorkspace(texts, reason);
      const ws = await api.getWorkspace();
      for (const [name, state] of Object.entries(ws.files)) syncFor(name)?.replace(state);
    },
    [syncFor]
  );

  const value: ExpenseContextType = {
    loading,
    error,
    workspaceStatus: wsStatus,
    workspaceError: wsError,
    syncStatus,
    me,
    dataDir,
    reloadFromServer,
    retryConnect,
    lastChange,
    transactions,
    allTransactions,
    storedTransactions: stored,
    nodes,
    tree,
    nameOf,
    pathOf,
    colorOf,
    rules,
    importProfiles,
    yearScope: effectiveScope,
    setYearScope,
    availableYears,
    scopeLabel,
    hideOneOffs,
    setHideOneOffs,
    hasOneOffSpend,
    totalSpend,
    monthlyData,
    groupData,
    groups,
    avgMonthlySpend,
    groupColors,
    nodeStats,
    analysisTransactions,
    analysisNodeStats,
    accounts,
    accountCoverage,
    addTransactions,
    updateTransactions,
    deleteTransactions,
    splitTransaction,
    revertCategories,
    addNode,
    renameNode,
    moveNode,
    setNodeMeta,
    setNodeArchived,
    deleteNode,
    resolveCategory,
    ensureCategories,
    addRule,
    updateRule,
    deleteRule,
    moveRuleBefore,
    runRules,
    saveImportProfile,
    deleteImportProfile,
    replaceAllData,
  };

  return <ExpenseContext.Provider value={value}>{children}</ExpenseContext.Provider>;
}

export function useExpenses() {
  const ctx = useContext(ExpenseContext);
  if (!ctx) throw new Error("useExpenses must be used within ExpenseProvider");
  return ctx;
}
