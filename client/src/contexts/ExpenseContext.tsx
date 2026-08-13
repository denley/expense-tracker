/*
  Central data store — file-first.
  The source of truth is a folder on the user's disk (File System Access API):
  transactions.csv / categories.csv / projects.csv / rules.csv / import-profiles.json.
  - Every mutation writes the affected file immediately (per-file write queue)
  - External edits (AI agents, Excel) are picked up via mtime checks on focus
    and a slow interval
  - The category tree (categories.csv) is authoritative: on load, transaction
    groups are rewritten to match it and unknown categories are registered
  - Legacy IndexedDB data (from the previous version) seeds the folder chosen
    on first connect if that folder is empty
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
  CategoryDef,
  Project,
  Rule,
  ImportProfile,
  Settings,
  MonthlyData,
  CategoryData,
  GroupData,
} from "@/lib/types";
import { MONTH_LABELS, UNCATEGORIZED, DEFAULT_GROUP, groupColor } from "@/lib/types";
import { dbGet, dbSet, dbDel, KEYS, uid } from "@/lib/db";
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
  categoriesToCsv,
  projectsToCsv,
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
  category?: string; // group follows automatically
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
  /** Transactions found in legacy IndexedDB storage awaiting migration */
  legacyCount: number;
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
  categoryDefs: CategoryDef[];
  categoryGroups: Map<string, string>;
  groupOf: (category: string) => string;

  projects: Project[];
  /** Group names belonging to archived projects — retired from pickers/rules/suggestions */
  archivedGroups: Set<string>;
  rules: Rule[];
  importProfiles: ImportProfile[];

  // Scope ("all", a year like "2025", or "range:from:to" — see lib/scope)
  yearScope: string;
  setYearScope: (scope: string) => void;
  availableYears: string[];
  /** Human-readable form of the current scope, e.g. "2025" or "1 Jun 2024 – 13 Aug 2025" */
  scopeLabel: string;

  // Derived (scoped)
  totalSpend: number;
  monthlyData: MonthlyData[];
  categoryData: CategoryData[];
  groupData: GroupData[];
  categories: string[];
  groups: string[];
  allGroups: string[];
  accounts: string[];
  avgMonthlySpend: number;
  groupColors: Record<string, string>;

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
    parts: Array<{ amount: number; category: string; notes: string }>
  ) => void;
  /** Set each transaction's category individually (used to undo a rule run) */
  revertCategories: (items: Array<{ id: string; category: string }>) => void;

  // Category tree management
  addCategory: (name: string, group: string) => void;
  renameCategory: (from: string, to: string) => number;
  setCategoryGroup: (category: string, group: string) => number;
  deleteCategory: (name: string) => number;
  renameGroup: (from: string, to: string) => number;

  // Projects (metadata on a group)
  addProject: (
    p: Omit<Project, "id" | "createdAt">,
    starterCategories?: string[]
  ) => Project;
  updateProject: (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => void;
  deleteProject: (id: string) => void;

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
    categories?: CategoryDef[];
    projects?: Project[];
    rules?: Rule[];
    importProfiles?: ImportProfile[];
  }) => void;
}

const ExpenseContext = createContext<ExpenseContextType | null>(null);

function toRuntime(t: StoredTransaction): Transaction {
  const [y, m, d] = t.date.split("-").map(Number);
  return {
    ...t,
    date: new Date(y, m - 1, d),
    dateStr: t.date,
    account: t.account ?? "",
  };
}

/** Derive the category tree from transaction data (majority group per category) */
function deriveDefs(txns: StoredTransaction[]): CategoryDef[] {
  const counts = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (!counts.has(t.category)) counts.set(t.category, new Map());
    const g = counts.get(t.category)!;
    g.set(t.group || DEFAULT_GROUP, (g.get(t.group || DEFAULT_GROUP) || 0) + 1);
  }
  const defs: CategoryDef[] = [];
  for (const [name, gcounts] of counts) {
    defs.push({
      name,
      group: [...gcounts.entries()].sort((a, b) => b[1] - a[1])[0][0],
    });
  }
  return defs;
}

/**
 * Enforce the strict tree on loaded data: categories.csv is authoritative for
 * a transaction's group; categories seen only in transactions get registered.
 */
