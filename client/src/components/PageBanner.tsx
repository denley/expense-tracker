/*
  The gradient band at the top of the analysis pages (Dashboard, Categories,
  Monthly, Trends): page title, one line of context and the current time
  scope. Kept slim (≈88px) so the page's own content starts high up.
*/
import { motion } from "framer-motion";
import { useExpenses } from "@/contexts/ExpenseContext";

interface Props {
  title: string;
  subtitle?: string;
  /** Replaces the time scope shown on the right (e.g. "2025" when all data is in one year) */
  scope?: string;
}

export default function PageBanner({ title, subtitle, scope }: Props) {
  const { scopeLabel } = useExpenses();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative rounded-2xl overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--color-sandstone),transparent_55%),linear-gradient(120deg,var(--color-eucalyptus),var(--color-ocean))]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#2d3436]/80 via-[#2d3436]/50 to-transparent" />
      <div className="relative z-10 flex items-center justify-between gap-4 px-5 py-4 lg:px-7 lg:min-h-[88px]">
        <div className="min-w-0">
          <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight leading-tight">{title}</h2>
          {subtitle && <p className="text-white/70 text-xs lg:text-sm mt-0.5 truncate">{subtitle}</p>}
        </div>
        {/* Below lg the top bar's scope selector sits right above this */}
        <span className="hidden lg:inline-block shrink-0 px-2.5 py-1 rounded-full bg-white/15 text-white text-xs font-semibold">
          {scope ?? scopeLabel}
        </span>
      </div>
    </motion.div>
  );
}
