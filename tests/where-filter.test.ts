import Database from 'better-sqlite3';
import {
  initDatabase,
  upsertCard,
  getCardsByWhere,
  getCardsFiltered,
} from '../src/core/db.js';
import type { ICard } from '../src/core/types.js';

describe('WHERE filter functionality', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Initialize schema
    const schema = `
      CREATE TABLE IF NOT EXISTS cards (
        id          TEXT PRIMARY KEY,
        path        TEXT NOT NULL,
        title       TEXT,
        type        TEXT NOT NULL,
        tags        TEXT DEFAULT '[]',
        content     TEXT NOT NULL,
        frontmatter TEXT DEFAULT '{}',
        mtime       REAL NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
        id,
        title,
        tags,
        content,
        content=cards,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
        INSERT INTO cards_fts(rowid, id, title, tags, content)
        VALUES (new.rowid, new.id, new.title, new.tags, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, id, title, tags, content)
        VALUES ('delete', old.rowid, old.id, old.title, old.tags, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, id, title, tags, content)
        VALUES ('delete', old.rowid, old.id, old.title, old.tags, old.content);
        INSERT INTO cards_fts(rowid, id, title, tags, content)
        VALUES (new.rowid, new.id, new.title, new.tags, new.content);
      END;

      CREATE TABLE IF NOT EXISTS cards_vec (
        id        TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
        embedding BLOB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        source_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL,
        context   TEXT,
        position  INTEGER,
        PRIMARY KEY (source_id, target_id, position)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
    `;
    db.exec(schema);
  });

  afterEach(() => {
    db.close();
  });

  const createCard = (
    id: string,
    type: string,
    frontmatter: Record<string, unknown> = {},
    tags: string[] = [],
  ): ICard => ({
    id,
    path: `${id}.md`,
    title: id,
    type,
    tags,
    content: `Content for ${id}`,
    frontmatter,
    mtime: Date.now(),
  });

  describe('getCardsByWhere', () => {
    it('should filter cards by single frontmatter key', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      const card2 = createCard('factions/empire', 'factions', { status: 'published' });
      const card3 = createCard('factions/alliance', 'factions', { status: 'draft' });

      upsertCard(db, card1);
      upsertCard(db, card2);
      upsertCard(db, card3);

      const results = getCardsByWhere(db, { status: 'draft' });

      expect(results).toHaveLength(2);
      expect(results.map((c) => c.id).sort()).toEqual(['factions/alliance', 'factions/rebels']);
    });

    it('should filter cards by multiple frontmatter keys (AND logic)', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft', era: 'medieval' });
      const card2 = createCard('factions/empire', 'factions', { status: 'draft', era: 'modern' });
      const card3 = createCard('factions/alliance', 'factions', { status: 'published', era: 'medieval' });
      const card4 = createCard('factions/trade', 'factions', { status: 'draft', era: 'medieval' });

      upsertCard(db, card1);
      upsertCard(db, card2);
      upsertCard(db, card3);
      upsertCard(db, card4);

      const results = getCardsByWhere(db, { status: 'draft', era: 'medieval' });

      expect(results).toHaveLength(2);
      expect(results.map((c) => c.id).sort()).toEqual(['factions/rebels', 'factions/trade']);
    });

    it('should return empty array for non-existent key', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      upsertCard(db, card1);

      const results = getCardsByWhere(db, { nonexistent: 'value' });

      expect(results).toHaveLength(0);
    });

    it('should return empty array for non-existent value', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      upsertCard(db, card1);

      const results = getCardsByWhere(db, { status: 'nonexistent' });

      expect(results).toHaveLength(0);
    });

    it('should return all cards when filters object is empty', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      const card2 = createCard('factions/empire', 'factions', { status: 'published' });

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsByWhere(db, {});

      expect(results).toHaveLength(2);
    });

    it('should handle nested frontmatter values as strings', () => {
      const card1 = createCard('factions/rebels', 'factions', { priority: 'high' });
      const card2 = createCard('factions/empire', 'factions', { priority: 'low' });

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsByWhere(db, { priority: 'high' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });
  });

  describe('getCardsFiltered', () => {
    it('should combine type filter with where filters', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      const card2 = createCard('characters/luke', 'characters', { status: 'draft' });
      const card3 = createCard('factions/empire', 'factions', { status: 'published' });

      upsertCard(db, card1);
      upsertCard(db, card2);
      upsertCard(db, card3);

      const results = getCardsFiltered(db, {
        type: 'factions',
        where: { status: 'draft' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });

    it('should combine tag filter with where filters', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' }, ['military']);
      const card2 = createCard('factions/empire', 'factions', { status: 'draft' }, ['political']);
      const card3 = createCard('factions/alliance', 'factions', { status: 'published' }, ['military']);

      upsertCard(db, card1);
      upsertCard(db, card2);
      upsertCard(db, card3);

      const results = getCardsFiltered(db, {
        tag: 'military',
        where: { status: 'draft' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });

    it('should combine type, tag, and where filters', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft', era: 'medieval' }, ['military']);
      const card2 = createCard('factions/empire', 'factions', { status: 'draft', era: 'modern' }, ['military']);
      const card3 = createCard('characters/luke', 'characters', { status: 'draft', era: 'medieval' }, ['military']);
      const card4 = createCard('factions/trade', 'factions', { status: 'draft', era: 'medieval' }, ['economic']);

      upsertCard(db, card1);
      upsertCard(db, card2);
      upsertCard(db, card3);
      upsertCard(db, card4);

      const results = getCardsFiltered(db, {
        type: 'factions',
        tag: 'military',
        where: { status: 'draft', era: 'medieval' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });

    it('should return all cards when no filters are provided', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      const card2 = createCard('characters/luke', 'characters', { status: 'published' });

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsFiltered(db, {});

      expect(results).toHaveLength(2);
    });

    it('should filter by type only', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      const card2 = createCard('characters/luke', 'characters', { status: 'draft' });

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsFiltered(db, { type: 'factions' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });

    it('should filter by tag only', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' }, ['military']);
      const card2 = createCard('factions/empire', 'factions', { status: 'draft' }, ['political']);

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsFiltered(db, { tag: 'military' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });

    it('should filter by where only', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      const card2 = createCard('factions/empire', 'factions', { status: 'published' });

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsFiltered(db, { where: { status: 'draft' } });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });

    it('should return empty when filters match nothing', () => {
      const card1 = createCard('factions/rebels', 'factions', { status: 'draft' });
      upsertCard(db, card1);

      const results = getCardsFiltered(db, {
        type: 'characters',
        where: { status: 'draft' },
      });

      expect(results).toHaveLength(0);
    });

    it('should handle multiple where filters with complex values', () => {
      const card1 = createCard('factions/rebels', 'factions', {
        status: 'draft',
        era: 'medieval',
        priority: 'high',
        region: 'north',
      });
      const card2 = createCard('factions/empire', 'factions', {
        status: 'draft',
        era: 'medieval',
        priority: 'low',
        region: 'north',
      });

      upsertCard(db, card1);
      upsertCard(db, card2);

      const results = getCardsFiltered(db, {
        where: {
          status: 'draft',
          era: 'medieval',
          priority: 'high',
          region: 'north',
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('factions/rebels');
    });
  });
});
