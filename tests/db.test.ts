import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initDatabase,
  upsertCard,
  deleteCard,
  getCardById,
  getAllCardIds,
  getAllCards,
  getCardsByType,
  getCardsByTag,
  insertEdge,
  deleteEdgesForCard,
  getOutgoingLinks,
  getIncomingLinks,
  getOrphanCards,
  getCardListEntry,
  getEdgeCount,
  getBrokenLinkCount,
  getTypes,
  getCardCount,
} from '../src/core/db.js';
import type { ICard, IEdge } from '../src/core/types.js';

function createTestCard(overrides: Partial<ICard> = {}): ICard {
  return {
    id: 'test/card',
    path: 'test/card.md',
    title: 'Test Card',
    type: 'test',
    tags: ['sample'],
    content: 'Test content',
    frontmatter: {},
    mtime: Date.now(),
    ...overrides,
  };
}

describe('initDatabase', () => {
  it('should create schema on fresh DB', () => {
    const db = initDatabase(':memory:');

    // Check main tables exist
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('cards');
    expect(tableNames).toContain('cards_fts');
    expect(tableNames).toContain('cards_vec');
    expect(tableNames).toContain('edges');

    db.close();
  });

  it('should enable WAL mode', () => {
    const db = initDatabase(':memory:');
    const result = db.pragma('journal_mode', { simple: true });
    expect(result).toBe('memory'); // :memory: DB uses memory mode, WAL on disk
    db.close();
  });

  it('should enable foreign keys', () => {
    const db = initDatabase(':memory:');
    const result = db.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
    db.close();
  });

  it('should create indexes', () => {
    const db = initDatabase(':memory:');
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_edges_target');
    expect(indexNames).toContain('idx_edges_source');
    expect(indexNames).toContain('idx_cards_type');

    db.close();
  });
});

describe('Card CRUD', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('should insert and retrieve a card round-trip', () => {
    const card = createTestCard({
      id: 'characters/voss',
      title: 'Commander Voss',
      type: 'characters',
      tags: ['military', 'protagonist'],
      frontmatter: { age: 42, rank: 'Commander' },
    });

    upsertCard(db, card);
    const retrieved = getCardById(db, 'characters/voss');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('characters/voss');
    expect(retrieved?.title).toBe('Commander Voss');
    expect(retrieved?.type).toBe('characters');
    expect(retrieved?.tags).toEqual(['military', 'protagonist']);
    expect(retrieved?.frontmatter).toEqual({ age: 42, rank: 'Commander' });
  });

  it('should update existing card on conflict', () => {
    const card1 = createTestCard({ id: 'test/card', title: 'Original Title' });
    upsertCard(db, card1);

    const card2 = createTestCard({ id: 'test/card', title: 'Updated Title' });
    upsertCard(db, card2);

    const retrieved = getCardById(db, 'test/card');
    expect(retrieved?.title).toBe('Updated Title');
    expect(getCardCount(db)).toBe(1);
  });

  it('should delete a card', () => {
    const card = createTestCard({ id: 'test/delete' });
    upsertCard(db, card);

    expect(getCardById(db, 'test/delete')).not.toBeNull();
    deleteCard(db, 'test/delete');
    expect(getCardById(db, 'test/delete')).toBeNull();
  });

  it('should return null for non-existent card', () => {
    expect(getCardById(db, 'does/not/exist')).toBeNull();
  });

  it('should get all card IDs ordered', () => {
    upsertCard(db, createTestCard({ id: 'zebra' }));
    upsertCard(db, createTestCard({ id: 'alpha' }));
    upsertCard(db, createTestCard({ id: 'beta' }));

    const ids = getAllCardIds(db);
    expect(ids).toEqual(['alpha', 'beta', 'zebra']);
  });

  it('should get all cards', () => {
    upsertCard(db, createTestCard({ id: 'card1' }));
    upsertCard(db, createTestCard({ id: 'card2' }));

    const cards = getAllCards(db);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.id)).toEqual(['card1', 'card2']);
  });

  it('should filter cards by type', () => {
    upsertCard(db, createTestCard({ id: 'characters/alice', type: 'characters' }));
    upsertCard(db, createTestCard({ id: 'characters/bob', type: 'characters' }));
    upsertCard(db, createTestCard({ id: 'factions/rebels', type: 'factions' }));

    const chars = getCardsByType(db, 'characters');
    expect(chars).toHaveLength(2);
    expect(chars.map((c) => c.id)).toEqual(['characters/alice', 'characters/bob']);
  });

  it('should filter cards by tag', () => {
    upsertCard(db, createTestCard({ id: 'card1', tags: ['red', 'blue'] }));
    upsertCard(db, createTestCard({ id: 'card2', tags: ['red'] }));
    upsertCard(db, createTestCard({ id: 'card3', tags: ['green'] }));

    const redCards = getCardsByTag(db, 'red');
    expect(redCards).toHaveLength(2);
    expect(redCards.map((c) => c.id).sort()).toEqual(['card1', 'card2']);
  });

  it('should get card count', () => {
    expect(getCardCount(db)).toBe(0);
    upsertCard(db, createTestCard({ id: 'card1' }));
    expect(getCardCount(db)).toBe(1);
    upsertCard(db, createTestCard({ id: 'card2' }));
    expect(getCardCount(db)).toBe(2);
  });

  it('should get distinct types', () => {
    upsertCard(db, createTestCard({ id: 'a', type: 'characters' }));
    upsertCard(db, createTestCard({ id: 'b', type: 'characters' }));
    upsertCard(db, createTestCard({ id: 'c', type: 'factions' }));
    upsertCard(db, createTestCard({ id: 'd', type: '' }));

    const types = getTypes(db);
    expect(types).toEqual(['characters', 'factions']);
  });
});

