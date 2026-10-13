/** Text helpers shared by the analysis and report modules. */

/**
 * Normalize rule text for comparison: lowercase, strip punctuation and
 * backticks, collapse whitespace.
 */
export function normalizeRuleText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word tokens of a rule (normalized). */
export function tokenizeRule(text: string): string[] {
  const norm = normalizeRuleText(text);
  return norm === '' ? [] : norm.split(' ');
}

/** Token set of a rule. */
export function tokenSet(text: string): Set<string> {
  return new Set(tokenizeRule(text));
}

/** Jaccard similarity of two token sets, between 0 and 1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Truncate a string for use in messages. */
export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 3) + '...';
}

/** Format a number with thousands separators (deterministic). */
export function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}