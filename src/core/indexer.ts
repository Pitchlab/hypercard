import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import type Database from 'better-sqlite3';
import type { IIndexStats, IStaleCheck } from './types.js';
import { parseMarkdownFile, extractLinks } from './parser.js';
import { upsertCard, deleteCard, deleteEdgesForCard, insertEdge, getAllCards } from './db.js';
import { deriveCardId } from '../util/paths.js';

export function indexAllCards(projectRoot: string, db: Database.Database): IIndexStats {
  const files = glob.sync('**/*.md', {
    cwd: projectRoot,
    ignore: ['.hypercard/**', 'node_modules/**', '**/.*'],
    absolute: false,
  });

  const existingIds = new Set(
    (db.prepare('SELECT id FROM cards').all() as { id: string }[]).map((r) => r.id),
  );

  let cards_added = 0;
  let cards_updated = 0;
  let edges = 0;

  const transaction = db.transaction(() => {
    const indexedIds = new Set<string>();

    for (const relFile of files) {
      const absPath = path.join(projectRoot, relFile);
      const card = parseMarkdownFile(absPath, projectRoot);
      indexedIds.add(card.id);

      if (existingIds.has(card.id)) {
        cards_updated++;
      } else {
        cards_added++;
      }

      upsertCard(db, card);
      deleteEdgesForCard(db, card.id);

      const links = extractLinks(card.content);
      for (const link of links) {
        insertEdge(db, {
          source_id: card.id,
          target_id: link.target_id,
          context: link.context,
          position: link.position,
        });
        edges++;
      }
    }

    // Remove cards whose files were deleted
    let cards_deleted = 0;
    for (const existingId of existingIds) {
      if (!indexedIds.has(existingId)) {
        deleteCard(db, existingId);
        cards_deleted++;
      }
    }

    return { cards_added, cards_updated, cards_deleted, edges };
  });

  return transaction();
}

export function indexSingleCard(filePath: string, projectRoot: string, db: Database.Database): void {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const card = parseMarkdownFile(absPath, projectRoot);

  const transaction = db.transaction(() => {
    upsertCard(db, card);
    deleteEdgesForCard(db, card.id);

    const links = extractLinks(card.content);
    for (const link of links) {
      insertEdge(db, {
        source_id: card.id,
        target_id: link.target_id,
        context: link.context,
        position: link.position,
      });
    }
  });

  transaction();
}

export function removeCard(cardId: string, db: Database.Database): void {
  deleteCard(db, cardId);
}

export function checkStaleness(projectRoot: string, db: Database.Database): IStaleCheck {
  const cards = getAllCards(db);
  const stale: string[] = [];
  const missing: string[] = [];

  for (const card of cards) {
    const absPath = path.join(projectRoot, card.path);
    if (!fs.existsSync(absPath)) {
      missing.push(card.id);
      continue;
    }
    const stat = fs.statSync(absPath);
    if (Math.abs(stat.mtimeMs - card.mtime) > 1) {
      stale.push(card.id);
    }
  }

  // Find new files not in DB
  const existingIds = new Set(cards.map((c) => c.id));
  const files = glob.sync('**/*.md', {
    cwd: projectRoot,
    ignore: ['.hypercard/**', 'node_modules/**', '**/.*'],
    absolute: false,
  });

  const new_files: string[] = [];
  for (const relFile of files) {
    const absPath = path.join(projectRoot, relFile);
    const id = deriveCardId(absPath, projectRoot);
    if (!existingIds.has(id)) {
      new_files.push(relFile);
    }
  }

  return { stale, missing, new_files };
}
