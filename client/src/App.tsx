import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ExpenseProvider } from "./contexts/ExpenseContext";
import Navigation from "./components/Navigation";
import Dashboard from "./pages/Dashboard";
import Categories from "./pages/Categories";
import Monthly from "./pages/Monthly";
import Trends from "./pages/Trends";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/categories" component={Categories} />
      <Route path="/monthly" component={Monthly} />
      <Route path="/trends" component={Trends} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <ExpenseProvider>
            <Toaster />
            <Navigation />
            {/* Main content area with left padding for desktop nav */}
            <main className="lg:pl-[220px] pb-20 lg:pb-8">
              <div className="container py-6">
                <Router />
              </div>
            </main>
          </ExpenseProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