describe('FTS5 search integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('should sync insert to FTS5 via trigger', () => {
    const card = createTestCard({
      id: 'search/test',
      title: 'Searchable Title',
      content: 'This content contains unique_search_term for testing.',
    });

    upsertCard(db, card);

    const results = db
      .prepare('SELECT id FROM cards_fts WHERE cards_fts MATCH ?')
      .all('unique_search_term') as { id: string }[];

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('search/test');
  });

  it('should sync update to FTS5 via trigger', () => {
    const card1 = createTestCard({ id: 'test', content: 'original content' });
    upsertCard(db, card1);

    const card2 = createTestCard({ id: 'test', content: 'updated_unique_term content' });
    upsertCard(db, card2);

    const results = db
      .prepare('SELECT id FROM cards_fts WHERE cards_fts MATCH ?')
      .all('updated_unique_term') as { id: string }[];

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('test');
  });

  it('should sync delete to FTS5 via trigger', () => {
    const card = createTestCard({ id: 'test', content: 'deletable_term' });
    upsertCard(db, card);

    let results = db
      .prepare('SELECT id FROM cards_fts WHERE cards_fts MATCH ?')
      .all('deletable_term') as { id: string }[];
    expect(results).toHaveLength(1);

    deleteCard(db, 'test');

    results = db
      .prepare('SELECT id FROM cards_fts WHERE cards_fts MATCH ?')
      .all('deletable_term') as { id: string }[];
    expect(results).toHaveLength(0);
  });

  it('should search in tags', () => {
    const card = createTestCard({ id: 'test', tags: ['sci-fi', 'space-opera'] });
    upsertCard(db, card);

    const results = db
      .prepare('SELECT id FROM cards_fts WHERE cards_fts MATCH ?')
      .all('space') as { id: string }[];

    expect(results).toHaveLength(1);
  });
});

