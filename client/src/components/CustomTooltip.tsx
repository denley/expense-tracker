import { formatCurrencyExact } from "@/lib/utils";

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string; payload?: { partial?: boolean } }>;
  label?: string;
  formatter?: (value: number) => string;
}

export default function CustomTooltip({ active, payload, label, formatter }: TooltipProps) {
  if (!active || !payload?.length) return null;

  const format = formatter || formatCurrencyExact;
  // Chart rows for an unfinished month carry partial: true
  const heading = label && payload[0]?.payload?.partial ? `${label} (so far)` : label;

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 min-w-[160px]">
      {heading && (
        <p className="text-xs font-medium text-muted-foreground mb-2 pb-2 border-b border-border">
          {heading}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                {entry.name || entry.dataKey}
              </span>
            </div>
            <span className="text-xs font-medium text-foreground tabular-nums whitespace-nowrap">
              {format(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
