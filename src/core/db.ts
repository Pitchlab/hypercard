import Database from 'better-sqlite3';
import type { ICard, IEdge, ICardListEntry } from './types.js';

const SCHEMA = `
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

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// --- Card CRUD ---

const UPSERT_CARD = `
  INSERT INTO cards (id, path, title, type, tags, content, frontmatter, mtime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    path = excluded.path,
    title = excluded.title,
    type = excluded.type,
    tags = excluded.tags,
    content = excluded.content,
    frontmatter = excluded.frontmatter,
    mtime = excluded.mtime
`;

export function upsertCard(db: Database.Database, card: ICard): void {
  db.prepare(UPSERT_CARD).run(
    card.id,
    card.path,
    card.title,
    card.type,
    JSON.stringify(card.tags),
    card.content,
    JSON.stringify(card.frontmatter),
    card.mtime,
  );
}

export function deleteCard(db: Database.Database, cardId: string): void {
  db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
}

export function getCardById(db: Database.Database, cardId: string): ICard | null {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as Record<string, unknown> | undefined;
  return row ? rowToCard(row) : null;
}

export function getAllCardIds(db: Database.Database): string[] {
  const rows = db.prepare('SELECT id FROM cards ORDER BY id').all() as { id: string }[];
  return rows.map((r) => r.id);
}

export function getAllCards(db: Database.Database): ICard[] {
  const rows = db.prepare('SELECT * FROM cards ORDER BY id').all() as Record<string, unknown>[];
  return rows.map(rowToCard);
}

export function getCardsByType(db: Database.Database, type: string): ICard[] {
  const rows = db.prepare('SELECT * FROM cards WHERE type = ? ORDER BY id').all(type) as Record<string, unknown>[];
  return rows.map(rowToCard);
}

export function getCardsByTag(db: Database.Database, tag: string): ICard[] {
  const rows = db
    .prepare(`SELECT * FROM cards WHERE tags LIKE ? ORDER BY id`)
    .all(`%"${tag}"%`) as Record<string, unknown>[];
  return rows.map(rowToCard);
}

// --- Edge CRUD ---

export function insertEdge(db: Database.Database, edge: IEdge): void {
  db.prepare('INSERT OR IGNORE INTO edges (source_id, target_id, context, position) VALUES (?, ?, ?, ?)').run(
    edge.source_id,
    edge.target_id,
    edge.context,
    edge.position,
  );
}

export function deleteEdgesForCard(db: Database.Database, cardId: string): void {
  db.prepare('DELETE FROM edges WHERE source_id = ?').run(cardId);
}

export function getOutgoingLinks(db: Database.Database, cardId: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT target_id FROM edges WHERE source_id = ?')
    .all(cardId) as { target_id: string }[];
  return rows.map((r) => r.target_id);
}

export function getIncomingLinks(db: Database.Database, cardId: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT source_id FROM edges WHERE target_id = ?')
    .all(cardId) as { source_id: string }[];
  return rows.map((r) => r.source_id);
}

export function getOrphanCards(db: Database.Database): ICardListEntry[] {
  const rows = db
    .prepare(
      `SELECT c.*
       FROM cards c
       LEFT JOIN edges e_out ON c.id = e_out.source_id
       LEFT JOIN edges e_in ON c.id = e_in.target_id
       WHERE e_out.source_id IS NULL AND e_in.target_id IS NULL
       ORDER BY c.id`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    type: r.type as string,
    tags: JSON.parse(r.tags as string),
    links_out: 0,
    links_in: 0,
  }));
}

export function getCardListEntry(db: Database.Database, cardId: string): ICardListEntry | null {
  const card = getCardById(db, cardId);
  if (!card) return null;

  const outCount = (
    db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ?').get(cardId) as { c: number }
  ).c;
  const inCount = (
    db.prepare('SELECT COUNT(*) as c FROM edges WHERE target_id = ?').get(cardId) as { c: number }
  ).c;

  return {
    id: card.id,
    title: card.title,
    type: card.type,
    tags: card.tags,
    links_out: outCount,
    links_in: inCount,
  };
}

export function getEdgeCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
}

export function getBrokenLinkCount(db: Database.Database): number {
  return (
    db.prepare('SELECT COUNT(DISTINCT target_id) as c FROM edges WHERE target_id NOT IN (SELECT id FROM cards)').get() as {
      c: number;
    }
  ).c;
}

export function getTypes(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT DISTINCT type FROM cards WHERE type != '' ORDER BY type`).all() as { type: string }[];
  return rows.map((r) => r.type);
}

export function getCardCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) as c FROM cards').get() as { c: number }).c;
}

// --- Helpers ---

function rowToCard(row: Record<string, unknown>): ICard {
  return {
    id: row.id as string,
    path: row.path as string,
    title: row.title as string,
    type: row.type as string,
    tags: JSON.parse(row.tags as string),
    content: row.content as string,
    frontmatter: JSON.parse(row.frontmatter as string),
    mtime: row.mtime as number,
  };
}
