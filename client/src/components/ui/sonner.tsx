import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Below lg the app has a fixed bottom nav bar; toasts sit above it
const BOTTOM_NAV_QUERY = "(max-width: 1023px)";
const ABOVE_NAV = { bottom: "calc(80px + env(safe-area-inset-bottom))" };

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const [hasBottomNav, setHasBottomNav] = useState(
    () => typeof window !== "undefined" && window.matchMedia(BOTTOM_NAV_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(BOTTOM_NAV_QUERY);
    const onChange = () => setHasBottomNav(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      offset={hasBottomNav ? ABOVE_NAV : undefined}
      mobileOffset={ABOVE_NAV}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
