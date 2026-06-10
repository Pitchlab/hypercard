import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initDatabase, upsertCard, getCardsFiltered, searchCardsWithScores, insertEdge } from '../src/core/db.js';
import { parseTimestamp, deriveTimestamp, parseDateBoundary, formatDate } from '../src/util/dates.js';
import { shapeSearchResult } from '../src/core/search.js';
import { buildSearchNeighborhood } from '../src/core/graph.js';
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

describe('formatDate', () => {
  it('renders epoch ms as a compact UTC calendar date', () => {
    expect(formatDate(ts('2025-03-15'))).toBe('2025-03-15');
    expect(formatDate(ts('2025-03-15T22:30:00Z'))).toBe('2025-03-15');
  });
});

describe('getCardsFiltered — temporal range', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    upsertCard(db, makeCard({ id: 'log/jan', timestamp: ts('2025-01-15') }));
    upsertCard(db, makeCard({ id: 'log/feb', timestamp: ts('2025-02-15') }));
    upsertCard(db, makeCard({ id: 'log/mar', timestamp: ts('2025-03-15') }));
    upsertCard(db, makeCard({ id: 'log/apr', timestamp: ts('2025-04-15') }));
  });

  it('filters with --after (inclusive lower bound)', () => {
    const cards = getCardsFiltered(db, { after: ts('2025-03-01') });
    expect(cards.map((c) => c.id)).toEqual(['log/apr', 'log/mar']);
  });

  it('filters with --before (inclusive upper bound)', () => {
    const cards = getCardsFiltered(db, { before: ts('2025-02-20') });
    expect(cards.map((c) => c.id).sort()).toEqual(['log/feb', 'log/jan']);
  });

  it('filters with an after+before range', () => {
    const cards = getCardsFiltered(db, { after: ts('2025-02-01'), before: ts('2025-03-31') });
    expect(cards.map((c) => c.id).sort()).toEqual(['log/feb', 'log/mar']);
  });

  it('respects a limit (default order by id)', () => {
    const cards = getCardsFiltered(db, { type: 'log', limit: 2 });
    expect(cards.map((c) => c.id)).toEqual(['log/apr', 'log/feb']);
  });
});

describe('searchCardsWithScores — temporal filtering', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    upsertCard(db, makeCard({ id: 'log/old', content: 'crimson battle report', timestamp: ts('2024-01-01') }));
    upsertCard(db, makeCard({ id: 'log/new', content: 'crimson battle report', timestamp: ts('2025-06-01') }));
  });

  it('restricts full-text results by --after', () => {
    const results = searchCardsWithScores(db, 'crimson', { after: ts('2025-01-01') });
    expect(results.map((r) => r.id)).toEqual(['log/new']);
  });

  it('restricts full-text results by --before', () => {
    const results = searchCardsWithScores(db, 'crimson', { before: ts('2025-01-01') });
    expect(results.map((r) => r.id)).toEqual(['log/old']);
  });

  it('exposes the card timestamp on results', () => {
    const results = searchCardsWithScores(db, 'crimson', {});
    expect(results.every((r) => typeof r.timestamp === 'number')).toBe(true);
  });
});

describe('shapeSearchResult — output formats', () => {
  const r: ISearchResult = {
    id: 'log/mar',
    title: 'March Report',
    type: 'log',
    tags: ['report'],
    score: 0.51,
    snippet: 'a crimson banner',
    timestamp: ts('2025-03-15'),
  };

  it('list: compact one-liner fields, timestamp as date, no snippet', () => {
    const out = shapeSearchResult(r, 'list');
    expect(out).toEqual({ id: 'log/mar', title: 'March Report', timestamp: '2025-03-15', tags: ['report'], score: 0.51 });
    expect(out).not.toHaveProperty('snippet');
    expect(out).not.toHaveProperty('content');
  });

  it('summary (default): includes type + snippet, no content', () => {
    const out = shapeSearchResult(r, 'summary');
    expect(out.type).toBe('log');
    expect(out.snippet).toBe('a crimson banner');
    expect(out).not.toHaveProperty('content');
  });

  it('full: summary + full content', () => {
    const out = shapeSearchResult(r, 'full', 'the whole card body');
    expect(out.snippet).toBe('a crimson banner');
    expect(out.content).toBe('the whole card body');
  });
});

