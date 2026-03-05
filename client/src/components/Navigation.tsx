/*
  DESIGN: Scandinavian Analytical — persistent left nav rail
  - Icon + label navigation
  - Active state with eucalyptus accent
  - Compact on mobile (bottom bar), expanded on desktop (side rail)
*/
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Tags, Calendar, TrendingUp, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/categories", label: "Categories", icon: Tags },
  { path: "/monthly", label: "Monthly", icon: Calendar },
  { path: "/trends", label: "Trends", icon: TrendingUp },
];

export default function Navigation() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      {/* Desktop side rail */}
      <nav className="hidden lg:flex fixed left-0 top-0 bottom-0 w-[220px] flex-col bg-card border-r border-border z-40">
        <div className="p-6 pb-4">
          <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">
            Expense<br />Tracker
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium">2025 Overview</p>
        </div>

        <div className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
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

        <div className="p-3 border-t border-border">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 w-full"
          >
            {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </button>
        </div>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 safe-area-inset-bottom">
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-all duration-200",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
          <button
            onClick={toggleTheme}
            className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-muted-foreground transition-all duration-200"
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            <span className="text-[10px] font-medium">Theme</span>
          </button>
        </div>
      </nav>
    </>
  );
}
