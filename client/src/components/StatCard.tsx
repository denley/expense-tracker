/*
  DESIGN: Scandinavian Analytical — soft-shadow paper cards
  - Rounded corners, subtle shadow, slight hover lift
  - Mono font for currency values
  - Muted label, bold value
  - Optional onClick for navigation
*/
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  trend?: { value: number; label: string };
  className?: string;
  onClick?: () => void;
}

export default function StatCard({ label, value, subtitle, icon, trend, className, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card rounded-xl border border-border p-5 card-hover",
        onClick && "cursor-pointer hover:border-primary/30 hover:shadow-md transition-all",
        className
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <div className="text-muted-foreground/60">{icon}</div>
        )}
      </div>
      <div className="tabular-nums text-2xl font-semibold text-foreground leading-none">
        {value}
      </div>
      {(subtitle || trend) && (
        <div className="mt-2 flex items-center gap-2">
          {trend && (
            <span
              className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded",
                trend.value >= 0
                  ? "bg-eucalyptus/10 text-eucalyptus"
                  : "bg-destructive/10 text-destructive"
              )}
            >
              {trend.value >= 0 ? "+" : ""}{trend.value.toFixed(1)}%
            </span>
          )}
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
      )}
      {onClick && (
        <div className="mt-2 text-[10px] text-primary/60 font-medium">Click to explore →</div>
      )}
    </div>
  );
}