describe('buildSearchNeighborhood — traverse', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    upsertCard(db, makeCard({ id: 'n/a', timestamp: ts('2025-01-01') }));
    upsertCard(db, makeCard({ id: 'n/b', timestamp: ts('2025-02-01') }));
    upsertCard(db, makeCard({ id: 'n/c', timestamp: ts('2025-03-01') }));
    // a → b, b → c, c → a (cycle)
    insertEdge(db, { source_id: 'n/a', target_id: 'n/b', context: '', position: 0 });
    insertEdge(db, { source_id: 'n/b', target_id: 'n/c', context: '', position: 0 });
    insertEdge(db, { source_id: 'n/c', target_id: 'n/a', context: '', position: 0 });
  });

  it('depth 1: direct out and in links as compact nodes', () => {
    const hood = buildSearchNeighborhood(db, 'n/a', 1);
    expect(hood.links_out.map((n) => n.id)).toEqual(['n/b']); // a → b
    expect(hood.links_in.map((n) => n.id)).toEqual(['n/c']); // c → a

    const b = hood.links_out[0];
    expect(b).toEqual({ id: 'n/b', title: 'n/b', type: 'n', timestamp: '2025-02-01', tags: [] });
    expect(b).not.toHaveProperty('score');
    expect(b).not.toHaveProperty('snippet');
  });

  it('depth 1 does not nest deeper links', () => {
    const hood = buildSearchNeighborhood(db, 'n/a', 1);
    expect(hood.links_out[0]).not.toHaveProperty('links_out');
  });

  it('depth 2 nests the next hop and avoids revisiting the hit', () => {
    const hood = buildSearchNeighborhood(db, 'n/a', 2);
    const b = hood.links_out[0]; // a → b
    expect(b.links_out?.map((n) => n.id)).toEqual(['n/c']); // b → c
    // c → a would revisit the hit (a), so it must not reappear
    expect(b.links_in?.map((n) => n.id) ?? []).not.toContain('n/a');
  });
});

describe('initDatabase — timestamp migration on pre-temporal DBs', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-migrate-'));
    dbPath = path.join(dir, 'old.db');

    // Build a DB with the OLD schema: cards table without a `timestamp` column.
    const old = new Database(dbPath);
    old.pragma('journal_mode = WAL');
    // Faithful pre-temporal schema: cards (no timestamp) + the external-content
    // FTS5 table AND its sync triggers, so the FTS shadow stays consistent
    // (exactly what real old hypercard DBs look like).
    old.exec(`
      CREATE TABLE cards (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT, type TEXT NOT NULL,
        tags TEXT DEFAULT '[]', content TEXT NOT NULL, frontmatter TEXT DEFAULT '{}',
        mtime REAL NOT NULL, content_hash TEXT
      );
      CREATE VIRTUAL TABLE cards_fts USING fts5(id, title, tags, content, content=cards, content_rowid=rowid, tokenize='porter unicode61');
      CREATE TRIGGER cards_ai AFTER INSERT ON cards BEGIN
        INSERT INTO cards_fts(rowid, id, title, tags, content) VALUES (new.rowid, new.id, new.title, new.tags, new.content);
      END;
      CREATE TRIGGER cards_ad AFTER DELETE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, id, title, tags, content) VALUES ('delete', old.rowid, old.id, old.title, old.tags, old.content);
      END;
      CREATE TRIGGER cards_au AFTER UPDATE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, id, title, tags, content) VALUES ('delete', old.rowid, old.id, old.title, old.tags, old.content);
        INSERT INTO cards_fts(rowid, id, title, tags, content) VALUES (new.rowid, new.id, new.title, new.tags, new.content);
      END;
    `);
    old
      .prepare('INSERT INTO cards (id,path,title,type,tags,content,frontmatter,mtime,content_hash) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('notes/a', 'notes/a.md', 'Note A', 'notes', '[]', 'old body', '{}', ts('2023-05-05'), 'hash');
    old.close();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('migrates without throwing (regression: index DDL used to run before the column existed)', () => {
    expect(() => initDatabase(dbPath)).not.toThrow();
  });

  it('adds the timestamp column, backfills from mtime, and creates the index', () => {
    const db = initDatabase(dbPath);
    const cols = (db.pragma('table_info(cards)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('timestamp');

    const row = db.prepare('SELECT timestamp, mtime FROM cards WHERE id = ?').get('notes/a') as {
      timestamp: number;
      mtime: number;
    };
    expect(row.timestamp).toBe(row.mtime); // backfilled

    const indexes = (db.pragma('index_list(cards)') as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain('idx_cards_timestamp');
    db.close();
  });

  it('lets temporal range queries run on a migrated DB', () => {
    const db = initDatabase(dbPath);
    expect(() => getCardsFiltered(db, { after: ts('2020-01-01') })).not.toThrow();
    const hits = getCardsFiltered(db, { after: ts('2020-01-01') });
    expect(hits.map((c) => c.id)).toEqual(['notes/a']);
    db.close();
  });
});
