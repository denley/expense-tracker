/*
  DESIGN: Scandinavian Analytical — Data
  The "where is my data" page:
  - storage status (the server's data folder), reload
  - activity: who changed what (people, agents, direct file edits), with
    one-click undo for agent operations
  - server snapshots with restore
  - downloads (CSV / JSON), JSON restore, and uploading an existing data
    folder (moving over from the folder-based version of the app)
  (auto-categorisation rules have their own page: /rules)
*/
import { useCallback, useEffect, useRef, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import LoadingState from "@/components/LoadingState";
import { transactionsToPortableCsv, makeBackup, parseBackup, csvToTransactions } from "@/lib/export";
import { downloadFile } from "@/lib/download";
import { WS_FILES, csvToNodes, csvToRules, jsonToProfiles } from "@/lib/files";
import * as api from "@/lib/api";
import type { ActivityEntry, BackupInfo } from "@/lib/api";
import type { StoredTransaction, CategoryNode, Rule, ImportProfile } from "@/lib/types";
import {
  Download, DatabaseBackup, RefreshCw, FileJson, FileSpreadsheet, FolderUp,
  Server, History, Undo2, Camera, Bot, User, FilePen, Cog,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PendingReplace {
  title: string;
  source: string;
  reason: string;
  data: {
    transactions: StoredTransaction[];
    nodes: CategoryNode[];
    rules: Rule[];
    importProfiles: ImportProfile[];
  };
}

const REASONS: Record<string, string> = {
  daily: "Start of day",
  manual: "Manual",
  "pre-import": "Before an import",
  "pre-restore": "Before a restore",
  "pre-replace": "Before an upload",
  "pre-file-edit": "Before a direct file edit",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(iso);
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function snapshotLabel(at: string): string {
  const [date, time] = at.split("T");
  const [y, m, d] = date.split("-").map(Number);
  return `${new Date(y, m - 1, d).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} ${time.slice(0, 5)}`;
}

function ActorIcon({ entry }: { entry: ActivityEntry }) {
  const cls = "w-3.5 h-3.5 shrink-0";
  if (entry.source === "external") return <FilePen className={cls} />;
  if (entry.source === "system") return <Cog className={cls} />;
  if (entry.actor.kind === "local" || entry.source === "api") return <Bot className={cls} />;
  return <User className={cls} />;
}

export default function Data() {
  const {
    loading, storedTransactions, nodes, tree, rules, importProfiles, deleteImportProfile,
    dataDir, me, reloadFromServer, replaceAllData, lastChange,
  } = useExpenses();

  const jsonInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupInfo | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showAllBackups, setShowAllBackups] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api.listActivity(200), api.listBackups()]);
      setActivity(a.entries);
      setBackups(b.backups);
    } catch {
      // the sync layer already reports connection trouble
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, lastChange]);

  const exportCsv = () => {
    downloadFile(`expenses-${today}.csv`, transactionsToPortableCsv(storedTransactions, tree), "text/csv");
    toast.success(`${storedTransactions.length} transactions downloaded`);
  };

  const exportJson = () => {
    const backup = makeBackup(storedTransactions, nodes, rules, importProfiles);
    downloadFile(`expense-backup-${today}.json`, JSON.stringify(backup, null, 2), "application/json");
    toast.success("Backup downloaded");
  };

  const handleJsonRestore = async (file: File) => {
    const backup = parseBackup(await file.text());
    if (!backup) {
      toast.error("Not a valid backup file");
      return;
    }
    setPendingReplace({
      title: "Restore this backup?",
      source: `backup from ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : "an unknown date"}`,
      reason: `Restored JSON backup ${file.name}`,
      data: backup,
    });
  };

  /** An existing data folder from the folder-based version of the app */
  const handleFolder = async (files: FileList) => {
    const byName = new Map<string, File>();
    for (const f of Array.from(files)) {
      // only the folder's own files, not ones in subfolders
      const depth = (f.webkitRelativePath || f.name).split("/").length;
      if (depth <= 2) byName.set(f.name, f);
    }
    const txnFile = byName.get(WS_FILES.transactions);
    if (!txnFile) {
      toast.error("That folder has no transactions.csv");
      return;
    }
    const transactions = csvToTransactions(await txnFile.text());
    if (!transactions) {
      toast.error("transactions.csv in that folder couldn't be parsed");
      return;
    }
    const read = async (name: string) => (byName.has(name) ? byName.get(name)!.text() : undefined);
    const [cats, rls, profs] = await Promise.all([
      read(WS_FILES.categories), read(WS_FILES.rules), read(WS_FILES.profiles),
    ]);
    const folder = (txnFile.webkitRelativePath || "").split("/")[0] || "the folder";
    setPendingReplace({
      title: `Upload "${folder}"?`,
      source: `"${folder}"`,
      reason: `Uploaded data folder "${folder}"`,
      data: {
        transactions,
        nodes: cats ? csvToNodes(cats) : [],
        rules: rls ? csvToRules(rls) : [],
        importProfiles: profs ? jsonToProfiles(profs) : [],
      },
    });
  };

  const doReplace = async () => {
    if (!pendingReplace) return;
    setBusy(true);
    try {
      await replaceAllData(pendingReplace.data, pendingReplace.reason);
      toast.success("Done. The previous data is kept as a snapshot below.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setPendingReplace(null);
    }
  };

  const doRestore = async () => {
    if (!pendingRestore) return;
    setBusy(true);
    try {
      await api.restoreBackup(pendingRestore.name);
      toast.success("Snapshot restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
      setPendingRestore(null);
    }
  };

  const snapshotNow = async () => {
    try {
      await api.createBackup();
      toast.success("Snapshot taken");
      void refresh();
    } catch {
      toast.error("Couldn't take a snapshot");
    }
  };

  const undo = async (entry: ActivityEntry) => {
    try {
      const r = await api.undoActivity(entry.id);
      toast.success(r.summary);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Undo failed");
    }
  };

  if (loading) return <LoadingState />;

  const sectionCls = "bg-card rounded-xl border border-border p-5";
  const btnCls =
    "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:bg-accent text-left transition-colors";
  const shownActivity = showAllActivity ? activity : activity.slice(0, 12);
  const shownBackups = showAllBackups ? backups : backups.slice(0, 6);

  return (
    <div className="space-y-6 max-w-[980px]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Data</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your data lives on the household server as plain CSV files. Changes save as you make
          them, show up live on every device, and are snapshotted daily.
        </p>
      </motion.div>

      {/* Storage */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className={sectionCls}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Server className="w-8 h-8 text-primary shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {storedTransactions.length} transactions · {nodes.length} categories · {rules.length} rules
              </h3>
              <p className="text-xs text-muted-foreground truncate" title={dataDir}>
                In <code className="bg-secondary px-1 rounded">{dataDir}</code>
                {me && <> · you're {me.name}</>}
              </p>
            </div>
          </div>
          <button
            onClick={() => void reloadFromServer()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
            title="Re-read everything (changes from others normally arrive by themselves)"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload
          </button>
        </div>
      </motion.div>

      {/* Activity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className={sectionCls}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
          <History className="w-4 h-4 text-muted-foreground" /> Activity
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Every change and who made it: people in the app, agents using the API, and direct
          edits to the files. Agent changes can be undone here (rows edited since are left alone).
        </p>
        {activity.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shownActivity.map((e) => (
              <li key={e.id} className="py-2.5 flex items-start gap-3">
                <span className="mt-0.5 text-muted-foreground">
                  <ActorIcon entry={e} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm text-foreground", e.undoneAt && "line-through text-muted-foreground")}>
                    {e.summary}
                  </p>
                  {e.examples.length > 0 && (
                    <p className="text-[11px] text-muted-foreground truncate" title={e.examples.join("\n")}>
                      {e.examples.join(" · ")}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {e.actor.name} · {relativeTime(e.until ?? e.at)}
                    {e.undoneAt && <> · undone by {e.undoneBy}</>}
                  </p>
                </div>
                {e.canUndo && (
                  <button
                    onClick={() => void undo(e)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent shrink-0"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {activity.length > 12 && (
          <button
            onClick={() => setShowAllActivity((v) => !v)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {showAllActivity ? "Show less" : `Show all ${activity.length}`}
          </button>
        )}
      </motion.div>

      {/* Snapshots */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className={sectionCls}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
              <DatabaseBackup className="w-4 h-4 text-muted-foreground" /> Snapshots
            </h3>
            <p className="text-xs text-muted-foreground max-w-[640px]">
              Taken on the server before each day's first change, before imports, uploads and
              restores, and before applying direct file edits. Kept for 30 days, then one per month.
              Restoring snapshots the current state first, so it can be undone too.
            </p>
          </div>
          <button
            onClick={() => void snapshotNow()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
          >
            <Camera className="w-3.5 h-3.5" />
            Snapshot now
          </button>
        </div>
        {backups.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">None yet: the first one is taken with the first change.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shownBackups.map((b) => (
              <li key={b.name} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{snapshotLabel(b.at)}</p>
                  <p className="text-[11px] text-muted-foreground">{REASONS[b.reason] ?? b.reason}</p>
                </div>
                <button
                  onClick={() => setPendingRestore(b)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent shrink-0"
                >
                  Restore…
                </button>
              </li>
            ))}
          </ul>
        )}
        {backups.length > 6 && (
          <button
            onClick={() => setShowAllBackups((v) => !v)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {showAllBackups ? "Show less" : `Show all ${backups.length}`}
          </button>
        )}
      </motion.div>

      {/* Downloads & uploads */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className={sectionCls}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
          <Download className="w-4 h-4 text-muted-foreground" /> Download &amp; upload
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Take a copy with you, or bring data in: a JSON backup, or the data folder from the
          folder-based version of this app. Uploads replace everything (a snapshot is taken first).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={exportCsv} className={btnCls}>
            <FileSpreadsheet className="w-4 h-4 text-eucalyptus shrink-0" />
            <span className="text-xs font-medium">Download transactions CSV</span>
          </button>
          <button onClick={exportJson} className={btnCls}>
            <FileJson className="w-4 h-4 text-ocean shrink-0" />
            <span className="text-xs font-medium">Download full JSON backup</span>
          </button>
          <button onClick={() => jsonInput.current?.click()} className={btnCls}>
            <DatabaseBackup className="w-4 h-4 text-terracotta shrink-0" />
            <span className="text-xs font-medium">Restore a JSON backup…</span>
          </button>
          <button onClick={() => folderInput.current?.click()} className={btnCls}>
            <FolderUp className="w-4 h-4 text-sandstone shrink-0" />
            <span className="text-xs font-medium">Upload a data folder…</span>
          </button>
        </div>
        <input
          ref={jsonInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleJsonRestore(f);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          className="hidden"
          // a folder picker (desktop browsers); the attribute isn't in React's types
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            if (e.target.files?.length) void handleFolder(e.target.files);
            e.target.value = "";
          }}
        />
      </motion.div>

      {/* Saved bank profiles (created from the import dialog on the Transactions page) */}
      {importProfiles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className={sectionCls}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground" /> Saved bank profiles
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Column mappings saved from the import dialog. They apply automatically when a
            dropped file's columns match; remove ones you no longer need.
          </p>
          <div className="flex flex-wrap gap-2">
            {importProfiles.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs"
              >
                <span className="font-medium">{p.name}</span>
                {p.account && <span className="text-muted-foreground">({p.account})</span>}
                <button
                  onClick={() => deleteImportProfile(p.id)}
                  className="text-muted-foreground hover:text-destructive ml-1"
                  title="Delete profile"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* Replace-everything confirmation (JSON restore / folder upload) */}
      <AlertDialog open={!!pendingReplace} onOpenChange={(o) => !o && !busy && setPendingReplace(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingReplace?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingReplace?.source} has {pendingReplace?.data.transactions.length} transactions,{" "}
              {pendingReplace?.data.nodes.length} categories and {pendingReplace?.data.rules.length} rules.
              It replaces all {storedTransactions.length} transactions currently on the server, for
              everyone. The current data is snapshotted first, so this can be undone from Snapshots.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void doReplace()}>
              Replace server data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Snapshot restore confirmation */}
      <AlertDialog open={!!pendingRestore} onOpenChange={(o) => !o && !busy && setPendingRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the snapshot from {pendingRestore && snapshotLabel(pendingRestore.at)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything goes back to how it was then, for everyone. Changes made since are not
              lost: the current state is snapshotted first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void doRestore()}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
