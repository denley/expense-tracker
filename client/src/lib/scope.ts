/*
  Global time scope. Persisted as a single string in settings:
  - "all"                          → everything
  - "2025"                         → one calendar year
  - "range:2024-06-01:2025-08-13"  → inclusive custom date range (ISO dates)
*/

export type Scope =
  | { kind: "all" }
  | { kind: "year"; year: string }
  | { kind: "range"; from: string; to: string };

export function parseScope(s: string): Scope {
  if (!s || s === "all") return { kind: "all" };
  if (s.startsWith("range:")) {
    const [, from = "", to = ""] = s.split(":");
    if (!from && !to) return { kind: "all" };
    return { kind: "range", from, to };
  }
  return { kind: "year", year: s };
}

export function encodeRange(from: string, to: string): string {
  return `range:${from}:${to}`;
}

export function scopeContains(scope: Scope, dateStr: string): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "year":
      return dateStr.startsWith(scope.year + "-");
    case "range":
      return (!scope.from || dateStr >= scope.from) && (!scope.to || dateStr <= scope.to);
  }
}

function fmtShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function scopeLabelOf(scope: Scope): string {
  switch (scope.kind) {
    case "all":
      return "All time";
    case "year":
      return scope.year;
    case "range":
      if (scope.from && scope.to) return `${fmtShort(scope.from)} – ${fmtShort(scope.to)}`;
      if (scope.from) return `From ${fmtShort(scope.from)}`;
      return `Until ${fmtShort(scope.to)}`;
  }
}
