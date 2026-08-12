/*
  DESIGN: Scandinavian Analytical — Data & Rules
  The "your data is yours" page:
  - data folder status: reload from disk, switch folder
  - backup snapshots (CSV / JSON download) and JSON restore
  - auto-categorisation rules manager with suggestions learned from history
  - documentation of the on-disk format for external tools / AI agents
*/
import { useMemo, useRef, useState } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import LoadingState from "@/components/LoadingState";
import { CategoryPicker, inputCls } from "@/components/pickers";
import {
  transactionsToCsv, makeBackup, parseBackup, downloadFile,
} from "@/lib/export";
import { suggestRulesFromHistory } from "@/lib/rules";
import { UNCATEGORIZED } from "@/lib/types";
import {
  Download, DatabaseBackup, Wand2, Plus, Trash2, Bot, FolderOpen, RefreshCw,
  AlertTriangle, Lightbulb, FileJson, FileSpreadsheet, Power, FolderSync,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Data() {
  const {
    loading, storedTransactions, categoryDefs, projects, rules, importProfiles, groupOf,
    archivedGroups, workspaceName, reloadFromDisk, disconnectWorkspace,
    replaceAllData, addRule, updateRule, deleteRule, runRules,
  } = useExpenses();

  const jsonInput = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<ReturnType<typeof parseBackup>>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmOverwriteRules, setConfirmOverwriteRules] = useState(false);

  // New rule form
  const [rulePattern, setRulePattern] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");

  const suggestions = useMemo(
    () =>
      suggestRulesFromHistory(storedTransactions, rules, (cat) =>
        archivedGroups.has(groupOf(cat))
      ).slice(0, 8),
    [storedTransactions, rules, archivedGroups, groupOf]
  );

  const uncatCount = useMemo(
    () => storedTransactions.filter((t) => t.category === UNCATEGORIZED).length,
    [storedTransactions]
  );

  const today = new Date().toISOString().slice(0, 10);

  const exportCsv = () => {
    downloadFile(`expenses-${today}.csv`, transactionsToCsv(storedTransactions), "text/csv");
    toast.success(`Snapshot of ${storedTransactions.length} transactions downloaded`);
  };

  const exportJson = () => {
    const backup = makeBackup(storedTransactions, categoryDefs, projects, rules, importProfiles);
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

  const saveRule = () => {
    if (!rulePattern.trim()) {
      toast.error("Enter a pattern to match");
      return;
    }
    if (!ruleCategory) {
      toast.error("Pick the category the rule assigns");
      return;
    }
    addRule({
      pattern: rulePattern.trim(),
      isRegex: false,
      category: ruleCategory,
      enabled: true,
    });
    setRulePattern(""); setRuleCategory("");
    toast.success("Rule added");
  };

  if (loading) return <LoadingState />;

  const sectionCls = "bg-card rounded-xl border border-border p-5";

  return (
    <div className="space-y-6 max-w-[980px]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Data & Rules</h2>
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
                {storedTransactions.length} transactions · {categoryDefs.length} categories ·{" "}
                {projects.length} projects · {rules.length} rules — in transactions.csv,
                categories.csv, projects.csv, rules.csv
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

      {/* AI agent format docs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className={sectionCls}
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
          <Bot className="w-4 h-4 text-muted-foreground" /> Working with AI agents & other tools
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Point any tool straight at the data folder — no export/import loop. Edits show up here
          automatically when this tab regains focus. The folder's <code className="bg-secondary px-1 rounded">README.md</code>{" "}
          documents the full schema for agents; the short version:
        </p>
        <div className="bg-secondary/50 rounded-lg p-3 overflow-x-auto">
          <pre className="text-[11px] text-muted-foreground leading-relaxed">{`transactions.csv   ID,Date,Description,Amount,Category,Group,Account,Notes
                   - keep ID unchanged; Date ISO yyyy-mm-dd
                   - Amount: positive = expense, negative = income/refund
                   - "Uncategorized" marks rows needing triage
categories.csv     Category,Group — the tree; every category has exactly one group.
                   Authoritative: the app rewrites transaction Groups to match it.
projects.csv       Name,Color,Status,Budget,Notes,CreatedAt
                   A project IS a group; Name matches a Group value. Status
                   "archived" retires it — don't categorise new spending there.
rules.csv          Pattern,IsRegex,Category,Enabled,CreatedAt — auto-categorisation.

Avoid editing files while actively using the app (writes are last-one-wins).`}</pre>
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
          The folder is the source of truth (put it in git or a synced drive for real safety) —
          these are point-in-time snapshots you can download and restore.
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

      {/* Rules manager */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className={sectionCls}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wand2 className="w-4 h-4 text-muted-foreground" /> Auto-categorisation rules
          </h3>
          {rules.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const n = runRules({});
                  toast.success(n > 0 ? `Categorised ${n} transactions` : "No uncategorised matches");
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent"
              >
                Run on {uncatCount} uncategorised
              </button>
              <button
                onClick={() => setConfirmOverwriteRules(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent text-muted-foreground"
              >
                Re-run on everything
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          "Description contains X → assign category." The group follows from the category.
          Rules live in rules.csv, run automatically during CSV import and on demand here.
          First matching rule wins.
        </p>

        {/* Add rule */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          <input
            value={rulePattern}
            onChange={(e) => setRulePattern(e.target.value)}
            placeholder='Description contains… e.g. "WOOLWORTHS"'
            className={cn(inputCls, "lg:col-span-2")}
          />
          <CategoryPicker
            value={ruleCategory}
            onChange={setRuleCategory}
            allowEmpty
            emptyLabel="Assign category…"
          />
          <button
            onClick={saveRule}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" /> Add rule
          </button>
        </div>

        {/* Rule list */}
        {rules.length > 0 ? (
          <div className="space-y-1.5">
            {rules.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg border border-border/70",
                  !r.enabled && "opacity-50"
                )}
              >
                <button
                  onClick={() => updateRule(r.id, { enabled: !r.enabled })}
                  className={cn("shrink-0", r.enabled ? "text-eucalyptus" : "text-muted-foreground")}
                  title={r.enabled ? "Disable" : "Enable"}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-medium truncate">"{r.pattern}"</span>
                <span className="text-xs text-muted-foreground truncate">
                  → {r.category} ({groupOf(r.category)})
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => deleteRule(r.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  title="Delete rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No rules yet.</p>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-2">
              <Lightbulb className="w-3.5 h-3.5 text-sandstone" />
              Suggested from your history (merchants that always get the same category)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.pattern}
                  onClick={() => {
                    addRule({
                      pattern: s.pattern,
                      isRegex: false,
                      category: s.category,
                      enabled: true,
                    });
                    toast.success(`Rule added: "${s.pattern}" → ${s.category}`);
                  }}
                  className="px-2.5 py-1.5 rounded-full text-[11px] border border-border hover:bg-accent transition-colors"
                  title={`Seen ${s.count} times`}
                >
                  "{s.pattern}" → {s.category}
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Restore confirmation */}
      <AlertDialog open={!!pendingRestore} onOpenChange={(o) => !o && setPendingRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Backup from {pendingRestore?.exportedAt ? new Date(pendingRestore.exportedAt).toLocaleString() : "unknown date"} with{" "}
              {pendingRestore?.transactions.length} transactions, {pendingRestore?.projects.length} projects
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

      {/* Re-run rules on everything confirmation */}
      <AlertDialog open={confirmOverwriteRules} onOpenChange={setConfirmOverwriteRules}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run rules on all transactions?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites the category of every transaction that matches a rule,
              including ones you categorised by hand.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const n = runRules({ overwrite: true });
                toast.success(`Re-categorised ${n} transactions`);
                setConfirmOverwriteRules(false);
              }}
            >
              Re-run rules
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
