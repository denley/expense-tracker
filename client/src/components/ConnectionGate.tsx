/*
  Full-screen message shown when the app can't load its data from the
  server: unreachable, not allowed (Tailscale identity), or a data file the
  server holds can't be parsed.
*/
import { useExpenses } from "@/contexts/ExpenseContext";
import { AlertTriangle, RefreshCw, ShieldX } from "lucide-react";
import { motion } from "framer-motion";

export default function ConnectionGate() {
  const { workspaceError, retryConnect } = useExpenses();
  const denied = /allowed|Tailscale/i.test(workspaceError ?? "");

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-card border border-border rounded-2xl p-10 max-w-[520px] w-full text-center"
      >
        {denied ? (
          <ShieldX className="w-10 h-10 mx-auto text-terracotta mb-4" />
        ) : (
          <AlertTriangle className="w-10 h-10 mx-auto text-destructive mb-4" />
        )}
        <h2 className="text-lg font-bold text-foreground">
          {denied ? "No access yet" : "Couldn't load your data"}
        </h2>
        <p className="text-sm text-muted-foreground mt-2">{workspaceError}</p>
        <button
          onClick={retryConnect}
          className="mt-5 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </motion.div>
    </div>
  );
}
