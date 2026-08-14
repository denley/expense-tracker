/*
  Full-screen gate shown until a data folder is connected.
  States: unsupported browser / no folder yet / permission needed / error.
*/
import { useExpenses } from "@/contexts/ExpenseContext";
import { FolderOpen, FolderSync, AlertTriangle, MonitorX, FileSpreadsheet } from "lucide-react";
import { motion } from "framer-motion";

export default function WorkspaceGate() {
  const {
    workspaceStatus, workspaceName, workspaceError,
    chooseWorkspaceFolder, reconnectWorkspace, disconnectWorkspace,
  } = useExpenses();

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-card border border-border rounded-2xl p-10 max-w-[520px] w-full text-center"
      >
        {workspaceStatus === "unsupported" && (
          <>
            <MonitorX className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-bold text-foreground">This browser can't open data folders</h2>
            <p className="text-sm text-muted-foreground mt-2">
              The tracker stores your data as CSV files in a folder you choose, which needs the
              File System Access API — available in <strong>Chrome or Edge on desktop</strong>.
              Please open the app there.
            </p>
          </>
        )}

        {workspaceStatus === "none" && (
          <>
            <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-bold text-foreground">Choose your data folder</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Your expenses live as plain CSV files in a folder on your computer — the app just
              reads and writes them. Pick the folder that holds (or will hold){" "}
              <code className="bg-secondary px-1 rounded text-xs">transactions.csv</code>.
            </p>
            <button
              onClick={() => void chooseWorkspaceFolder()}
              className="mt-5 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-2"
            >
              <FolderOpen className="w-4 h-4" />
              Choose folder…
            </button>
            <p className="text-[11px] text-muted-foreground mt-4 flex items-center justify-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              A new folder gets transactions.csv, categories.csv, rules.csv and a README.
            </p>
          </>
        )}

        {workspaceStatus === "prompt" && (
          <>
            <FolderSync className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-bold text-foreground">Reconnect to "{workspaceName}"</h2>
            <p className="text-sm text-muted-foreground mt-2">
              The browser needs your OK to access the data folder again.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                onClick={() => void reconnectWorkspace()}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-2"
              >
                <FolderSync className="w-4 h-4" />
                Reconnect
              </button>
              <button
                onClick={() => void chooseWorkspaceFolder()}
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-accent"
              >
                Different folder…
              </button>
            </div>
          </>
        )}

        {workspaceStatus === "error" && (
          <>
            <AlertTriangle className="w-10 h-10 mx-auto text-destructive mb-4" />
            <h2 className="text-lg font-bold text-foreground">Couldn't read the data folder</h2>
            <p className="text-sm text-muted-foreground mt-2">{workspaceError}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                onClick={() => void reconnectWorkspace()}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
              >
                Try again
              </button>
              <button
                onClick={() => void disconnectWorkspace()}
                className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-accent"
              >
                Choose a different folder
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
