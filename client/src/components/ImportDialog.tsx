/*
  CSV import wizard as a dialog. Opened with a File already chosen (dropped on
  the Transactions page or picked via its Import button):
  auto-detect columns, date format and sign convention → map/adjust →
  preview with dedup + rule-based categorisation → import.
  Column mappings can be saved as named bank profiles for one-click reuse.
*/
import { useState, useMemo, useEffect } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { ColumnMapping, DateFormat, AmountConvention, ImportProfile } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import {
  parseCsvFile, detectMapping, detectDateFormat, buildCandidates, dedupKey,
  type ParsedCsv, type ImportCandidate, type RowError,
} from "@/lib/csv";
import { applyRules } from "@/lib/rules";
import { uid } from "@/lib/db";
import { formatCurrency, formatIsoDate } from "@/lib/utils";
import { inputCls, CategoryPicker } from "@/components/pickers";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { UploadCloud, ArrowRight, ArrowLeft, Check, AlertTriangle, Wand2, Save, CalendarRange, X, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Step = "map" | "preview";

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

const FIELD_LABELS: Array<{ key: keyof ColumnMapping; label: string; required?: boolean }> = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount / Debit", required: true },
  { key: "credit", label: "Credit (if separate)" },
  { key: "category", label: "Category (name or path)" },
  { key: "categoryId", label: "Category Id (app exports)" },
  { key: "notes", label: "Notes" },
];

interface Props {
  file: File | null;
  onClose: () => void;
  /** Called after a successful import with the number of rows left uncategorised */
  onImported: (uncategorised: number) => void;
}

