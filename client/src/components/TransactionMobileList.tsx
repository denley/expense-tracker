/*
  Phone layout for the Transactions list (the table needs a wide screen):
  two-line rows — description + amount, then category chip + account/notes —
  under sticky day headers when sorted by date. Tap opens the row's action
  sheet; long-press starts selecting, after which taps toggle. The category
  chip is a transparent native select, so tapping it opens the OS picker.
*/
import { useRef } from "react";
import { useExpenses } from "@/contexts/ExpenseContext";
import type { Transaction } from "@/lib/types";
import { UNCATEGORIZED_ID } from "@/lib/tree";
import { CategoryPicker } from "@/components/pickers";
import { formatCurrency, formatCurrencyExact, formatDate, formatDayHeading, cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

interface Props {
  rows: Transaction[];
  /** Sticky day headers (only meaningful when sorted by date) */
  groupByDay: boolean;
  /** Total per ISO date over the whole filtered list, not just the rows shown */
  dayTotals: Map<string, number>;
  selected: Set<string>;
  duplicateIds: Set<string>;
  onOpen: (t: Transaction) => void;
  onToggleSelect: (t: Transaction) => void;
  onCategory: (t: Transaction, categoryId: string) => void;
}

export default function TransactionMobileList({
  rows, groupByDay, dayTotals, selected, duplicateIds, onOpen, onToggleSelect, onCategory,
}: Props) {
  const selecting = selected.size > 0;
  return (
    <div>
      {rows.map((t, i) => (
        <div key={t.id}>
          {groupByDay && t.dateStr !== rows[i - 1]?.dateStr && (
            <DayHeader date={t.date} total={dayTotals.get(t.dateStr) ?? 0} />
          )}
          <Row
            t={t}
            showDate={!groupByDay}
            selecting={selecting}
            isSelected={selected.has(t.id)}
            isDuplicate={duplicateIds.has(t.id)}
            onTap={() => (selecting ? onToggleSelect(t) : onOpen(t))}
            onLongPress={() => { if (!selected.has(t.id)) onToggleSelect(t); }}
            onCategory={(id) => onCategory(t, id)}
          />
        </div>
      ))}
    </div>
  );
}

function DayHeader({ date, total }: { date: Date; total: number }) {
  return (
    <div className="sticky top-[var(--mobile-topbar-h,0px)] z-10 flex items-center justify-between px-4 py-1.5 bg-secondary/95 backdrop-blur border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
      <span>{formatDayHeading(date)}</span>
      <span className="tabular-nums normal-case">{formatCurrency(total)}</span>
    </div>
  );
}

interface RowProps {
  t: Transaction;
  showDate: boolean;
  selecting: boolean;
  isSelected: boolean;
  isDuplicate: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onCategory: (categoryId: string) => void;
}

function Row({ t, showDate, selecting, isSelected, isDuplicate, onTap, onLongPress, onCategory }: RowProps) {
  const { groupColors } = useExpenses();
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Swallows the click that follows a long-press
  const pressed = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  const uncategorised = t.categoryId === UNCATEGORIZED_ID;
  const meta = [showDate ? formatDate(t.date) : "", t.account, t.notes].filter(Boolean).join(" · ");

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        pressed.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          pressed.current = true;
          navigator.vibrate?.(10);
          onLongPress();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (pressed.current) { pressed.current = false; return; }
        onTap();
      }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border/50 select-none [-webkit-touch-callout:none] active:bg-accent/60 transition-colors",
        isSelected && "bg-primary/5"
      )}
    >
      {selecting && (
        <span
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded-full border shrink-0",
            isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
          )}
        >
          {isSelected && <Check className="w-3.5 h-3.5" />}
        </span>
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">{t.description}</span>
          {isDuplicate && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sandstone/15 text-sandstone text-[9px] font-semibold uppercase tracking-wide shrink-0 self-center">
              <Copy className="w-2.5 h-2.5" /> dup
            </span>
          )}
          <span
            className={cn(
              "shrink-0 text-sm font-medium tabular-nums",
              t.amount < 0 ? "text-eucalyptus" : "text-foreground"
            )}
          >
            {formatCurrencyExact(t.amount)}
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
          <span
            // The chip's picker is its own tap target, not a row tap
            onClick={selecting ? undefined : (e) => e.stopPropagation()}
            onPointerDown={selecting ? undefined : (e) => e.stopPropagation()}
            className={cn(
              "relative inline-flex items-center gap-1.5 max-w-[60%] shrink-0 px-2 py-0.5 rounded-full border",
              uncategorised
                ? "border-terracotta/40 bg-terracotta/10 text-terracotta font-medium"
                : "border-border bg-background text-foreground"
            )}
          >
            {!uncategorised && (
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: groupColors[t.group] }} />
            )}
            <span className="truncate">{t.category}</span>
            {/* Invisible native select over the chip; while selecting, taps fall through to the row */}
            <CategoryPicker
              value={t.categoryId}
              onChange={(id) => { if (id !== t.categoryId) onCategory(id); }}
              allowCreate={false}
              className={cn("absolute inset-0 h-full p-0 opacity-0 text-base", selecting && "pointer-events-none")}
            />
          </span>
          {meta && <span className="truncate">{meta}</span>}
        </div>
      </div>
    </div>
  );
}
