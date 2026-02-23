import path from 'node:path';
import {
  initDatabase,
  getAllCards,
  getCardsByType,
  getCardsByTag,
  getOrphanCards,
} from '../../core/db.js';
import { findProjectRoot } from '../../util/paths.js';
import { outputYaml } from '../../util/yaml.js';
import type { ICardListEntry } from '../../core/types.js';
import type Database from 'better-sqlite3';

function cardsToListEntries(db: Database.Database, cards: { id: string; title: string; type: string; tags: string[] }[]): ICardListEntry[] {
  return cards.map((card) => {
    const outCount = (
      db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ?').get(card.id) as { c: number }
    ).c;
    const inCount = (
      db.prepare('SELECT COUNT(*) as c FROM edges WHERE target_id = ?').get(card.id) as { c: number }
    ).c;

    return {
      id: card.id,
      title: card.title,
      type: card.type,
      tags: card.tags,
      links_out: outCount,
      links_in: inCount,
    };
  });
}

export async function lsCommand(options: { type?: string; tag?: string; orphans?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a HyperCard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);

  try {
    let entries: ICardListEntry[];

    if (options.orphans) {
      entries = getOrphanCards(db);
    } else if (options.type) {
      entries = cardsToListEntries(db, getCardsByType(db, options.type));
    } else if (options.tag) {
      entries = cardsToListEntries(db, getCardsByTag(db, options.tag));
    } else {
      entries = cardsToListEntries(db, getAllCards(db));
    }

    outputYaml({
      count: entries.length,
      cards: entries,
    });
  } finally {
    db.close();
  }
}