describe('Edge CRUD', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    // Add cards to satisfy foreign key constraints
    upsertCard(db, createTestCard({ id: 'source' }));
    upsertCard(db, createTestCard({ id: 'target' }));
  });

  it('should insert and query edge by source/target', () => {
    const edge: IEdge = {
      source_id: 'source',
      target_id: 'target',
      context: 'Link context here',
      position: 42,
    };

    insertEdge(db, edge);

    const outgoing = getOutgoingLinks(db, 'source');
    expect(outgoing).toEqual(['target']);

    const incoming = getIncomingLinks(db, 'target');
    expect(incoming).toEqual(['source']);
  });

  it('should handle duplicate edges gracefully (INSERT OR IGNORE)', () => {
    const edge: IEdge = {
      source_id: 'source',
      target_id: 'target',
      context: 'Context',
      position: 10,
    };

    insertEdge(db, edge);
    insertEdge(db, edge);

    expect(getEdgeCount(db)).toBe(1);
  });

  it('should delete all edges for a card', () => {
    upsertCard(db, createTestCard({ id: 'multi' }));
    insertEdge(db, { source_id: 'source', target_id: 'multi', context: '', position: 1 });
    insertEdge(db, { source_id: 'source', target_id: 'target', context: '', position: 2 });

    expect(getEdgeCount(db)).toBe(2);
    deleteEdgesForCard(db, 'source');
    expect(getEdgeCount(db)).toBe(0);
  });

  it('should get distinct outgoing links', () => {
    insertEdge(db, { source_id: 'source', target_id: 'target', context: 'ctx1', position: 1 });
    insertEdge(db, { source_id: 'source', target_id: 'target', context: 'ctx2', position: 2 });

    const links = getOutgoingLinks(db, 'source');
    expect(links).toEqual(['target']);
  });

  it('should cascade delete edges when card is deleted', () => {
    insertEdge(db, { source_id: 'source', target_id: 'target', context: '', position: 1 });
    expect(getEdgeCount(db)).toBe(1);

    deleteCard(db, 'source');
    expect(getEdgeCount(db)).toBe(0);
  });

  it('should count broken links (targets not in cards)', () => {
    insertEdge(db, { source_id: 'source', target_id: 'target', context: '', position: 1 });
    insertEdge(db, { source_id: 'source', target_id: 'missing1', context: '', position: 2 });
    insertEdge(db, { source_id: 'source', target_id: 'missing2', context: '', position: 3 });

    expect(getBrokenLinkCount(db)).toBe(2);
  });
});

describe('Orphan card detection', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('should detect cards with no incoming or outgoing edges', () => {
    upsertCard(db, createTestCard({ id: 'orphan1', title: 'Orphan 1' }));
    upsertCard(db, createTestCard({ id: 'orphan2', title: 'Orphan 2' }));
    upsertCard(db, createTestCard({ id: 'connected', title: 'Connected' }));

    insertEdge(db, { source_id: 'connected', target_id: 'external', context: '', position: 1 });

    const orphans = getOrphanCards(db);
    expect(orphans).toHaveLength(2);
    expect(orphans.map((o) => o.id).sort()).toEqual(['orphan1', 'orphan2']);
    expect(orphans[0].links_out).toBe(0);
    expect(orphans[0].links_in).toBe(0);
  });

  it('should not include cards with incoming links', () => {
    upsertCard(db, createTestCard({ id: 'source' }));
    upsertCard(db, createTestCard({ id: 'target' }));

    insertEdge(db, { source_id: 'source', target_id: 'target', context: '', position: 1 });

    const orphans = getOrphanCards(db);
    expect(orphans.map((o) => o.id)).not.toContain('target');
  });

  it('should not include cards with outgoing links', () => {
    upsertCard(db, createTestCard({ id: 'source' }));
    insertEdge(db, { source_id: 'source', target_id: 'external', context: '', position: 1 });

    const orphans = getOrphanCards(db);
    expect(orphans.map((o) => o.id)).not.toContain('source');
  });
});

describe('Card list entry', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('should return card with link counts', () => {
    upsertCard(db, createTestCard({ id: 'test', title: 'Test', tags: ['a', 'b'] }));
    upsertCard(db, createTestCard({ id: 'in1' }));
    insertEdge(db, { source_id: 'test', target_id: 'out1', context: '', position: 1 });
    insertEdge(db, { source_id: 'test', target_id: 'out2', context: '', position: 2 });
    insertEdge(db, { source_id: 'in1', target_id: 'test', context: '', position: 1 });

    const entry = getCardListEntry(db, 'test');

    expect(entry).not.toBeNull();
    expect(entry?.id).toBe('test');
    expect(entry?.title).toBe('Test');
    expect(entry?.tags).toEqual(['a', 'b']);
    expect(entry?.links_out).toBe(2);
    expect(entry?.links_in).toBe(1);
  });

  it('should return null for non-existent card', () => {
    expect(getCardListEntry(db, 'missing')).toBeNull();
  });
});
