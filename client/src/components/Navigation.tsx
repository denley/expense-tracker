/*
  DESIGN: Scandinavian Analytical — persistent left nav rail
  - Icon + label navigation with year-scope selector
  - Active state with eucalyptus accent
  - Expanded on desktop (side rail); on phones a bottom bar with the main
    destinations plus a "More" sheet for the rest and the view settings
*/
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Tags, Calendar, TrendingUp, Sun, Moon,
  ReceiptText, Database, Wand2, ArrowLeftRight, Menu, EyeOff,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

/** Phone bottom bar: the weekly chores first; everything else is under "More" */
const MOBILE_TAB_PATHS = ["/", "/transactions", "/categories", "/rules"];
const mobileTabs = MOBILE_TAB_PATHS.map((p) => allItems.find((i) => i.path === p)!);
const moreItems = allItems.filter((i) => !MOBILE_TAB_PATHS.includes(i.path));

export default function Navigation() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { scopeLabel, me, hideOneOffs, setHideOneOffs, hasOneOffSpend } = useExpenses();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreItems.some((i) => i.path === location);

  // Publish the mobile top bar's height so sticky elements below it can sit flush
  const topBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topBar.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--mobile-topbar-h", `${el.offsetHeight}px`)
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
                  <Link key={item.path} href={item.path} aria-current={isActive ? "page" : undefined}>
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
            <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </nav>

      {/* Mobile top bar with scope (theme and one-offs live in the More sheet) */}
      <div ref={topBar} className="lg:hidden sticky top-0 z-40 bg-card/95 backdrop-blur border-b border-border px-4 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-tight text-foreground leading-tight">Expense Tracker</h1>
          <SyncStatus className="text-[11px]" />
        </div>
        <div className="flex items-center gap-2">
          {hideOneOffs && (
            <button
              onClick={() => setHideOneOffs(false)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[11px] font-medium text-muted-foreground whitespace-nowrap"
              title="One-off projects are excluded from totals and charts. Tap to include them again."
            >
              <EyeOff className="w-3.5 h-3.5" />
              One-offs hidden
            </button>
          )}
          <ScopeSelector className="w-[120px]" />
        </div>
      </div>

      {/* Mobile bottom bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 safe-area-inset-bottom">
        <div className="grid grid-cols-5 px-1 py-1.5">
          {mobileTabs.map((item) => {
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path} aria-current={isActive ? "page" : undefined}>
                <div
                  className={cn(
                    "flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium whitespace-nowrap">{item.label}</span>
                </div>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-haspopup="dialog"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[11px] font-medium whitespace-nowrap">
              {moreActive ? allItems.find((i) => i.path === location)!.label : "More"}
            </span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="lg:hidden rounded-t-2xl gap-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="pr-10">
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">Other pages and view settings</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2 px-4">
            {moreItems.map((item) => {
              const isActive = location === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setMoreOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <div
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-xl border text-sm font-medium",
                      isActive ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-foreground active:bg-accent"
                    )}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="mt-4 mx-4 pt-3 border-t border-border space-y-1">
            {oneOffToggle && <div className="-mx-3 [&_label]:text-sm [&_label]:py-2.5">{oneOffToggle}</div>}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-3 py-2.5 text-sm font-medium text-muted-foreground w-full"
            >
              {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
              <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>
            {me && (
              <p className="pt-1 text-xs text-muted-foreground truncate" title={me.login}>
                Signed in as {me.name}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
