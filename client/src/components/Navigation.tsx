/*
  DESIGN: Scandinavian Analytical — persistent left nav rail
  - Icon + label navigation with year-scope selector
  - Active state with eucalyptus accent
  - Compact on mobile (scrollable bottom bar), expanded on desktop (side rail)
*/
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Tags, Calendar, TrendingUp, Sun, Moon,
  ReceiptText, Database, Wand2, ArrowLeftRight,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useExpenses } from "@/contexts/ExpenseContext";
import ScopeSelector from "@/components/ScopeSelector";
import SyncStatus from "@/components/SyncStatus";
import { cn } from "@/lib/utils";

const navSections = [
  {
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/transactions", label: "Transactions", icon: ReceiptText },
    ],
  },
  {
    title: "Analyse",
    items: [
      { path: "/categories", label: "Categories", icon: Tags },
      { path: "/monthly", label: "Monthly", icon: Calendar },
      { path: "/trends", label: "Trends", icon: TrendingUp },
      { path: "/compare", label: "Compare", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Manage",
    items: [
      { path: "/rules", label: "Rules", icon: Wand2 },
      { path: "/data", label: "Data", icon: Database },
    ],
  },
];

const allItems = navSections.flatMap((s) => s.items);

export default function Navigation() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { scopeLabel, me, hideOneOffs, setHideOneOffs, hasOneOffSpend } = useExpenses();

  const oneOffToggle = (hasOneOffSpend || hideOneOffs) && (
    <label
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-pointer select-none"
      title="Exclude one-off cost centres (trips, renovations…) from totals and trend charts"
    >
      <input
        type="checkbox"
        checked={hideOneOffs}
        onChange={(e) => setHideOneOffs(e.target.checked)}
        className="accent-[var(--color-eucalyptus)]"
      />
      Hide one-offs ◈
    </label>
  );

  return (
    <>
      {/* Desktop side rail */}
      <nav className="hidden lg:flex fixed left-0 top-0 bottom-0 w-[220px] flex-col bg-card border-r border-border z-40">
        <div className="p-6 pb-3">
          <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">
            Expense<br />Tracker
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium truncate">{scopeLabel}</p>
          <SyncStatus className="mt-1" />
        </div>

        <div className="px-3 pb-2">
          <ScopeSelector />
          {oneOffToggle}
        </div>

        <div className="flex-1 px-3 space-y-4 overflow-y-auto">
          {navSections.map((section, si) => (
            <div key={si} className="space-y-1">
              {section.title && (
                <p className="px-3 pt-1 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => {
                const isActive = location === item.path;
                return (
                  <Link key={item.path} href={item.path}>
                    <div
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <item.icon className="w-[18px] h-[18px] shrink-0" />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-border">
          {me && (
            <p className="px-3 pb-1 text-[11px] text-muted-foreground truncate" title={me.login}>
              Signed in as {me.name}
            </p>
          )}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 w-full"
          >
            {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </button>
        </div>
      </nav>

      {/* Mobile top bar with scope + theme */}
      <div className="lg:hidden sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border px-4 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-tight text-foreground leading-tight">Expense Tracker</h1>
          <SyncStatus className="text-[10px]" />
        </div>
        <div className="flex items-center gap-2">
          <ScopeSelector className="w-[120px]" />
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile bottom bar — horizontally scrollable */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 safe-area-inset-bottom">
        <div className="flex items-center px-1 py-2 overflow-x-auto">
          {allItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all duration-200 min-w-[62px]",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[9px] font-medium whitespace-nowrap">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
