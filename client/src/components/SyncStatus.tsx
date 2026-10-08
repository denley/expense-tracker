/* Small "Saved / Saving… / Offline" indicator for the nav */
import { useExpenses } from "@/contexts/ExpenseContext";
import { cn } from "@/lib/utils";

const LABELS = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline: retrying",
} as const;

export default function SyncStatus({ className }: { className?: string }) {
  const { syncStatus } = useExpenses();
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground", className)}
      title={
        syncStatus === "offline"
          ? "Can't reach the server. Your changes are kept in this tab and saved when it's back; don't close the tab."
          : "Changes save to the server as you make them"
      }
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          syncStatus === "saved" && "bg-eucalyptus",
          syncStatus === "saving" && "bg-sandstone animate-pulse",
          syncStatus === "offline" && "bg-terracotta animate-pulse"
        )}
      />
      {LABELS[syncStatus]}
    </span>
  );
}
