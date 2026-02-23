import type { IFuzzyMatch } from '../core/types.js';

export function fuzzyMatchId(query: string, allIds: string[]): IFuzzyMatch[] {
  const q = query.toLowerCase();
  const matches: IFuzzyMatch[] = [];

  for (const id of allIds) {
    const lower = id.toLowerCase();

    if (lower === q) {
      matches.push({ id, score: 1.0 });
    } else if (lower.endsWith('/' + q) || lower.endsWith(q)) {
      matches.push({ id, score: 0.9 });
    } else if (lower.includes('/' + q) || lower.includes('_' + q) || lower.includes(q + '_')) {
      matches.push({ id, score: 0.8 });
    } else if (lower.includes(q)) {
      matches.push({ id, score: 0.5 });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function resolveFuzzyId(
  query: string,
  allIds: string[],
): string | { error: 'ambiguous'; candidates: string[] } | { error: 'not_found' } {
  if (allIds.includes(query)) return query;

  const matches = fuzzyMatchId(query, allIds);
  if (matches.length === 0) return { error: 'not_found' };
  if (matches.length === 1) return matches[0].id;

  // If top match has strictly higher score, use it
  if (matches[0].score > matches[1].score) return matches[0].id;

  return { error: 'ambiguous', candidates: matches.map((m) => m.id) };
}
