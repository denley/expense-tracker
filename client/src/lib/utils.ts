import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatCurrencyExact(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-AU");
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Heading for a day's group in the transaction lists, e.g. "Thu, 9 Oct 2026" */
export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** formatDate for an ISO "yyyy-mm-dd" string (parsed as local, not UTC) */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return formatDate(new Date(y, m - 1, d));
}

export function formatMonthYear(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}
