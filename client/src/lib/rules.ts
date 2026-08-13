/*
  Auto-categorisation rules: match transaction descriptions and assign a
  category (the group follows from the category tree). Applied on import
  and on demand.
*/
import type { Rule, StoredTransaction } from "./types";
import { UNCATEGORIZED } from "./types";

export function ruleMatches(rule: Rule, description: string): boolean {
  if (!rule.pattern) return false;
  if (rule.isRegex) {
    try {
      return new RegExp(rule.pattern, "i").test(description);
    } catch {
      return false;
    }
  }
  return description.toLowerCase().includes(rule.pattern.toLowerCase());
}

/** One transaction re-categorised by a rule run — enough detail to review and undo it */
export interface RuleChange {
  id: string;
  from: string;
  to: string;
  pattern: string;
}

/**
 * Apply rules to transactions. By default only fills in uncategorized
 * transactions; pass overwrite=true to re-categorize everything that matches.
 * `groupOf` resolves a category to its group in the tree.
 * Returns the modified copies (originals untouched) plus a change log.
 */
export function applyRules(
  transactions: StoredTransaction[],
  rules: Rule[],
  groupOf: (category: string) => string,
  options: { overwrite?: boolean } = {}
): { updated: StoredTransaction[]; count: number; changes: RuleChange[] } {
  const active = rules.filter((r) => r.enabled && r.category);
  const updated: StoredTransaction[] = [];
  const changes: RuleChange[] = [];
  for (const txn of transactions) {
    const isUncat = !txn.category || txn.category === UNCATEGORIZED;
    if (!options.overwrite && !isUncat) continue;
    const rule = active.find((r) => ruleMatches(r, txn.description));
    if (!rule || rule.category === txn.category) continue;
    updated.push({
      ...txn,
      category: rule.category,
      group: groupOf(rule.category),
    });
    changes.push({ id: txn.id, from: txn.category, to: rule.category, pattern: rule.pattern });
  }
  return { updated, count: updated.length, changes };
}

/**
 * Learn candidate rules from already-categorized data: recurring merchant
 * substrings that map consistently to one category.
 */
export function suggestRulesFromHistory(
  transactions: StoredTransaction[],
  existingRules: Rule[],
  /** e.g. categories belonging to archived projects */
  excludeCategory: (category: string) => boolean = () => false
): Array<{ pattern: string; category: string; count: number }> {
  const byMerchant = new Map<string, { categories: Map<string, number>; count: number }>();
  for (const t of transactions) {
    if (!t.category || t.category === UNCATEGORIZED) continue;
    if (excludeCategory(t.category)) continue;
    const key = normalizeMerchant(t.description);
    if (key.length < 4) continue;
    if (!byMerchant.has(key)) {
      byMerchant.set(key, { categories: new Map(), count: 0 });
    }
    const m = byMerchant.get(key)!;
    m.categories.set(t.category, (m.categories.get(t.category) || 0) + 1);
    m.count++;
  }
  const existing = new Set(existingRules.map((r) => r.pattern.toLowerCase()));
  const suggestions: Array<{ pattern: string; category: string; count: number }> = [];
  for (const [pattern, m] of byMerchant) {
    if (m.count < 3) continue;
    if (existing.has(pattern.toLowerCase())) continue;
    const [topCategory, topCount] = [...m.categories.entries()].sort((a, b) => b[1] - a[1])[0];
    // Only suggest if the merchant maps to one category at least 90% of the time
    if (topCount / m.count < 0.9) continue;
    suggestions.push({ pattern, category: topCategory, count: m.count });
  }
  return suggestions.sort((a, b) => b.count - a.count);
}

export interface UncatSuggestion {
  pattern: string;
  /** Uncategorised transactions this pattern would cover */
  count: number;
  /** Category guess when the same merchant is consistently categorised elsewhere */
  suggestedCategory?: string;
}

/**
 * Mine the uncategorised pile for recurring keywords / key-phrases, ranked by
 * how many transactions each would cover (greedy set cover, so suggestions
 * don't overlap). Transactions an enabled rule already matches are excluded —
 * "Apply Rules" handles those. Each suggestion seeds the rule dialog; the
 * dialog's live match preview is the validation step.
 */
export function suggestPatternsForUncategorised(
  transactions: Array<{ id: string; description: string; category: string }>,
  rules: Rule[],
  limit = 8
): UncatSuggestion[] {
  const active = rules.filter((r) => r.enabled && r.category);
  const uncat = transactions.filter(
    (t) =>
      (!t.category || t.category === UNCATEGORIZED) &&
      !active.some((r) => ruleMatches(r, t.description))
  );
  if (uncat.length === 0) return [];

  // Candidate patterns: the normalized merchant, its first token, first two tokens
  const existingPatterns = new Set(rules.map((r) => r.pattern.trim().toLowerCase()));
  const candidates = new Map<string, string>(); // lowercase key → display form
  for (const t of uncat) {
    const merchant = normalizeMerchant(t.description);
    const tokens = merchant.split(" ");
    for (const cand of [merchant, tokens[0], tokens.slice(0, 2).join(" ")]) {
      if (!cand || cand.length < 4) continue;
      const key = cand.toLowerCase();
      if (existingPatterns.has(key)) continue;
      if (!candidates.has(key)) candidates.set(key, cand);
    }
  }

  // Who does each candidate cover? (substring match, same as rule matching)
  const coverage = Array.from(candidates.entries()).map(([key, display]) => ({
    display,
    ids: uncat.filter((t) => t.description.toLowerCase().includes(key)).map((t) => t.id),
  }));

  // Greedy: repeatedly take the pattern covering the most uncovered transactions.
  // Ties prefer the shorter pattern — same coverage today, catches more variants later.
  const covered = new Set<string>();
  const picked: Array<{ display: string; count: number }> = [];
  while (picked.length < limit) {
    let best: { display: string; count: number } | null = null;
    for (const c of coverage) {
      const n = c.ids.filter((id) => !covered.has(id)).length;
      if (n < 2) continue;
      if (
        !best ||
        n > best.count ||
        (n === best.count && c.display.length < best.display.length)
      ) {
        best = { display: c.display, count: n };
      }
    }
    if (!best) break;
    picked.push(best);
    const chosen = coverage.find((c) => c.display === best!.display)!;
    chosen.ids.forEach((id) => covered.add(id));
  }

  // Guess a category from how the same pattern is categorised elsewhere
  return picked.map(({ display, count }) => {
    const key = display.toLowerCase();
    const cats = new Map<string, number>();
    let total = 0;
    for (const t of transactions) {
      if (!t.category || t.category === UNCATEGORIZED) continue;
      if (!t.description.toLowerCase().includes(key)) continue;
      cats.set(t.category, (cats.get(t.category) || 0) + 1);
      total++;
    }
    const top = [...cats.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      pattern: display,
      count,
      suggestedCategory: top && total >= 2 && top[1] / total >= 0.9 ? top[0] : undefined,
    };
  });
}

/** Strip payment-processor noise and location suffixes from raw bank descriptions */
export function normalizeMerchant(description: string): string {
  return description
    .replace(/^(AplPay|GooglePay|PayPal \*?|SQ \*?|SP \*?|Visa Purchase|EFTPOS)\s*/i, "")
    .replace(/\s{2,}.*$/, "") // bank exports pad location with runs of spaces
    .replace(/\s+(AU|AUS|NS|VIC|QLD|SA|WA)\s*$/i, "")
    .replace(/[#*]\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
