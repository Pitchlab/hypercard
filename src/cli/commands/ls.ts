import path from 'node:path';
import {
  initDatabase,
  getAllCards,
  getCardsByType,
  getCardsByTag,
  getOrphanCards,
  getCardsFiltered,
  searchCardsFiltered,
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

export async function lsCommand(options: {
  type?: string;
  tag?: string;
  orphans?: boolean;
  where?: string[];
  search?: string;
}): Promise<void> {
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
    } else {
      // Parse --where filters
      const whereFilters: Record<string, string> = {};
      if (options.where && options.where.length > 0) {
        for (const filter of options.where) {
          const match = filter.match(/^([^=]+)=(.*)$/);
          if (!match) {
            process.stderr.write(`Error: Invalid --where format "${filter}". Expected key=value\n`);
            process.exit(1);
          }
          const [, key, value] = match;
          whereFilters[key.trim()] = value.trim();
        }
      }

      // Use FTS5 search if --search is provided
      if (options.search) {
        const cards = searchCardsFiltered(db, options.search, {
          type: options.type,
          tag: options.tag,
          where: Object.keys(whereFilters).length > 0 ? whereFilters : undefined,
        });
        entries = cardsToListEntries(db, cards);
      } else if (options.type || options.tag || Object.keys(whereFilters).length > 0) {
        // Use regular filtered query
        const cards = getCardsFiltered(db, {
          type: options.type,
          tag: options.tag,
          where: Object.keys(whereFilters).length > 0 ? whereFilters : undefined,
        });
        entries = cardsToListEntries(db, cards);
      } else {
        entries = cardsToListEntries(db, getAllCards(db));
      }
    }

    outputYaml({
      count: entries.length,
      cards: entries,
    });
  } finally {
    db.close();
  }
}
