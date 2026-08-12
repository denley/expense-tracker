/*
  DESIGN: Scandinavian Analytical — CSV Import Wizard
  Drop any bank CSV → auto-detect columns, date format and sign convention →
  map/adjust → preview with dedup + rule-based categorisation → import.
  Column mappings can be saved as named bank profiles for one-click reuse.
*/
import { useState, useMemo, useCallback, useRef } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { ColumnMapping, DateFormat, AmountConvention, ImportProfile } from "@/lib/types";
import { UNCATEGORIZED } from "@/lib/types";
import {
  parseCsvFile, detectMapping, detectDateFormat, buildCandidates, dedupKey,
  type ParsedCsv, type ImportCandidate, type RowError,
} from "@/lib/csv";
import { applyRules } from "@/lib/rules";
import { uid } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import { inputCls, CategoryPicker } from "@/components/pickers";
import LoadingState from "@/components/LoadingState";
import { UploadCloud, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertTriangle, Wand2, Save } from "lucide-react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Step = "pick" | "map" | "preview";

const FIELD_LABELS: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount / Debit", required: true },
  { key: "credit", label: "Credit (if separate)" },
  { key: "category", label: "Category" },
  { key: "group", label: "Group" },
  { key: "notes", label: "Notes" },
];

export default function Import() {
  const {
    loading, storedTransactions, rules, importProfiles, groupOf,
    addTransactions, saveImportProfile, deleteImportProfile,
  } = useExpenses();
  const [, navigate] = useLocation();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: 0, description: 1, amount: 2 });
  const [dateFormat, setDateFormat] = useState<DateFormat>("DMY");
  const [convention, setConvention] = useState<AmountConvention>("negativeIsExpense");
  const [account, setAccount] = useState("");
  const [importCategory, setImportCategory] = useState("");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [useRules, setUseRules] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const existingKeys = useMemo(
    () => new Set(storedTransactions.map(dedupKey)),
    [storedTransactions]
  );

  const applyProfile = (p: ImportProfile) => {
    setMapping(p.mapping);
    setDateFormat(p.dateFormat);
    setConvention(p.amountConvention);
    setAccount(p.account);
    setProfileName(p.name);
  };

  const handleFile = useCallback(async (file: File) => {
    try {
      const result = await parseCsvFile(file);
      if (result.rows.length === 0) {
        toast.error("Couldn't find any data rows in that file");
        return;
      }
      setFileName(file.name);
      setParsed(result);

      const detected = detectMapping(result.header, result.rows);
      setMapping(detected);
      setDateFormat(detectDateFormat(result.rows.map((r) => r[detected.date])));

      // Sign convention heuristic: bank exports have mixed signs with spending negative;
      // this app's own exports (and the legacy format) have expenses positive.
      const amounts = result.rows
        .map((r) => parseFloat(String(r[detected.amount] ?? "").replace(/[$,\s]/g, "")))
        .filter((n) => !isNaN(n));
      const negatives = amounts.filter((n) => n < 0).length;
      const isOwnExport = result.header.includes("ID") && result.header.includes("Group");
      setConvention(
        detected.credit !== undefined ? "debitCredit"
        : isOwnExport || negatives < amounts.length * 0.3 ? "positiveIsExpense"
        : "negativeIsExpense"
      );

      // Try to auto-match a saved profile by header shape
      const match = importProfiles.find(
        (p) => JSON.stringify(p.mapping) === JSON.stringify(detected)
      );
      if (match) {
        applyProfile(match);
        toast.success(`Matched saved profile "${match.name}"`);
      }
      setStep("map");
    } catch (e) {
      toast.error("Failed to read file");
    }
  }, [importProfiles]);

  const { candidates, errors } = useMemo(() => {
    if (!parsed) return { candidates: [] as ImportCandidate[], errors: [] as RowError[] };
    return buildCandidates(parsed.rows, mapping, dateFormat, convention, account, existingKeys);
  }, [parsed, mapping, dateFormat, convention, account, existingKeys]);

  // Whole-import category + rule-based categorisation preview
  const categorised = useMemo(() => {
    let txns = candidates.map((c) => c.txn);
    if (importCategory) {
      txns = txns.map((t) => ({ ...t, category: importCategory, group: groupOf(importCategory) }));
    }
    if (!useRules || rules.length === 0) return txns;
    const { updated } = applyRules(txns, rules, groupOf, {});
    const byId = new Map(updated.map((t) => [t.id, t]));
    return txns.map((t) => byId.get(t.id) ?? t);
  }, [candidates, importCategory, useRules, rules, groupOf]);

  const newCount = candidates.filter((c) => !c.duplicate).length;
  const dupCount = candidates.length - newCount;
  const ruleHits = useMemo(
    () =>
      categorised.filter(
        (t, i) => t.category !== UNCATEGORIZED && candidates[i]?.txn.category === UNCATEGORIZED && !importCategory
      ).length,
    [categorised, candidates, importCategory]
  );
  const importCount = includeDuplicates ? candidates.length : newCount;
  const importTotal = useMemo(
    () =>
      categorised
        .filter((_, i) => includeDuplicates || !candidates[i].duplicate)
        .reduce((s, t) => s + t.amount, 0),
    [categorised, candidates, includeDuplicates]
  );

  const doImport = () => {
    const toImport = categorised.filter((_, i) => includeDuplicates || !candidates[i].duplicate);
    if (toImport.length === 0) {
      toast.error("Nothing new to import");
      return;
    }
    addTransactions(toImport);
    if (profileName.trim()) {
      const existing = importProfiles.find((p) => p.name === profileName.trim());
      saveImportProfile({
        id: existing?.id ?? uid(),
        name: profileName.trim(),
        account,
        mapping,
        dateFormat,
        amountConvention: convention,
        hasHeader: parsed?.hasHeader ?? true,
      });
    }
    toast.success(`Imported ${toImport.length} transactions`);
    const uncat = toImport.filter((t) => t.category === UNCATEGORIZED).length;
    reset();
    navigate(uncat > 0 ? "/transactions?uncategorized=1" : "/transactions");
  };

  const reset = () => {
    setStep("pick");
    setParsed(null);
    setFileName("");
    setAccount("");
    setImportCategory("");
    setProfileName("");
    setIncludeDuplicates(false);
  };

  if (loading) return <LoadingState />;

  const previewRows = parsed?.rows.slice(0, 6) ?? [];
  const colCount = Math.max(parsed?.header.length ?? 0, ...previewRows.map((r) => r.length));

  return (
    <div className="space-y-6 max-w-[980px]">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Import Transactions</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Drop a CSV from your bank — columns, date format and signs are detected automatically.
        </p>
      </motion.div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-medium">
        {(["pick", "map", "preview"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/50" />}
            <span
              className={cn(
                "px-2.5 py-1 rounded-full border",
                step === s
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground"
              )}
            >
              {i + 1}. {s === "pick" ? "Choose file" : s === "map" ? "Map columns" : "Preview & import"}
            </span>
          </div>
        ))}
      </div>

      {/* STEP 1: file picker */}
      {step === "pick" && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            onClick={() => fileInput.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/30"
            )}
          >
            <UploadCloud className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">Drop a CSV here, or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">
              Works with exports from most banks — and with this app's own CSV exports
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {importProfiles.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Saved bank profiles</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Profiles apply automatically when a file's columns match. You can also remove ones you no longer need.
              </p>
              <div className="flex flex-wrap gap-2">
                {importProfiles.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-muted-foreground" />
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
            </div>
          )}
        </motion.div>
      )}

      {/* STEP 2: mapping */}
      {step === "map" && parsed && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{fileName}</h3>
                <p className="text-xs text-muted-foreground">
                  {parsed.rows.length} rows · {parsed.hasHeader ? "header detected" : "no header row"}
                </p>
              </div>
              {importProfiles.length > 0 && (
                <select
                  onChange={(e) => {
                    const p = importProfiles.find((x) => x.id === e.target.value);
                    if (p) applyProfile(p);
                  }}
                  defaultValue=""
                  className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs"
                >
                  <option value="" disabled>Apply saved profile…</option>
                  {importProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Column mapping grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {FIELD_LABELS.map(({ key, label, required }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {label} {required && <span className="text-terracotta">*</span>}
                  </label>
                  <select
                    value={mapping[key] ?? -1}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      setMapping((m) => ({
                        ...m,
                        [key]: v === -1 ? (required ? m[key] : undefined) : v,
                      }));
                    }}
                    className={inputCls}
                  >
                    {!required && <option value={-1}>— none —</option>}
                    {parsed.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Date format</label>
                <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)} className={inputCls}>
                  <option value="DMY">Day / Month / Year (AU, EU)</option>
                  <option value="MDY">Month / Day / Year (US)</option>
                  <option value="YMD">Year - Month - Day (ISO)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Amount signs</label>
                <select value={convention} onChange={(e) => setConvention(e.target.value as AmountConvention)} className={inputCls}>
                  <option value="negativeIsExpense">Negative = spending (typical bank export)</option>
                  <option value="positiveIsExpense">Positive = spending (this app's exports)</option>
                  {mapping.credit !== undefined && (
                    <option value="debitCredit">Separate debit / credit columns</option>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Account label</label>
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="e.g. ANZ Visa"
                  className={inputCls}
                />
              </div>
            </div>

            {/* Raw preview */}
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary/40 border-b border-border">
                    {Array.from({ length: colCount }, (_, i) => {
                      const used = Object.entries(mapping).find(([, v]) => v === i);
                      return (
                        <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                          <span className="text-muted-foreground">{parsed.header[i] || `Col ${i + 1}`}</span>
                          {used && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] uppercase">
                              {used[0]}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border/50">
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} className="px-3 py-1.5 whitespace-nowrap max-w-[220px] truncate text-muted-foreground">
                          {row[ci]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Different file
              </button>
              <button
                onClick={() => setStep("preview")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
              >
                Preview import <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* STEP 3: preview & import */}
      {step === "preview" && parsed && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">New</p>
              <p className="text-xl font-semibold text-eucalyptus mt-1 tabular-nums">{newCount}</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Duplicates</p>
              <p className="text-xl font-semibold text-muted-foreground mt-1 tabular-nums">{dupCount}</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Auto-categorised</p>
              <p className="text-xl font-semibold text-ocean mt-1 tabular-nums">{useRules ? ruleHits : 0}</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Import total</p>
              <p className="text-xl font-semibold text-foreground mt-1 tabular-nums">{formatCurrency(importTotal)}</p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="bg-terracotta/5 border border-terracotta/30 rounded-xl p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-terracotta mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {errors.length} row{errors.length === 1 ? "" : "s"} skipped
              </p>
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                {errors.slice(0, 8).map((e) => (
                  <li key={e.rowIndex}>Row {e.rowIndex + 1}: {e.reason}</li>
                ))}
                {errors.length > 8 && <li>…and {errors.length - 8} more</li>}
              </ul>
            </div>
          )}

          {/* Options */}
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRules}
                  onChange={(e) => setUseRules(e.target.checked)}
                  className="accent-[var(--color-eucalyptus)]"
                />
                <Wand2 className="w-3.5 h-3.5 text-muted-foreground" />
                Auto-categorise with rules ({rules.filter((r) => r.enabled).length} active)
              </label>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDuplicates}
                  onChange={(e) => setIncludeDuplicates(e.target.checked)}
                  className="accent-[var(--color-eucalyptus)]"
                />
                Include {dupCount} duplicate{dupCount === 1 ? "" : "s"}
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Categorise the whole import (e.g. a project category)
                </label>
                <CategoryPicker
                  value={importCategory}
                  onChange={setImportCategory}
                  allowEmpty
                  emptyLabel="— Leave as detected —"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Save as bank profile
                </label>
                <div className="relative">
                  <Save className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Profile name (optional)"
                    className={cn(inputCls, "pl-8")}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Candidate preview table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border bg-secondary/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {categorised.map((t, i) => {
                    const dup = candidates[i].duplicate;
                    const skipped = dup && !includeDuplicates;
                    return (
                      <tr
                        key={t.id}
                        className={cn("border-b border-border/50", skipped && "opacity-40")}
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">{t.date}</td>
                        <td className="px-3 py-1.5 max-w-[280px] truncate">{t.description}</td>
                        <td className={cn("px-3 py-1.5 whitespace-nowrap", t.category === UNCATEGORIZED ? "text-terracotta" : "")}>
                          {t.category}
                          {t.category !== UNCATEGORIZED && (
                            <span className="text-muted-foreground ml-1">({groupOf(t.category)})</span>
                          )}
                        </td>
                        <td className={cn("px-3 py-1.5 text-right whitespace-nowrap tabular-nums font-medium", t.amount < 0 && "text-eucalyptus")}>
                          {formatCurrency(t.amount)}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {dup ? (
                            <span className="text-muted-foreground">duplicate</span>
                          ) : (
                            <span className="text-eucalyptus flex items-center gap-1"><Check className="w-3 h-3" /> new</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep("map")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to mapping
            </button>
            <button
              onClick={doImport}
              disabled={importCount === 0}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              Import {importCount} transaction{importCount === 1 ? "" : "s"}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