export default function ImportDialog({ file, onClose, onImported }: Props) {
  const {
    storedTransactions, rules, importProfiles, tree, nameOf, pathOf,
    resolveCategory, ensureCategories, accountCoverage,
    addTransactions, saveImportProfile,
  } = useExpenses();

  const [step, setStep] = useState<Step>("map");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: 0, description: 1, amount: 2 });
  const [dateFormat, setDateFormat] = useState<DateFormat>("DMY");
  const [convention, setConvention] = useState<AmountConvention>("negativeIsExpense");
  const [account, setAccount] = useState("");
  const [fxRateStr, setFxRateStr] = useState("");
  const [importCategory, setImportCategory] = useState("");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [useRules, setUseRules] = useState(true);
  const [profileName, setProfileName] = useState("");
  // Rows the user rejected in the preview
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // First existing transaction per dedup key — lets duplicate rows show what they matched
  const existingByKey = useMemo(() => {
    const map = new Map<string, (typeof storedTransactions)[number]>();
    for (const t of storedTransactions) {
      const key = dedupKey(t);
      if (!map.has(key)) map.set(key, t);
    }
    return map;
  }, [storedTransactions]);

  const existingKeys = useMemo(() => new Set(existingByKey.keys()), [existingByKey]);

  const applyProfile = (p: ImportProfile) => {
    setMapping(p.mapping);
    setDateFormat(p.dateFormat);
    setConvention(p.amountConvention);
    setAccount(p.account);
    setFxRateStr(p.fxRate !== undefined ? String(p.fxRate) : "");
    setProfileName(p.name);
  };

  // Blank / invalid / 1 all mean "no conversion"
  const fxRate = useMemo(() => {
    const n = parseFloat(fxRateStr);
    return isNaN(n) || n <= 0 || n === 1 ? undefined : n;
  }, [fxRateStr]);

  // Parse whenever a new file arrives; reset everything when it's cleared
  useEffect(() => {
    setStep("map");
    setParsed(null);
    setAccount("");
    setFxRateStr("");
    setImportCategory("");
    setProfileName("");
    setIncludeDuplicates(false);
    setExcluded(new Set());
    if (!file) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await parseCsvFile(file);
        if (cancelled) return;
        if (result.rows.length === 0) {
          toast.error("Couldn't find any data rows in that file");
          onClose();
          return;
        }
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
        const isOwnExport =
          result.header.includes("ID") &&
          (result.header.includes("CategoryId") || result.header.includes("Group"));
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
      } catch {
        if (!cancelled) {
          toast.error("Failed to read file");
          onClose();
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const { candidates, errors } = useMemo(() => {
    if (!parsed) return { candidates: [] as ImportCandidate[], errors: [] as RowError[] };
    return buildCandidates(
      parsed.rows, mapping, dateFormat, convention, account, existingKeys,
      resolveCategory, (id) => tree.byId.has(id), fxRate
    );
  }, [parsed, mapping, dateFormat, convention, account, existingKeys, resolveCategory, tree, fxRate]);

  // Date span of the file vs what's already stored for this account
  const fileRange = useMemo(() => {
    if (candidates.length === 0) return null;
    let from = candidates[0].txn.date, to = from;
    for (const c of candidates) {
      if (c.txn.date < from) from = c.txn.date;
      if (c.txn.date > to) to = c.txn.date;
    }
    return { from, to };
  }, [candidates]);
  // Coverage is per account the rows will actually land in: the mapped Account
  // column when there is one, else the label typed above (possibly blank).
  const coverage = useMemo(() => {
    if (!fileRange) return [];
    const byAccount = new Map<string, { from: string; to: string }>();
    for (const c of candidates) {
      const r = byAccount.get(c.txn.account);
      if (!r) byAccount.set(c.txn.account, { from: c.txn.date, to: c.txn.date });
      else {
        if (c.txn.date < r.from) r.from = c.txn.date;
        if (c.txn.date > r.to) r.to = c.txn.date;
      }
    }
    return Array.from(byAccount, ([acct, range]) => {
      const existing = accountCoverage.find((e) => e.account === acct);
      // A gap is only worth flagging when at least one whole day is missing
      const gap = existing ? daysBetween(existing.to, range.from) > 1 : false;
      return { account: acct, range, existing, gap };
    });
  }, [fileRange, candidates, accountCoverage]);

  // Whole-import category + rule-based categorisation preview.
  // rulePatternById records which rule categorised each row, for the preview.
  const { categorised, rulePatternById } = useMemo(() => {
    let txns = candidates.map((c) => c.txn);
    if (importCategory) {
      txns = txns.map((t) => ({ ...t, categoryId: importCategory }));
    }
    if (!useRules || rules.length === 0) return { categorised: txns, rulePatternById: new Map<string, string>() };
    const { updated, changes } = applyRules(txns, rules, (id) => tree.byId.has(id), {});
    const byId = new Map(updated.map((t) => [t.id, t]));
    return {
      categorised: txns.map((t) => byId.get(t.id) ?? t),
      rulePatternById: new Map(changes.map((c) => [c.id, c.pattern])),
    };
  }, [candidates, importCategory, useRules, rules, tree]);

  const newCount = candidates.filter((c) => !c.duplicate).length;
  const dupCount = candidates.length - newCount;
  const ruleHits = useMemo(
    () =>
      categorised.filter(
        (t, i) => t.categoryId !== UNCATEGORIZED_ID && candidates[i]?.txn.categoryId === UNCATEGORIZED_ID && !importCategory
      ).length,
    [categorised, candidates, importCategory]
  );
  const isIncluded = (i: number) =>
    (includeDuplicates || !candidates[i].duplicate) && !excluded.has(candidates[i].txn.id);
  const importCount = candidates.filter((_, i) => isIncluded(i)).length;
  const importTotal = useMemo(
    () => categorised.filter((_, i) => isIncluded(i)).reduce((s, t) => s + t.amount, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categorised, candidates, includeDuplicates, excluded]
  );

  const toggleExcluded = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const doImport = () => {
    let toImport = categorised.filter((_, i) => isIncluded(i));
    if (toImport.length === 0) {
      toast.error("Nothing new to import");
      return;
    }
    // Source-file category names that didn't match the tree: create them now
    // (skipped for rows a rule or the whole-import category already filed)
    const included = candidates.filter((_, i) => isIncluded(i));
    const unresolved = Array.from(
      new Set(
        included
          .filter((c, i) => c.unresolvedCategory && toImport[i].categoryId === UNCATEGORIZED_ID)
          .map((c) => c.unresolvedCategory!)
      )
    );
    if (unresolved.length > 0) {
      const created = ensureCategories(unresolved);
      toImport = toImport.map((t, i) => {
        const name = included[i].unresolvedCategory;
        if (name && t.categoryId === UNCATEGORIZED_ID && created[name]) {
          return { ...t, categoryId: created[name] };
        }
        return t;
      });
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
        ...(fxRate !== undefined ? { fxRate } : {}),
      });
    }
    toast.success(`Imported ${toImport.length} transactions`);
    onImported(toImport.filter((t) => t.categoryId === UNCATEGORIZED_ID).length);
  };

  const previewRows = parsed?.rows.slice(0, 6) ?? [];
  const colCount = Math.max(parsed?.header.length ?? 0, ...previewRows.map((r) => r.length));

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[min(1200px,calc(100vw-3rem))] max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-primary" />
            {step === "map" ? "Map columns" : "Preview & import"}
            {file && <span className="text-muted-foreground font-normal text-sm">· {file.name}</span>}
          </DialogTitle>
          <DialogDescription>
            {parsed
              ? `${parsed.rows.length} rows · ${parsed.hasHeader ? "header detected" : "no header row"}`
              : "Reading file…"}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: mapping */}
        {step === "map" && parsed && (
          <div className="space-y-4 min-w-0">
            {importProfiles.length > 0 && (
              <div className="flex justify-end">
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
              </div>
            )}

            {/* Column mapping grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {FIELD_LABELS.map(({ key, label, required }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    {label} {required && <span className="text-terracotta">*</span>}
                  </label>
                  <select
                    value={mapping[key] ?? -1}
                    title={parsed.header[mapping[key] ?? -1]}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                  list="import-account-labels"
                  className={inputCls}
                />
                <datalist id="import-account-labels">
                  {accountCoverage.filter((c) => c.account).map((c) => <option key={c.account} value={c.account} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  FX rate → AUD (foreign currency)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={fxRateStr}
                  onChange={(e) => setFxRateStr(e.target.value)}
                  placeholder="e.g. 1.52 for USD"
                  className={inputCls}
                />
              </div>
            </div>

            {/* Coverage sanity check: does this file pick up where the account's data ends? */}
            {fileRange && (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <CalendarRange className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <p>
                    This file covers <b className="font-medium text-foreground">{formatIsoDate(fileRange.from)} – {formatIsoDate(fileRange.to)}</b>.
                  </p>
                  {coverage.map(({ account: acct, range, existing, gap }) => (
                    <p key={acct}>
                      {!acct ? (
                        <>No account label — rows will be imported without one.</>
                      ) : !existing ? (
                        <>No existing data for "{acct}" yet.</>
                      ) : gap ? (
                        <>
                          Existing data for {acct} ends {formatIsoDate(existing.to)} —{" "}
                          <span className="text-terracotta">
                            {daysBetween(existing.to, range.from) - 1} day{daysBetween(existing.to, range.from) === 2 ? "" : "s"} missing before this file starts.
                          </span>
                        </>
                      ) : range.from > existing.to ? (
                        <>Existing data for {acct} ends {formatIsoDate(existing.to)}.</>
                      ) : (
                        <>Existing data for {acct} ends {formatIsoDate(existing.to)}; overlapping rows will be flagged as duplicates.</>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {fxRate !== undefined && (
              <p className="text-xs text-muted-foreground">
                Amounts will be multiplied by {fxRate} on import; the original amounts are kept
                alongside for the audit trail and duplicate detection.
              </p>
            )}

            {/* Raw preview */}
            <div className="overflow-x-auto scrollbar-prominent border border-border rounded-lg">
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
              {parsed.rows.length > previewRows.length && (
                <p className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border/50">
                  … and {parsed.rows.length - previewRows.length} more row{parsed.rows.length - previewRows.length === 1 ? "" : "s"}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep("preview")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90"
              >
                Preview import <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: preview & import */}
        {step === "preview" && parsed && (
          <div className="space-y-4 min-w-0">
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
              <div className="overflow-x-auto scrollbar-prominent max-h-[360px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border bg-secondary/40">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {categorised.map((t, i) => {
                      const dup = candidates[i].duplicate;
                      const rejected = excluded.has(t.id);
                      const skipped = rejected || (dup && !includeDuplicates);
                      const existing = dup ? existingByKey.get(dedupKey(candidates[i].txn)) : undefined;
                      const rulePattern = rulePatternById.get(t.id);
                      return (
                        <tr
                          key={t.id}
                          className={cn("border-b border-border/50", skipped && "opacity-40")}
                        >
                          <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground align-top">{t.date}</td>
                          <td className="px-3 py-1.5 max-w-[280px] align-top">
                            <div className="truncate">{t.description}</div>
                            {dup && (
                              <div className="text-[10px] text-sandstone truncate">
                                {existing
                                  ? `matches existing: ${existing.date} · ${formatCurrency(existing.amount)} · ${nameOf(existing.categoryId)}${existing.account ? ` · ${existing.account}` : ""}`
                                  : "appears twice in this file"}
                              </div>
                            )}
                          </td>
                          <td className={cn("px-3 py-1.5 whitespace-nowrap align-top", t.categoryId === UNCATEGORIZED_ID ? "text-terracotta" : "")}>
                            {rulePattern && (
                              <Wand2
                                className="w-3 h-3 inline-block mr-1 text-ocean"
                                aria-label={`Categorised by rule "${rulePattern}"`}
                              />
                            )}
                            {candidates[i].unresolvedCategory && t.categoryId === UNCATEGORIZED_ID ? (
                              <span className="text-ocean" title="This category isn't in the tree yet — it'll be created on import">
                                + {candidates[i].unresolvedCategory}
                              </span>
                            ) : (
                              <span title={rulePattern ? `Categorised by rule "${rulePattern}"` : pathOf(t.categoryId)}>
                                {nameOf(t.categoryId)}
                              </span>
                            )}
                          </td>
                          <td className={cn("px-3 py-1.5 text-right whitespace-nowrap tabular-nums font-medium align-top", t.amount < 0 && "text-eucalyptus")}>
                            {formatCurrency(t.amount)}
                            {t.originalAmount !== undefined && (
                              <div className="text-[10px] font-normal text-muted-foreground">
                                {t.originalAmount.toFixed(2)} × {t.fxRate}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap align-top">
                            {rejected ? (
                              <span className="text-muted-foreground">removed</span>
                            ) : dup ? (
                              <span className="text-sandstone">duplicate</span>
                            ) : (
                              <span className="text-eucalyptus flex items-center gap-1"><Check className="w-3 h-3" /> new</span>
                            )}
                          </td>
                          <td className="px-1 py-1 align-top">
                            <button
                              onClick={() => toggleExcluded(t.id)}
                              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                              title={rejected ? "Put back" : "Don't import this row"}
                            >
                              {rejected ? <Undo2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                            </button>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
