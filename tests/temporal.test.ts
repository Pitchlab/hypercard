import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, upsertCard, getCardsFiltered, searchCardsWithScores } from '../src/core/db.js';
import { parseTimestamp, deriveTimestamp, parseDateBoundary } from '../src/util/dates.js';
import { fuseTemporal } from '../src/core/search.js';
import type { ICard, ISearchResult } from '../src/core/types.js';

const DAY = 24 * 60 * 60 * 1000;

function ts(isoDate: string): number {
  return Date.parse(isoDate);
}

function makeCard(overrides: Partial<ICard> & Pick<ICard, 'id'>): ICard {
  return {
    path: `${overrides.id}.md`,
    title: overrides.id,
    type: overrides.id.split('/')[0],
    tags: [],
    content: `Content for ${overrides.id}`,
    frontmatter: {},
    mtime: ts('2025-01-01'),
    timestamp: ts('2025-01-01'),
    content_hash: '',
    ...overrides,
  };
}

describe('parseTimestamp', () => {
  it('parses ISO date strings', () => {
    expect(parseTimestamp('2025-06-10')).toBe(Date.parse('2025-06-10'));
    expect(parseTimestamp('2025-06-10T12:00:00Z')).toBe(Date.parse('2025-06-10T12:00:00Z'));
  });

  it('treats numbers and all-digit strings as epoch ms', () => {
    expect(parseTimestamp(1718000000000)).toBe(1718000000000);
    expect(parseTimestamp('1718000000000')).toBe(1718000000000);
  });

  it('reads Date instances (as gray-matter yields for unquoted YAML dates)', () => {
    const d = new Date('2025-02-14T00:00:00Z');
    expect(parseTimestamp(d)).toBe(d.getTime());
  });

  it('returns null for unparseable or empty input', () => {
    expect(parseTimestamp('not a date')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp({})).toBeNull();
  });
});

describe('deriveTimestamp', () => {
  it('prefers creation-style frontmatter keys over modification keys', () => {
    const fm = { created: '2025-03-01', modified: '2025-09-01' };
    expect(deriveTimestamp(fm, ts('2020-01-01'))).toBe(ts('2025-03-01'));
  });

  it('uses `date` as the highest-priority key', () => {
    const fm = { date: '2025-05-05', created: '2025-01-01' };
    expect(deriveTimestamp(fm, ts('2020-01-01'))).toBe(ts('2025-05-05'));
  });

  it('falls back to mtime when no usable date field exists', () => {
    expect(deriveTimestamp({ tags: ['x'] }, ts('2021-07-07'))).toBe(ts('2021-07-07'));
  });

  it('skips a malformed date field and falls back', () => {
    expect(deriveTimestamp({ date: 'whenever' }, ts('2021-07-07'))).toBe(ts('2021-07-07'));
  });
});

describe('parseDateBoundary', () => {
  it('pushes a bare date to end-of-day when endOfDay is set', () => {
    const start = parseDateBoundary('2025-06-10');
    const end = parseDateBoundary('2025-06-10', { endOfDay: true });
    expect(start).toBe(ts('2025-06-10'));
    expect(end).toBe(ts('2025-06-10') + DAY - 1);
  });

  it('does not shift a full datetime even with endOfDay', () => {
    const v = '2025-06-10T08:30:00Z';
    expect(parseDateBoundary(v, { endOfDay: true })).toBe(Date.parse(v));
  });

  it('returns null for invalid input', () => {
    expect(parseDateBoundary('garbage')).toBeNull();
  });
});

describe('getCardsFiltered — temporal range and proximity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    upsertCard(db, makeCard({ id: 'log/jan', timestamp: ts('2025-01-15') }));
    upsertCard(db, makeCard({ id: 'log/feb', timestamp: ts('2025-02-15') }));
    upsertCard(db, makeCard({ id: 'log/mar', timestamp: ts('2025-03-15') }));
    upsertCard(db, makeCard({ id: 'log/apr', timestamp: ts('2025-04-15') }));
  });

  it('filters with --since (inclusive lower bound)', () => {
    const cards = getCardsFiltered(db, { since: ts('2025-03-01') });
    expect(cards.map((c) => c.id)).toEqual(['log/apr', 'log/mar']);
  });

  it('filters with --until (inclusive upper bound)', () => {
    const cards = getCardsFiltered(db, { until: ts('2025-02-20') });
    expect(cards.map((c) => c.id).sort()).toEqual(['log/feb', 'log/jan']);
  });

  it('filters with a since+until range', () => {
    const cards = getCardsFiltered(db, { since: ts('2025-02-01'), until: ts('2025-03-31') });
    expect(cards.map((c) => c.id).sort()).toEqual(['log/feb', 'log/mar']);
  });

  it('orders by temporal proximity with --around (nearest first)', () => {
    const cards = getCardsFiltered(db, { around: ts('2025-03-10') });
    // mar (5d) < feb (~23d) < apr (~36d) < jan (~54d)
    expect(cards.map((c) => c.id)).toEqual(['log/mar', 'log/feb', 'log/apr', 'log/jan']);
  });

  it('combines proximity ordering with a type filter and limit', () => {
    const cards = getCardsFiltered(db, { around: ts('2025-04-30'), type: 'log', limit: 2 });
    expect(cards.map((c) => c.id)).toEqual(['log/apr', 'log/mar']);
  });
});

describe('searchCardsWithScores — temporal filtering', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    upsertCard(db, makeCard({ id: 'log/old', content: 'crimson battle report', timestamp: ts('2024-01-01') }));
    upsertCard(db, makeCard({ id: 'log/new', content: 'crimson battle report', timestamp: ts('2025-06-01') }));
  });

  it('restricts full-text results by --since', () => {
    const results = searchCardsWithScores(db, 'crimson', { since: ts('2025-01-01') });
    expect(results.map((r) => r.id)).toEqual(['log/new']);
  });

  it('exposes the card timestamp on results for fusion', () => {
    const results = searchCardsWithScores(db, 'crimson', {});
    expect(results.every((r) => typeof r.timestamp === 'number')).toBe(true);
  });
});

describe('fuseTemporal', () => {
  function result(id: string, timestamp: number): ISearchResult {
    return { id, title: id, type: 'log', tags: [], score: 0, snippet: '', timestamp };
  }

  it('ranks closest-in-time card best and reorders the list', () => {
    // Relevance order: a, b, c. But c is temporally nearest the anchor.
    const base = [
      result('a', ts('2025-01-01')),
      result('b', ts('2025-06-01')),
      result('c', ts('2025-03-10')),
    ];
    const anchor = ts('2025-03-12');
    const fused = fuseTemporal(base, anchor, 10);

    const c = fused.find((r) => r.id === 'c')!;
    expect(c.temporal_rank).toBe(1);
    // RRF (k=60) is a balanced fusion: nearest-in-time alone doesn't override a
    // large relevance gap, but c (relevance rank 3, temporal rank 1) climbs past
    // b (relevance rank 2, temporal rank 3).
    const order = fused.map((r) => r.id);
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('b'));
  });

  it('slices to the requested limit', () => {
    const base = [
      result('a', ts('2025-01-01')),
      result('b', ts('2025-02-01')),
      result('c', ts('2025-03-01')),
    ];
    const fused = fuseTemporal(base, ts('2025-02-15'), 2);
    expect(fused).toHaveLength(2);
  });
});
