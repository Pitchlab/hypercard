import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, upsertCard, searchCards, searchCardsFiltered } from '../src/core/db.js';
import type { ICard } from '../src/core/types.js';

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
    content_hash: '',
    ...overrides,
  };
}

describe('searchCards', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('should return cards matching FTS5 search query', () => {
    upsertCard(
      db,
      createTestCard({
        id: 'factions/crimson',
        title: 'Crimson Order',
        type: 'factions',
        content: 'A militaristic faction known for their crimson armor.',
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'factions/azure',
        title: 'Azure Alliance',
        type: 'factions',
        content: 'A peaceful trading coalition.',
      }),
    );

    const results = searchCards(db, 'crimson');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('factions/crimson');
  });

  it('should search across title, content, and tags', () => {
    upsertCard(
      db,
      createTestCard({
        id: 'characters/warrior',
        title: 'The Great Warrior',
        type: 'characters',
        content: 'A legendary fighter.',
        tags: ['hero'],
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'items/sword',
        title: 'Ancient Sword',
        type: 'items',
        content: 'A weapon of great power.',
        tags: ['warrior', 'legendary'],
      }),
    );

    const results = searchCards(db, 'warrior');
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['characters/warrior', 'items/sword']);
  });

  it('should rank results by BM25 score', () => {
    upsertCard(
      db,
      createTestCard({
        id: 'best-match',
        title: 'Military Military Military',
        content: 'Military organization.',
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'weak-match',
        title: 'Civilian Life',
        content: 'Some mention of military.',
      }),
    );

    const results = searchCards(db, 'military');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('best-match');
  });

  it('should return empty array when no matches', () => {
    upsertCard(
      db,
      createTestCard({
        id: 'test',
        content: 'Nothing relevant here.',
      }),
    );

    const results = searchCards(db, 'nonexistent');
    expect(results).toHaveLength(0);
  });

  it('should support FTS5 porter stemming', () => {
    upsertCard(
      db,
      createTestCard({
        id: 'test',
        content: 'The fighters are fighting in the battles.',
      }),
    );

    const results1 = searchCards(db, 'fight');
    expect(results1).toHaveLength(1);

    const results2 = searchCards(db, 'battle');
    expect(results2).toHaveLength(1);
  });
});

describe('searchCardsFiltered', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');

    upsertCard(
      db,
      createTestCard({
        id: 'factions/crimson',
        title: 'Crimson Order',
        type: 'factions',
        tags: ['military', 'antagonist'],
        content: 'A militaristic faction with crimson armor.',
        frontmatter: { status: 'published', era: 'ancient' },
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'factions/azure',
        title: 'Azure Alliance',
        type: 'factions',
        tags: ['trade', 'protagonist'],
        content: 'A peaceful trading coalition.',
        frontmatter: { status: 'draft', era: 'modern' },
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'characters/warrior',
        title: 'Crimson Warrior',
        type: 'characters',
        tags: ['military', 'antagonist'],
        content: 'A fierce fighter from the Crimson Order.',
        frontmatter: { status: 'published', era: 'ancient' },
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'characters/merchant',
        title: 'Azure Merchant',
        type: 'characters',
        tags: ['trade', 'protagonist'],
        content: 'A wealthy trader from the Azure Alliance.',
        frontmatter: { status: 'published', era: 'modern' },
      }),
    );
  });

  it('should combine search with type filter', () => {
    const results = searchCardsFiltered(db, 'crimson', { type: 'factions' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('factions/crimson');
  });

  it('should combine search with tag filter', () => {
    const results = searchCardsFiltered(db, 'crimson', { tag: 'military' });
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['characters/warrior', 'factions/crimson']);
  });

  it('should combine search with where filter', () => {
    const results = searchCardsFiltered(db, 'Azure', { where: { status: 'published' } });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('characters/merchant');
  });

  it('should combine search with multiple filters', () => {
    const results = searchCardsFiltered(db, 'military', {
      type: 'characters',
      tag: 'antagonist',
      where: { status: 'published', era: 'ancient' },
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('characters/warrior');
  });

  it('should return empty when filters match nothing', () => {
    const results = searchCardsFiltered(db, 'crimson', {
      type: 'items',
    });
    expect(results).toHaveLength(0);
  });

  it('should work with only type filter (no tag/where)', () => {
    const results = searchCardsFiltered(db, 'alliance', { type: 'factions' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('factions/azure');
  });

  it('should work with only tag filter (no type/where)', () => {
    const results = searchCardsFiltered(db, 'warrior', { tag: 'military' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('characters/warrior');
  });

  it('should work with only where filter (no type/tag)', () => {
    const results = searchCardsFiltered(db, 'Azure', { where: { era: 'modern' } });
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['characters/merchant', 'factions/azure']);
  });

  it('should respect BM25 ranking with filters', () => {
    upsertCard(
      db,
      createTestCard({
        id: 'best-match',
        title: 'Military Military Military',
        type: 'factions',
        content: 'Military organization.',
      }),
    );

    upsertCard(
      db,
      createTestCard({
        id: 'weak-match',
        title: 'Civilian Faction',
        type: 'factions',
        content: 'Some mention of military.',
      }),
    );

    const results = searchCardsFiltered(db, 'military', { type: 'factions' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('best-match');
  });
});