function normalizeLoaded(
  txns: StoredTransaction[],
  defs: CategoryDef[]
): { txns: StoredTransaction[]; defs: CategoryDef[]; txnsChanged: boolean; defsChanged: boolean } {
  const nextDefs = [...defs];
  const known = new Map(nextDefs.map((d) => [d.name, d.group]));
  let txnsChanged = false;
  let defsChanged = false;
  const nextTxns = txns.map((t) => {
    const cat = t.category || UNCATEGORIZED;
    let group = known.get(cat);
    if (group === undefined) {
      group = t.group || DEFAULT_GROUP;
      nextDefs.push({ name: cat, group });
      known.set(cat, group);
      defsChanged = true;
    }
    if (t.category !== cat || t.group !== group) {
      txnsChanged = true;
      return { ...t, category: cat, group };
    }
    return t;
  });
  return { txns: nextTxns, defs: nextDefs, txnsChanged, defsChanged };
}

function serializeTxns(txns: StoredTransaction[]): string {
  const sorted = [...txns].sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id))
  );
  return transactionsToCsv(sorted) + "\n";
}

const LEGACY_KEYS = [KEYS.transactions, KEYS.categories, KEYS.projects, KEYS.rules, KEYS.importProfiles, KEYS.seeded];

export function ExpenseProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WorkspaceStatus>("checking");
  const [wsName, setWsName] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const [legacyCount, setLegacyCount] = useState(0);

  const [stored, setStored] = useState<StoredTransaction[]>([]);
  const [categoryDefs, setCategoryDefs] = useState<CategoryDef[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
  const legacyRef = useRef<{
    transactions: StoredTransaction[];
    categories: CategoryDef[];
    projects: Project[];
    rules: Rule[];
    importProfiles: ImportProfile[];
  } | null>(null);

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
  const persistDefs = useCallback(
    (next: CategoryDef[]) => {
      if (!guardMutation()) return;
      setCategoryDefs(next);
      scheduleWrite(WS_FILES.categories, categoriesToCsv(next));
    },
    [scheduleWrite, guardMutation]
  );
  const persistProjects = useCallback(
    (next: Project[]) => {
      if (!guardMutation()) return;
      setProjects(next);
      scheduleWrite(WS_FILES.projects, projectsToCsv(next));
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
      const norm = normalizeLoaded(
        data.transactions,
        data.categories.length > 0 ? data.categories : deriveDefs(data.transactions)
      );
      mtimesRef.current = { ...mtimesRef.current, ...mtimes };
      setStored(norm.txns);
      setCategoryDefs(norm.defs);
      setProjects(data.projects);
      setRules(data.rules);
      setImportProfiles(data.importProfiles);
      // Write back tree-normalisation fixes so the files stay consistent
      if (norm.txnsChanged) scheduleWrite(WS_FILES.transactions, serializeTxns(norm.txns));
      if (norm.defsChanged || data.categories.length === 0) {
        scheduleWrite(WS_FILES.categories, categoriesToCsv(norm.defs));
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
          // No transactions.csv — initialize it, seeding from legacy in-browser
          // data if we have any. Only ever CREATE files here, never overwrite:
          // a folder with sidecar files but no transactions.csv must keep them.
          const seed = legacyRef.current;
          const txns = seed?.transactions ?? [];
          const defs = seed?.categories.length ? seed.categories : deriveDefs(txns);
          mtimes[WS_FILES.transactions] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.transactions, serializeTxns(txns));
          mtimes[WS_FILES.categories] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.categories, categoriesToCsv(defs));
          mtimes[WS_FILES.projects] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.projects, projectsToCsv(seed?.projects ?? []));
          mtimes[WS_FILES.rules] = await writeWorkspaceFileIfAbsent(dir, WS_FILES.rules, rulesToCsv(seed?.rules ?? []));
          mtimes[WS_FILES.profiles] = await writeWorkspaceFileIfAbsent(
            dir,
            WS_FILES.profiles,
            JSON.stringify(seed?.importProfiles ?? [], null, 2) + "\n"
          );
          await ensureWorkspaceReadme(dir);
          // Re-read so pre-existing sidecar files win over the seed
          const reread = await readWorkspace(dir);
          applyLoaded(reread.data, reread.mtimes);
          if (seed) toast.success(`Saved ${seed.transactions.length} transactions into ${dir.name}`);
        } else {
          applyLoaded(data, mtimes);
        }

        // Legacy in-browser data has served its purpose
        if (legacyRef.current) {
          legacyRef.current = null;
          setLegacyCount(0);
          void Promise.all(LEGACY_KEYS.map((k) => dbDel(k)));
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

      // Stash legacy IndexedDB data (pre-file-workspace versions) for migration
      try {
        const [txnsRaw, defsRaw, projsRaw, rlsRaw, profiles] = await Promise.all([
          dbGet<any[]>(KEYS.transactions),
          dbGet<CategoryDef[]>(KEYS.categories),
          dbGet<any[]>(KEYS.projects),
          dbGet<any[]>(KEYS.rules),
          dbGet<ImportProfile[]>(KEYS.importProfiles),
        ]);
        if (txnsRaw && txnsRaw.length > 0) {
          const txns: StoredTransaction[] = txnsRaw.map((t) => {
            const { tags: _tags, ...rest } = t;
            return rest as StoredTransaction;
          });
          legacyRef.current = {
            transactions: txns,
            categories: defsRaw ?? [],
            projects: (projsRaw ?? []).map((p) => {
              const { tag: _tag, ...rest } = p;
              return rest as Project;
            }),
            rules: (rlsRaw ?? [])
              .filter((r) => r.category)
              .map((r) => {
                const { tags: _tags, group: _group, ...rest } = r;
                return rest as Rule;
              }),
            importProfiles: profiles ?? [],
          };
          setLegacyCount(txns.length);
        }
      } catch {
        // legacy data is best-effort only
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
    setCategoryDefs([]);
    setProjects([]);
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
  const categoryGroups = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of categoryDefs) map.set(d.name, d.group);
    return map;
  }, [categoryDefs]);

  const groupOf = useCallback(
    (category: string) => categoryGroups.get(category) ?? DEFAULT_GROUP,
    [categoryGroups]
  );

  const normalizeAgainstTree = useCallback(
    (txns: StoredTransaction[]) => {
      const defs = [...categoryDefs];
      const known = new Map(defs.map((d) => [d.name, d.group]));
      const normalized = txns.map((t) => {
        const cat = t.category || UNCATEGORIZED;
        let group = known.get(cat);
        if (group === undefined) {
          group = t.group || DEFAULT_GROUP;
          defs.push({ name: cat, group });
          known.set(cat, group);
        }
        return { ...t, category: cat, group };
      });
      return { normalized, defs, defsChanged: defs.length !== categoryDefs.length };
    },
    [categoryDefs]
  );

  // ---------- Runtime + scoped views ----------
  const allTransactions = useMemo(() => {
    const list = stored.map(toRuntime);
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    return list;
  }, [stored]);

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

  // ---------- Derived analytics (scoped) ----------
  // Month labels carry the year whenever the scoped data spans more than one
  const multiYear = useMemo(
    () => new Set(transactions.map((t) => t.date.getFullYear())).size > 1,
    [transactions]
  );

  const totalSpend = useMemo(
    () => transactions.reduce((sum, t) => sum + t.amount, 0),
    [transactions]
  );

  const monthlyData = useMemo(() => {
    const map = new Map<string, MonthlyData>();
    for (const t of transactions) {
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
      m.categories[t.category] = (m.categories[t.category] || 0) + t.amount;
      m.groups[t.group] = (m.groups[t.group] || 0) + t.amount;
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions, multiYear]);

  const categoryData = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of transactions) {
      if (!map.has(t.category)) map.set(t.category, { total: 0, count: 0 });
      const c = map.get(t.category)!;
      c.total += t.amount;
      c.count += 1;
    }
    const result: CategoryData[] = Array.from(map.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      count: data.count,
      avgPerTransaction: data.total / data.count,
      group: groupOf(name),
    }));
    return result.sort((a, b) => b.total - a.total);
  }, [transactions, groupOf]);

  const groupData = useMemo(() => {
    const map = new Map<string, { total: number; count: number; categories: Set<string> }>();
    for (const t of transactions) {
      if (!map.has(t.group)) {
        map.set(t.group, { total: 0, count: 0, categories: new Set() });
      }
      const g = map.get(t.group)!;
      g.total += t.amount;
      g.count += 1;
      g.categories.add(t.category);
    }
    const result: GroupData[] = Array.from(map.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      count: data.count,
      categories: Array.from(data.categories),
    }));
    return result.sort((a, b) => b.total - a.total);
  }, [transactions]);

  const categories = useMemo(() => categoryData.map((c) => c.name), [categoryData]);
  const groups = useMemo(() => groupData.map((g) => g.name), [groupData]);

  const allGroups = useMemo(() => {
    const set = new Set<string>();
    for (const d of categoryDefs) set.add(d.group);
    for (const p of projects) set.add(p.name);
    for (const t of stored) set.add(t.group);
    set.add(DEFAULT_GROUP);
    return Array.from(set).sort();
  }, [categoryDefs, projects, stored]);

  const groupColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of allGroups) map[g] = groupColor(g);
    for (const p of projects) map[p.name] = p.color;
    return map;
  }, [allGroups, projects]);

  const archivedGroups = useMemo(
    () => new Set(projects.filter((p) => p.status === "archived").map((p) => p.name)),
    [projects]
  );

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
  const addTransactions = useCallback(
    (txns: StoredTransaction[]) => {
      const { normalized, defs, defsChanged } = normalizeAgainstTree(txns);
      persistTxns([...stored, ...normalized]);
      if (defsChanged) persistDefs(defs);
    },
    [stored, normalizeAgainstTree, persistTxns, persistDefs]
  );

  const updateTransactions = useCallback(
    (ids: string[], changes: TransactionChanges) => {
      const idSet = new Set(ids);
      const group = changes.category !== undefined ? groupOf(changes.category) : undefined;
      const next = stored.map((t) => {
        if (!idSet.has(t.id)) return t;
        return {
          ...t,
          category: changes.category ?? t.category,
          group: group ?? t.group,
          account: changes.account ?? t.account,
          notes: changes.notes ?? t.notes,
          description: changes.description ?? t.description,
          date: changes.date ?? t.date,
          amount: changes.amount ?? t.amount,
        };
      });
      persistTxns(next);
    },
    [stored, groupOf, persistTxns]
  );

  const deleteTransactions = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      persistTxns(stored.filter((t) => !idSet.has(t.id)));
    },
    [stored, persistTxns]
  );

  const splitTransaction = useCallback(
    (id: string, parts: Array<{ amount: number; category: string; notes: string }>) => {
      const parent = stored.find((t) => t.id === id);
      if (!parent || parts.length < 2) return;
      const base = uid();
      const rows: StoredTransaction[] = parts.map((p, i) => ({
        id: base + i.toString(36),
        date: parent.date,
        description: parent.description,
        amount: p.amount,
        category: p.category,
        group: DEFAULT_GROUP,
        account: parent.account,
        notes: p.notes,
      }));
      const { normalized, defs, defsChanged } = normalizeAgainstTree(rows);
      persistTxns(stored.flatMap((t) => (t.id === id ? normalized : [t])));
      if (defsChanged) persistDefs(defs);
    },
    [stored, normalizeAgainstTree, persistTxns, persistDefs]
  );

  // ---------- Category tree management ----------
  const addCategory = useCallback(
    (name: string, group: string) => {
      if (categoryDefs.some((d) => d.name === name)) return;
      persistDefs([...categoryDefs, { name, group }]);
    },
    [categoryDefs, persistDefs]
  );

  const renameCategory = useCallback(
    (from: string, to: string) => {
      const target = categoryDefs.find((d) => d.name === to);
      const source = categoryDefs.find((d) => d.name === from);
      const group = target?.group ?? source?.group ?? DEFAULT_GROUP;
      let count = 0;
      persistTxns(
        stored.map((t) => {
          if (t.category !== from) return t;
          count++;
          return { ...t, category: to, group };
        })
      );
      const defs = categoryDefs.filter((d) => d.name !== from);
      if (!target) defs.push({ name: to, group });
      persistDefs(defs);
      persistRules(rules.map((r) => (r.category === from ? { ...r, category: to } : r)));
      return count;
    },
    [stored, categoryDefs, rules, persistTxns, persistDefs, persistRules]
  );

  const setCategoryGroup = useCallback(
    (category: string, group: string) => {
      let count = 0;
      persistTxns(
        stored.map((t) => {
          if (t.category !== category || t.group === group) return t;
          count++;
          return { ...t, group };
        })
      );
      persistDefs(
        categoryDefs.some((d) => d.name === category)
          ? categoryDefs.map((d) => (d.name === category ? { ...d, group } : d))
          : [...categoryDefs, { name: category, group }]
      );
      return count;
    },
    [stored, categoryDefs, persistTxns, persistDefs]
  );

  const deleteCategory = useCallback(
    (name: string) => {
      let count = 0;
      persistTxns(
        stored.map((t) => {
          if (t.category !== name) return t;
          count++;
          return { ...t, category: UNCATEGORIZED, group: DEFAULT_GROUP };
        })
      );
      persistDefs(categoryDefs.filter((d) => d.name !== name));
      persistRules(rules.filter((r) => r.category !== name));
      return count;
    },
    [stored, categoryDefs, rules, persistTxns, persistDefs, persistRules]
  );

  const renameGroup = useCallback(
    (from: string, to: string) => {
      let count = 0;
      persistTxns(
        stored.map((t) => {
          if (t.group !== from) return t;
          count++;
          return { ...t, group: to };
        })
      );
      persistDefs(categoryDefs.map((d) => (d.group === from ? { ...d, group: to } : d)));
      persistProjects(projects.map((p) => (p.name === from ? { ...p, name: to } : p)));
      return count;
    },
    [stored, categoryDefs, projects, persistTxns, persistDefs, persistProjects]
  );

  // ---------- Projects ----------
  const addProject = useCallback(
    (p: Omit<Project, "id" | "createdAt">, starterCategories: string[] = []) => {
      const project: Project = { ...p, id: uid(), createdAt: new Date().toISOString() };
      persistProjects([...projects, project]);
      const newDefs = starterCategories
        .map((c) => c.trim())
        .filter((c) => c && !categoryDefs.some((d) => d.name === c))
        .map((name) => ({ name, group: project.name }));
      if (newDefs.length > 0) persistDefs([...categoryDefs, ...newDefs]);
      return project;
    },
    [projects, categoryDefs, persistProjects, persistDefs]
  );

  const updateProject = useCallback(
    (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => {
      const prev = projects.find((p) => p.id === id);
      if (!prev) return;
      const renaming = patch.name !== undefined && patch.name !== prev.name;
      if (renaming) {
        const from = prev.name;
        const to = patch.name!;
        persistTxns(stored.map((t) => (t.group === from ? { ...t, group: to } : t)));
        persistDefs(categoryDefs.map((d) => (d.group === from ? { ...d, group: to } : d)));
      }
      persistProjects(projects.map((p) => (p.id === id ? { ...p, ...patch } : p)));

      // Archiving retires the project's rules so future imports can't file
      // new spending into it. Restoring does NOT auto-re-enable them.
      if (patch.status === "archived" && prev.status !== "archived") {
        const projectCats = new Set(
          categoryDefs.filter((d) => d.group === prev.name).map((d) => d.name)
        );
        const affected = rules.filter((r) => r.enabled && projectCats.has(r.category));
        if (affected.length > 0) {
          persistRules(
            rules.map((r) =>
              r.enabled && projectCats.has(r.category) ? { ...r, enabled: false } : r
            )
          );
          toast.info(
            `Disabled ${affected.length} auto-categorisation rule${affected.length === 1 ? "" : "s"} pointing at "${prev.name}"`
          );
        }
      }
    },
    [projects, stored, categoryDefs, rules, persistTxns, persistDefs, persistProjects, persistRules]
  );

  const deleteProject = useCallback(
    (id: string) => {
      persistProjects(projects.filter((p) => p.id !== id));
    },
    [projects, persistProjects]
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
      const { updated, count, changes } = applyRules(stored, rules, groupOf, options);
      if (count > 0) {
        const byId = new Map(updated.map((t) => [t.id, t]));
        persistTxns(stored.map((t) => byId.get(t.id) ?? t));
      }
      return { count, changes };
    },
    [stored, rules, groupOf, persistTxns]
  );

  const revertCategories = useCallback(
    (items: Array<{ id: string; category: string }>) => {
      const byId = new Map(items.map((i) => [i.id, i.category]));
      persistTxns(
        stored.map((t) => {
          const cat = byId.get(t.id);
          if (cat === undefined || cat === t.category) return t;
          return { ...t, category: cat, group: groupOf(cat) };
        })
      );
    },
    [stored, groupOf, persistTxns]
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
      categories?: CategoryDef[];
      projects?: Project[];
      rules?: Rule[];
      importProfiles?: ImportProfile[];
    }) => {
      persistTxns(data.transactions);
      persistDefs(
        data.categories && data.categories.length > 0
          ? data.categories
          : deriveDefs(data.transactions)
      );
      persistProjects(data.projects ?? []);
      persistRules(data.rules ?? []);
      persistProfiles(data.importProfiles ?? []);
    },
    [persistTxns, persistDefs, persistProjects, persistRules, persistProfiles]
  );

  const value: ExpenseContextType = {
    loading,
    error,
    workspaceStatus: wsStatus,
    workspaceName: wsName,
    workspaceError: wsError,
    legacyCount,
    chooseWorkspaceFolder,
    reconnectWorkspace,
    disconnectWorkspace,
    reloadFromDisk,
    transactions,
    allTransactions,
    storedTransactions: stored,
    categoryDefs,
    categoryGroups,
    groupOf,
    projects,
    archivedGroups,
    rules,
    importProfiles,
    yearScope: effectiveScope,
    setYearScope,
    availableYears,
    scopeLabel,
    totalSpend,
    monthlyData,
    categoryData,
    groupData,
    categories,
    groups,
    allGroups,
    accounts,
    avgMonthlySpend,
    groupColors,
    addTransactions,
    updateTransactions,
    deleteTransactions,
    splitTransaction,
    revertCategories,
    addCategory,
    renameCategory,
    setCategoryGroup,
    deleteCategory,
    renameGroup,
    addProject,
    updateProject,
    deleteProject,
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
