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

/**
 * Apply rules to transactions. By default only fills in uncategorized
 * transactions; pass overwrite=true to re-categorize everything that matches.
 * `groupOf` resolves a category to its group in the tree.
 * Returns the modified copies (originals untouched).
 */
export function applyRules(
  transactions: StoredTransaction[],
  rules: Rule[],
  groupOf: (category: string) => string,
  options: { overwrite?: boolean } = {}
): { updated: StoredTransaction[]; count: number } {
  const active = rules.filter((r) => r.enabled && r.category);
  const updated: StoredTransaction[] = [];
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
  }
  return { updated, count: updated.length };
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
