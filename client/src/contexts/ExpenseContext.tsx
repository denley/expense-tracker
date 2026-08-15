/*
  Central data store — file-first.
  The source of truth is a folder on the user's disk (File System Access API):
  transactions.csv / categories.csv / rules.csv / import-profiles.json.
  - Every mutation writes the affected file immediately (per-file write queue)
  - External edits (AI agents, Excel) are picked up via mtime checks on focus
    and a slow interval
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
import { MONTH_LABELS, groupColor } from "@/lib/types";
import {
  buildTree,
  makeUncategorizedNode,
  slugForName,
  validateName,
  UNCATEGORIZED_ID,
  PATH_SEP,
  type CategoryTree,
} from "@/lib/tree";
import { dbGet, dbSet, KEYS, uid } from "@/lib/db";
import { transactionsToCsv } from "@/lib/export";
import {
  WS_FILES,
  supportsFileSystem,
  pickWorkspaceFolder,
  saveWorkspaceHandle,
  loadWorkspaceHandle,
  clearWorkspaceHandle,
  queryPermission,
  requestPermission,
  readWorkspace,
  writeWorkspaceFile,
  writeWorkspaceFileIfAbsent,
  getWorkspaceFileMtime,
  ensureWorkspaceReadme,
  nodesToCsv,
  rulesToCsv,
  type WorkspaceData,
} from "@/lib/workspace";
import { applyRules, type RuleChange } from "@/lib/rules";
import { parseScope, scopeContains, scopeLabelOf } from "@/lib/scope";
import { toast } from "sonner";

export type WorkspaceStatus =
  | "checking" // booting, don't render anything yet
  | "unsupported" // browser lacks the File System Access API
  | "none" // no folder connected yet
  | "prompt" // folder known but needs a permission click
  | "connected"
  | "error";

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

  // Workspace
  workspaceStatus: WorkspaceStatus;
  workspaceName: string;
  workspaceError: string | null;
  chooseWorkspaceFolder: () => Promise<void>;
  reconnectWorkspace: () => Promise<void>;
  disconnectWorkspace: () => Promise<void>;
  reloadFromDisk: () => Promise<void>;

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
  runRules: (options: { overwrite?: boolean }) => { count: number; changes: RuleChange[] };

  // Import profiles
  saveImportProfile: (p: ImportProfile) => void;
  deleteImportProfile: (id: string) => void;

  // Backup restore (writes into the workspace)
  replaceAllData: (data: {
    transactions: StoredTransaction[];
    nodes?: CategoryNode[];
    rules?: Rule[];
    importProfiles?: ImportProfile[];
  }) => void;
}

const ExpenseContext = createContext<ExpenseContextType | null>(null);

function serializeTxns(txns: StoredTransaction[]): string {
  const sorted = [...txns].sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id))
  );
  return transactionsToCsv(sorted) + "\n";
}

/**
 * Ensure loaded data is coherent: the Uncategorized root exists and every
 * transaction's categoryId points at a real node. Unknown ids (e.g. an agent
 * referenced a node it forgot to add) are auto-registered as root nodes named
 * after the id so no data is lost — visible and fixable in the app.
 */
