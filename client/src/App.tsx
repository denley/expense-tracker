import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Router } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ExpenseProvider, useExpenses } from "./contexts/ExpenseContext";
import Navigation from "./components/Navigation";
import WorkspaceGate from "./components/WorkspaceGate";
import LoadingState from "./components/LoadingState";
import Dashboard from "./pages/Dashboard";
import Categories from "./pages/Categories";
import Monthly from "./pages/Monthly";
import Trends from "./pages/Trends";
import Transactions from "./pages/Transactions";
import Import from "./pages/Import";
import Rules from "./pages/Rules";
import Data from "./pages/Data";

// Derive base path from Vite's base config (e.g. "/expense-tracking/")
// Remove trailing slash for wouter compatibility
const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";

function Routes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/transactions" component={Transactions} />
      <Route path="/categories" component={Categories} />
      <Route path="/monthly" component={Monthly} />
      <Route path="/trends" component={Trends} />
      <Route path="/import" component={Import} />
      <Route path="/rules" component={Rules} />
      <Route path="/data" component={Data} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** Gate the whole app until a data folder is connected */
function AppContent() {
  const { workspaceStatus } = useExpenses();

  if (workspaceStatus === "checking") {
    return (
      <main className="container py-6">
        <LoadingState />
      </main>
    );
  }

  if (workspaceStatus !== "connected") {
    return (
      <main className="container py-6">
        <WorkspaceGate />
      </main>
    );
  }

  return (
    <>
      <Navigation />
      {/* Main content area with left padding for desktop nav */}
      <main className="lg:pl-[220px] pb-20 lg:pb-8">
        <div className="container py-6">
          <Routes />
        </div>
      </main>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <ExpenseProvider>
            <Router base={base === "/" ? undefined : base}>
              <Toaster />
              <AppContent />
            </Router>
          </ExpenseProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
