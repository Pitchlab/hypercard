/**
 * Temporal layer helpers — turning the heterogeneous date material in cards
 * (YAML frontmatter dates, file mtimes, CLI boundary strings) into a single
 * comparable numeric timestamp (epoch milliseconds).
 *
 * This is the "pre-processed at index-time" half of the temporal layer: every
 * card gets one canonical timestamp so temporal proximity and range queries are
 * plain numeric comparisons, never string/date parsing at query time.
 */

/**
 * Frontmatter keys that carry a card's canonical date, in priority order.
 * Creation-style keys win over modification-style keys; the first one that
 * parses to a valid timestamp is used.
 */
const DATE_FRONTMATTER_KEYS = [
  'date',
  'created',
  'created_at',
  'published',
  'published_at',
  'timestamp',
  'updated',
  'updated_at',
  'modified',
  'modified_at',
] as const;

/**
 * Parse an arbitrary value into epoch milliseconds, or null if it is not a
 * usable date.
 *
 * - numbers / all-digit strings are treated as epoch **milliseconds** (matching
 *   how file mtimes are stored)
 * - Date instances (gray-matter/js-yaml parse unquoted YAML dates into these)
 *   are read directly
 * - other strings go through Date.parse (handles ISO 8601 and date-only forms)
 */
export function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return null;
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }

  return null;
}

/**
 * Derive a card's canonical timestamp from its frontmatter, falling back to the
 * file's modification time when no usable date field is present.
 */
export function deriveTimestamp(frontmatter: Record<string, unknown>, mtime: number): number {
  for (const key of DATE_FRONTMATTER_KEYS) {
    if (key in frontmatter) {
      const t = parseTimestamp(frontmatter[key]);
      if (t !== null) return t;
    }
  }
  return mtime;
}

/**
 * Parse a CLI date boundary (--since / --until). When the input is a bare
 * calendar date (YYYY-MM-DD) and `endOfDay` is set, the boundary is pushed to
 * the last millisecond of that day so `--until 2025-06-10` includes everything
 * that happened on the 10th. Returns null for unparseable input.
 */
export function parseDateBoundary(input: string, opts: { endOfDay?: boolean } = {}): number | null {
  const t = parseTimestamp(input);
  if (t === null) return null;

  if (opts.endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return t + 24 * 60 * 60 * 1000 - 1;
  }
  return t;
}