function normalizeLoaded(
  txns: StoredTransaction[],
  nodes: CategoryNode[]
): { txns: StoredTransaction[]; nodes: CategoryNode[]; txnsChanged: boolean; nodesChanged: boolean } {
  const nextNodes = [...nodes];
  let nodesChanged = false;
  if (!nextNodes.some((n) => n.id === UNCATEGORIZED_ID)) {
    nextNodes.push(makeUncategorizedNode());
    nodesChanged = true;
  }
  const known = new Set(nextNodes.map((n) => n.id));
  let txnsChanged = false;
  const nextTxns = txns.map((t) => {
    const cat = t.categoryId || UNCATEGORIZED_ID;
    if (!known.has(cat)) {
      nextNodes.push({ id: cat, parentId: null, name: cat });
      known.add(cat);
      nodesChanged = true;
    }
    if (t.categoryId !== cat) {
      txnsChanged = true;
      return { ...t, categoryId: cat };
    }
    return t;
  });
  return { txns: nextTxns, nodes: nextNodes, txnsChanged, nodesChanged };
}

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WorkspaceStatus>("checking");
  const [wsName, setWsName] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);

  const [stored, setStored] = useState<StoredTransaction[]>([]);
  const [nodes, setNodes] = useState<CategoryNode[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [importProfiles, setImportProfiles] = useState<ImportProfile[]>([]);
  const [settings, setSettings] = useState<Settings>({ yearScope: "all" });

  const dirRef = useRef<FileSystemDirectoryHandle | null>(null);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  /**
   * Mutations may only persist once the workspace is fully loaded. Guards
   * against a half-booted (or crash-remounted) instance writing its empty
   * in-memory state over a good file on disk.
   */
  const canMutateRef = useRef(false);
  const mtimesRef = useRef<Record<string, number>>({});
  const writeQueue = useRef<Record<string, Promise<void>>>({});
  const checkingRef = useRef(false);

  // ---------- Write scheduling (per-file queue, immediate) ----------
  const scheduleWrite = useCallback((fileName: string, content: string) => {
    const dir = dirRef.current;
    if (!dir) return;
    const prev = writeQueue.current[fileName] ?? Promise.resolve();
    writeQueue.current[fileName] = prev
      .then(() => writeWorkspaceFile(dir, fileName, content))
      .then((mtime) => {
        mtimesRef.current[fileName] = mtime;
      })
      .catch((e) => {
        console.error(`Failed to write ${fileName}`, e);
        toast.error(`Failed to write ${fileName} — check folder permissions`);
      });
  }, []);

  const guardMutation = useCallback(() => {
    if (canMutateRef.current) return true;
    console.warn("Mutation ignored — workspace not fully loaded");
    toast.error("Data folder isn't loaded yet — change not saved");
    return false;
  }, []);

  const persistTxns = useCallback(
    (next: StoredTransaction[]) => {
      if (!guardMutation()) return;
      setStored(next);
      scheduleWrite(WS_FILES.transactions, serializeTxns(next));
    },
    [scheduleWrite, guardMutation]
  );
  const persistNodes = useCallback(
    (next: CategoryNode[]) => {
      if (!guardMutation()) return;
      setNodes(next);
      scheduleWrite(WS_FILES.categories, nodesToCsv(next));
    },
    [scheduleWrite, guardMutation]
  );
  const persistRules = useCallback(
    (next: Rule[]) => {
      if (!guardMutation()) return;
      setRules(next);
      scheduleWrite(WS_FILES.rules, rulesToCsv(next));
    },
    [scheduleWrite, guardMutation]
  );
  const persistProfiles = useCallback(
    (next: ImportProfile[]) => {
      if (!guardMutation()) return;
      setImportProfiles(next);
      scheduleWrite(WS_FILES.profiles, JSON.stringify(next, null, 2) + "\n");
    },
    [scheduleWrite, guardMutation]
  );
  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    void dbSet(KEYS.settings, next);
  }, []);

  // ---------- Loading workspace contents into state ----------
  const applyLoaded = useCallback(
    (data: WorkspaceData, mtimes: Record<string, number>) => {
      const norm = normalizeLoaded(data.transactions, data.nodes);
      mtimesRef.current = { ...mtimesRef.current, ...mtimes };
      setStored(norm.txns);
      setNodes(norm.nodes);
      setRules(data.rules);
      setImportProfiles(data.importProfiles);
      // Write back normalisation fixes so the files stay consistent
      if (norm.txnsChanged) scheduleWrite(WS_FILES.transactions, serializeTxns(norm.txns));
      if (norm.nodesChanged || data.nodes.length === 0) {
        scheduleWrite(WS_FILES.categories, nodesToCsv(norm.nodes));
      }
    },
    [scheduleWrite]
  );

  const connectingRef = useRef(false);

  const connectDir = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      if (connectingRef.current) return;
      connectingRef.current = true;
      try {
        const { data, mtimes } = await readWorkspace(dir);

        // A present-but-unparseable transactions.csv must never load as
        // "zero transactions" — a later write would wipe the real contents.
        if (data.transactionsUnreadable) {
          handleRef.current = dir;
          setWsName(dir.name);
          setWsError(
            "transactions.csv exists but couldn't be parsed (missing or invalid header row). " +
              "Not loading it, to avoid overwriting its contents. Fix or remove the file, then reconnect."
          );
          setWsStatus("error");
          setLoading(false);
          return;
        }

        dirRef.current = dir;

        if (!data.hasTransactionsFile) {
          // No transactions.csv — initialize an empty workspace. Only ever
          // CREATE files here, never overwrite: a folder with sidecar files
          // but no transactions.csv must keep them.
          mtimes[WS_FILES.transactions] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.transactions, serializeTxns([]));
          mtimes[WS_FILES.categories] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.categories, nodesToCsv([makeUncategorizedNode()]));
          mtimes[WS_FILES.rules] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.rules, rulesToCsv([]));
          mtimes[WS_FILES.profiles] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.profiles, "[]\n");
          await ensureWorkspaceReadme(dir);
          // Re-read so pre-existing sidecar files win over the seed
          const reread = await readWorkspace(dir);
          applyLoaded(reread.data, reread.mtimes);
        } else {
          await ensureWorkspaceReadme(dir);
          applyLoaded(data, mtimes);
        }

        handleRef.current = dir;
        await saveWorkspaceHandle(dir);
        setWsName(dir.name);
        setWsError(null);
        setWsStatus("connected");
        canMutateRef.current = true;
        setLoading(false);
      } catch (e) {
        setWsError(e instanceof Error ? e.message : "Failed to read the data folder");
        setWsStatus("error");
        setLoading(false);
      } finally {
        connectingRef.current = false;
      }
    },
    [applyLoaded]
  );

  // ---------- Boot ----------
  useEffect(() => {
    (async () => {
      const sett = await dbGet<Settings>(KEYS.settings);
      if (sett) setSettings(sett);

      if (!supportsFileSystem()) {
        setWsStatus("unsupported");
        setLoading(false);
        return;
      }

      const handle = await loadWorkspaceHandle();
      if (!handle) {
        setWsStatus("none");
        setLoading(false);
        return;
      }
      handleRef.current = handle;
      setWsName(handle.name);
      const perm = await queryPermission(handle);
      if (perm === "granted") {
        await connectDir(handle);
      } else {
        setWsStatus("prompt");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Workspace actions ----------
  const chooseWorkspaceFolder = useCallback(async () => {
    try {
      const dir = await pickWorkspaceFolder();
      setLoading(true);
      await connectDir(dir);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        toast.error("Couldn't open that folder");
      }
    }
  }, [connectDir]);

  const reconnectWorkspace = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    const perm = await requestPermission(handle);
    if (perm === "granted") {
      setLoading(true);
      await connectDir(handle);
    } else {
      toast.error("Folder access was denied");
    }
  }, [connectDir]);

  const disconnectWorkspace = useCallback(async () => {
    await clearWorkspaceHandle();
    canMutateRef.current = false;
    dirRef.current = null;
    handleRef.current = null;
    mtimesRef.current = {};
    setStored([]);
    setNodes([]);
    setRules([]);
    setImportProfiles([]);
    setWsName("");
    setWsStatus("none");
  }, []);

  // ---------- External change detection ----------
  const checkExternal = useCallback(
    async (force = false) => {
      const dir = dirRef.current;
      if (!dir || checkingRef.current) return;
      checkingRef.current = true;
      try {
        let changed = force;
        if (!force) {
          for (const name of Object.values(WS_FILES)) {
            const m = await getWorkspaceFileMtime(dir, name);
            if (m !== null && m > (mtimesRef.current[name] ?? 0)) {
              changed = true;
              break;
            }
          }
        }
        if (changed) {
          const { data, mtimes } = await readWorkspace(dir);
          if (data.transactionsUnreadable) {
            // Remember the mtimes so this doesn't re-toast every poll
            mtimesRef.current = { ...mtimesRef.current, ...mtimes };
            toast.error(
              "transactions.csv changed on disk but couldn't be parsed — keeping the current data"
            );
            return;
          }
          applyLoaded(data, mtimes);
          if (!force) toast.info("Data files changed on disk — reloaded");
        }
      } catch (e) {
        console.error("Reload from disk failed", e);
      } finally {
        checkingRef.current = false;
      }
    },
    [applyLoaded]
  );

  useEffect(() => {
    if (wsStatus !== "connected") return;
    const onFocus = () => void checkExternal();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void checkExternal();
    }, 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [wsStatus, checkExternal]);

  const reloadFromDisk = useCallback(async () => {
    await checkExternal(true);
    toast.success("Reloaded from disk");
  }, [checkExternal]);

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

  const avgMonthlySpend = useMemo(
    () => (monthlyData.length > 0 ? totalSpend / monthlyData.length : 0),
    [totalSpend, monthlyData]
  );

  // ---------- Transaction actions ----------
  const registerUnknownIds = useCallback(
    (txns: StoredTransaction[]): CategoryNode[] | null => {
      const missing = new Set<string>();
      for (const t of txns) {
        if (t.categoryId && !tree.byId.has(t.categoryId)) missing.add(t.categoryId);
      }
      if (missing.size === 0) return null;
      return [
        ...nodes,
        ...Array.from(missing).map((id) => ({ id, parentId: null, name: id })),
      ];
    },
    [tree, nodes]
  );

  const addTransactions = useCallback(
    (txns: StoredTransaction[]) => {
      const normalized = txns.map((t) => ({
        ...t,
        categoryId: t.categoryId || UNCATEGORIZED_ID,
      }));
      const withNew = registerUnknownIds(normalized);
      if (withNew) persistNodes(withNew);
      persistTxns([...stored, ...normalized]);
    },
    [stored, registerUnknownIds, persistTxns, persistNodes]
  );

  const updateTransactions = useCallback(
    (ids: string[], changes: TransactionChanges) => {
      const idSet = new Set(ids);
      const next = stored.map((t) => {
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
      });
      persistTxns(next);
    },
    [stored, persistTxns]
  );

  const deleteTransactions = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      persistTxns(stored.filter((t) => !idSet.has(t.id)));
    },
    [stored, persistTxns]
  );

  const splitTransaction = useCallback(
    (id: string, parts: Array<{ amount: number; categoryId: string; notes: string }>) => {
      const parent = stored.find((t) => t.id === id);
      if (!parent || parts.length < 2) return;
      const base = uid();
      const rows: StoredTransaction[] = parts.map((p, i) => ({
        id: base + i.toString(36),
        date: parent.date,
        description: parent.description,
        amount: p.amount,
        categoryId: p.categoryId || UNCATEGORIZED_ID,
        account: parent.account,
        notes: p.notes,
      }));
      persistTxns(stored.flatMap((t) => (t.id === id ? rows : [t])));
    },
    [stored, persistTxns]
  );

  const revertCategories = useCallback(
    (items: Array<{ id: string; categoryId: string }>) => {
      const byId = new Map(items.map((i) => [i.id, i.categoryId]));
      persistTxns(
        stored.map((t) => {
          const cat = byId.get(t.id);
          if (cat === undefined || cat === t.categoryId) return t;
          return { ...t, categoryId: cat };
        })
      );
    },
    [stored, persistTxns]
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
      persistNodes([...nodes, node]);
      return node;
    },
    [tree, nodes, persistNodes]
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
      persistNodes(nodes.map((n) => (n.id === id ? { ...n, name: name.trim() } : n)));
      return true;
    },
    [tree, nodes, persistNodes]
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
      persistNodes(nodes.map((n) => (n.id === id ? { ...n, parentId } : n)));
      return true;
    },
    [tree, nodes, persistNodes]
  );

  const setNodeMeta = useCallback(
    (
      id: string,
      patch: Partial<Pick<CategoryNode, "oneOff" | "color" | "budget" | "notes">>
    ) => {
      persistNodes(nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    },
    [nodes, persistNodes]
  );

  const setNodeArchived = useCallback(
    (id: string, archived: boolean) => {
      const node = tree.byId.get(id);
      if (!node) return;
      persistNodes(nodes.map((n) => (n.id === id ? { ...n, archived } : n)));

      // Archiving retires the subtree's rules so future imports can't file
      // new spending into it. Restoring does NOT auto-re-enable them.
      if (archived) {
        const subtree = tree.subtreeIds(id);
        const affected = rules.filter((r) => r.enabled && subtree.has(r.categoryId));
        if (affected.length > 0) {
          persistRules(
            rules.map((r) =>
              r.enabled && subtree.has(r.categoryId) ? { ...r, enabled: false } : r
            )
          );
          toast.info(
            `Disabled ${affected.length} auto-categorisation rule${affected.length === 1 ? "" : "s"} pointing at "${node.name}"`
          );
        }
      }
    },
    [tree, nodes, rules, persistNodes, persistRules]
  );

  const deleteNode = useCallback(
    (id: string): number => {
      const node = tree.byId.get(id);
      if (!node || id === UNCATEGORIZED_ID) return 0;
      const parentId = node.parentId && tree.byId.has(node.parentId) ? node.parentId : null;
      const txnTarget = parentId ?? UNCATEGORIZED_ID;
      let count = 0;
      persistTxns(
        stored.map((t) => {
          if (t.categoryId !== id) return t;
          count++;
          return { ...t, categoryId: txnTarget };
        })
      );
      persistNodes(
        nodes
          .filter((n) => n.id !== id)
          .map((n) => (n.parentId === id ? { ...n, parentId } : n))
      );
      if (parentId) {
        persistRules(rules.map((r) => (r.categoryId === id ? { ...r, categoryId: parentId } : r)));
      } else {
        persistRules(rules.filter((r) => r.categoryId !== id));
      }
      return count;
    },
    [tree, stored, nodes, rules, persistTxns, persistNodes, persistRules]
  );

  // ---------- Category resolution (import flows) ----------
  const resolveCategory = useCallback(
    (nameOrPath: string): string | undefined => {
      const needle = nameOrPath.trim().toLowerCase();
      if (!needle) return undefined;
      // Exact path match first
      for (const n of tree.nodes) {
        if (tree.pathOf(n.id).toLowerCase() === needle) return n.id;
      }
      // Unique name match (prefer non-archived)
      const byName = tree.nodes.filter((n) => n.name.toLowerCase() === needle);
      const active = byName.filter((n) => !tree.isArchived(n.id));
      const pool = active.length > 0 ? active : byName;
      return pool.length === 1 ? pool[0].id : undefined;
    },
    [tree]
  );

  const ensureCategories = useCallback(
    (nameOrPaths: string[]): Record<string, string> => {
      const result: Record<string, string> = {};
      const nextNodes = [...nodes];
      let cur: CategoryTree = buildTree(nextNodes);
      for (const nameOrPath of nameOrPaths) {
        const existing = resolveCategory(nameOrPath);
        if (existing) {
          result[nameOrPath] = existing;
          continue;
        }
        // Create the path chain segment by segment
        const segments = nameOrPath.split(PATH_SEP).map((s) => s.trim()).filter(Boolean);
        if (segments.length === 0) {
          result[nameOrPath] = UNCATEGORIZED_ID;
          continue;
        }
        let parentId: string | null = null;
        for (const seg of segments) {
          const siblings: CategoryNode[] = cur.children.get(parentId) ?? [];
          const found = siblings.find((s) => s.name.toLowerCase() === seg.toLowerCase());
          if (found) {
            parentId = found.id;
          } else {
            const node: CategoryNode = {
              id: slugForName(seg, cur.byId.keys()),
              parentId,
              name: seg,
              createdAt: new Date().toISOString(),
            };
            nextNodes.push(node);
            parentId = node.id;
            cur = buildTree(nextNodes);
          }
        }
        result[nameOrPath] = parentId ?? UNCATEGORIZED_ID;
      }
      if (nextNodes.length !== nodes.length) persistNodes(nextNodes);
      return result;
    },
    [nodes, resolveCategory, persistNodes]
  );

  // ---------- Rules ----------
  const addRule = useCallback(
    (r: Omit<Rule, "id" | "createdAt">) => {
      persistRules([...rules, { ...r, id: uid(), createdAt: new Date().toISOString() }]);
    },
    [rules, persistRules]
  );

  const updateRule = useCallback(
    (id: string, patch: Partial<Rule>) => {
      persistRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [rules, persistRules]
  );

  const deleteRule = useCallback(
    (id: string) => persistRules(rules.filter((r) => r.id !== id)),
    [rules, persistRules]
  );

  const runRules = useCallback(
    (options: { overwrite?: boolean }) => {
      const { updated, count, changes } = applyRules(
        stored,
        rules,
        (id) => tree.byId.has(id),
        options
      );
      if (count > 0) {
        const byId = new Map(updated.map((t) => [t.id, t]));
        persistTxns(stored.map((t) => byId.get(t.id) ?? t));
      }
      return { count, changes };
    },
    [stored, rules, tree, persistTxns]
  );

  // ---------- Import profiles ----------
  const saveImportProfile = useCallback(
    (p: ImportProfile) => {
      const existing = importProfiles.findIndex((x) => x.id === p.id);
      persistProfiles(
        existing >= 0
          ? importProfiles.map((x) => (x.id === p.id ? p : x))
          : [...importProfiles, p]
      );
    },
    [importProfiles, persistProfiles]
  );

  const deleteImportProfile = useCallback(
    (id: string) => persistProfiles(importProfiles.filter((p) => p.id !== id)),
    [importProfiles, persistProfiles]
  );

  // ---------- Backup restore ----------
  const replaceAllData = useCallback(
    (data: {
      transactions: StoredTransaction[];
      nodes?: CategoryNode[];
      rules?: Rule[];
      importProfiles?: ImportProfile[];
    }) => {
      const norm = normalizeLoaded(data.transactions, data.nodes ?? []);
      persistTxns(norm.txns);
      persistNodes(norm.nodes);
      persistRules(data.rules ?? []);
      persistProfiles(data.importProfiles ?? []);
    },
    [persistTxns, persistNodes, persistRules, persistProfiles]
  );

  const value: ExpenseContextType = {
    loading,
    error,
    workspaceStatus: wsStatus,
    workspaceName: wsName,
    workspaceError: wsError,
    chooseWorkspaceFolder,
    reconnectWorkspace,
    disconnectWorkspace,
    reloadFromDisk,
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
