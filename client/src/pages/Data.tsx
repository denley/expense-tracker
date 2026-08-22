/*
  DESIGN: Scandinavian Analytical — Data folder
  The "your data is yours" page:
  - data folder status: reload from disk, switch folder
  - backup snapshots (CSV / JSON download) and JSON restore
  (auto-categorisation rules have their own page: /rules)
*/
import { useRef, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import LoadingState from "@/components/LoadingState";
import {
  transactionsToPortableCsv, makeBackup, parseBackup, downloadFile,
} from "@/lib/export";
import {
  Download, DatabaseBackup, FolderOpen, RefreshCw,
  AlertTriangle, FileJson, FileSpreadsheet, FolderSync,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function Data() {
  const {
    loading, storedTransactions, nodes, tree, rules, importProfiles, deleteImportProfile,
    workspaceName, reloadFromDisk, disconnectWorkspace, replaceAllData,
  } = useExpenses();

  const jsonInput = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<ReturnType<typeof parseBackup>>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const exportCsv = () => {
    downloadFile(
      `expenses-${today}.csv`,
      transactionsToPortableCsv(storedTransactions, tree),
      "text/csv"
    );
    toast.success(`Snapshot of ${storedTransactions.length} transactions downloaded`);
  };

  const exportJson = () => {
    const backup = makeBackup(storedTransactions, nodes, rules, importProfiles);
    downloadFile(`expense-backup-${today}.json`, JSON.stringify(backup, null, 2), "application/json");
    toast.success("Backup downloaded");
  };

  const handleJsonRestore = async (file: File) => {
    const text = await file.text();
    const backup = parseBackup(text);
    if (!backup) {
      toast.error("Not a valid backup file");
      return;
    }
    setPendingRestore(backup);
  };

  if (loading) return <LoadingState />;

  const sectionCls = "bg-card rounded-xl border border-border p-5";

  return (
    <div className="space-y-6 max-w-[980px]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Data folder</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your data is plain CSV files in a folder you own. The app is just a viewer/editor over them.
        </p>
      </motion.div>

      {/* Workspace */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className={sectionCls}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-8 h-8 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">{workspaceName}</h3>
              <p className="text-xs text-muted-foreground">
                {storedTransactions.length} transactions · {nodes.length} categories ·{" "}
                {rules.length} rules — in transactions.csv, categories.csv, rules.csv
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void reloadFromDisk()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
              title="Re-read all files (external edits are also picked up automatically when the tab regains focus)"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload from disk
            </button>
            <button
              onClick={() => setConfirmDisconnect(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent text-muted-foreground"
            >
              <FolderSync className="w-3.5 h-3.5" />
              Switch folder
            </button>
          </div>
        </div>
      </motion.div>

      {/* Backups */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className={sectionCls}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
          <Download className="w-4 h-4 text-muted-foreground" /> Backup snapshots
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          The folder is usable on its own for import/export, or make a snapshot here.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:bg-accent text-left transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-eucalyptus shrink-0" />
            <span className="text-xs font-medium">Download transactions CSV</span>
          </button>
          <button
            onClick={exportJson}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:bg-accent text-left transition-colors"
          >
            <FileJson className="w-4 h-4 text-ocean shrink-0" />
            <span className="text-xs font-medium">Download full JSON backup</span>
          </button>
          <button
            onClick={() => jsonInput.current?.click()}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border hover:bg-accent text-left transition-colors"
          >
            <DatabaseBackup className="w-4 h-4 text-terracotta shrink-0" />
            <span className="text-xs font-medium">Restore JSON backup…</span>
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
      </motion.div>

      {/* Saved bank profiles (created from the import dialog on the Transactions page) */}
      {importProfiles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
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

      {/* Restore confirmation */}
      <AlertDialog open={!!pendingRestore} onOpenChange={(o) => !o && setPendingRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Backup from {pendingRestore?.exportedAt ? new Date(pendingRestore.exportedAt).toLocaleString() : "unknown date"} with{" "}
              {pendingRestore?.transactions.length} transactions, {pendingRestore?.nodes.length} categories
              and {pendingRestore?.rules.length} rules. The files in "{workspaceName}" will be
              overwritten with the backup's contents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRestore) {
                  replaceAllData(pendingRestore);
                  toast.success("Backup restored to the data folder");
                  setPendingRestore(null);
                }
              }}
            >
              Overwrite folder files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Switch folder confirmation */}
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-terracotta" />
              Disconnect from "{workspaceName}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The files stay exactly where they are — the app just forgets the folder and asks
              you to choose one again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void disconnectWorkspace();
                setConfirmDisconnect(false);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
