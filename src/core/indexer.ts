import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import jsYaml from 'js-yaml';
import type Database from 'better-sqlite3';
import type { IIndexStats, IIndexWarning, IStaleCheck, IProgressCallback, IConfig } from './types.js';
import { parseMarkdownFile, extractLinks } from './parser.js';
import { upsertCard, deleteCard, deleteEdgesForCard, insertEdge, getAllCards, upsertEmbedding, deleteEmbedding, getContentHash, getEmbeddedIds, getEmbedding } from './db.js';
import { deriveCardId } from '../util/paths.js';
import type { IEmbedder } from './embedder.js';
import { formatCardText, serializeEmbedding } from './embedder.js';

const DEFAULT_IGNORE = ['.hypercard/**', '**/node_modules/**', '**/.*'];

/**
 * Load ignore patterns from .hypercard/config.yaml watch.exclude, falling back to
 * defaults if the config is missing or malformed. Always unions with '.hypercard/**'
 * and '**\/node_modules/**' so those are never accidentally crawled.
 */
export function loadIgnorePatterns(projectRoot: string): string[] {
  const configPath = path.join(projectRoot, '.hypercard', 'config.yaml');
  const required = ['.hypercard/**', '**/node_modules/**'];
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = jsYaml.load(raw) as IConfig | undefined;
      const configured = config?.watch?.exclude;
      if (Array.isArray(configured) && configured.length > 0) {
        // Normalize legacy top-level 'node_modules/**' to recursive form.
        const normalized = configured.map((p) => (p === 'node_modules/**' ? '**/node_modules/**' : p));
        for (const req of required) {
          if (!normalized.includes(req)) normalized.push(req);
        }
        return normalized;
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_IGNORE;
}

export async function indexAllCards(projectRoot: string, db: Database.Database, embedder?: IEmbedder, onProgress?: IProgressCallback): Promise<IIndexStats> {
  const files = glob.sync('**/*.md', {
    cwd: projectRoot,
    ignore: loadIgnorePatterns(projectRoot),
    absolute: false,
  });

  const existingIds = new Set(
    (db.prepare('SELECT id FROM cards').all() as { id: string }[]).map((r) => r.id),
  );

  // Cards that already have an embedding. Used so cards whose content is
  // unchanged but which never got embedded (e.g. indexed before the embedder
  // had loaded) are still backfilled rather than skipped forever.
  const embeddedIds = new Set(getEmbeddedIds(db));

  let cards_added = 0;
  let cards_updated = 0;
  let edges = 0;
  let embeddings_skipped = 0;
  const cardTexts: { id: string; text: string }[] = [];

  const warnings: IIndexWarning[] = [];

  const transaction = db.transaction(() => {
    const indexedIds = new Set<string>();
    let fileIndex = 0;

    for (const relFile of files) {
      fileIndex++;
      if (onProgress) onProgress('indexing', fileIndex, files.length);

      const absPath = path.join(projectRoot, relFile);

      let card;
      try {
        card = parseMarkdownFile(absPath, projectRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({ file: relFile, error: msg });
        continue;
      }

      indexedIds.add(card.id);

      // Check if content actually changed by comparing SHA hashes
      const storedHash = getContentHash(db, card.id);
      const contentChanged = storedHash !== card.content_hash;

      if (existingIds.has(card.id)) {
        cards_updated++;
      } else {
        cards_added++;
      }

      upsertCard(db, card);

      // Only rebuild edges when content actually changed — otherwise every full
      // reindex needlessly deletes and re-inserts every edge row (and trips the
      // FTS triggers). upsertCard above still refreshes mtime so the staleness
      // check stops flagging this card.
      if (contentChanged) {
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

      // Embed when content changed OR no embedding exists yet (backfill).
      // Unchanged + already-embedded cards are skipped (the optimization).
      if (embedder) {
        if (contentChanged || !embeddedIds.has(card.id)) {
          cardTexts.push({ id: card.id, text: formatCardText(card) });
        } else {
          embeddings_skipped++;
        }
      }
    }

    // Remove cards whose files were deleted
    let cards_deleted = 0;
    for (const existingId of existingIds) {
      if (!indexedIds.has(existingId)) {
        deleteCard(db, existingId);
        deleteEmbedding(db, existingId);
        cards_deleted++;
      }
    }

    return { cards_added, cards_updated, cards_deleted, edges };
  });

  const stats = transaction();

  // Generate embeddings only for changed cards (async, after transaction)
  let embeddings_generated = 0;
  if (embedder && cardTexts.length > 0) {
    for (let i = 0; i < cardTexts.length; i++) {
      if (onProgress) onProgress('embedding', i + 1, cardTexts.length);
      try {
        const vec = await embedder.generateEmbedding(cardTexts[i].text);
        upsertEmbedding(db, cardTexts[i].id, serializeEmbedding(vec));
        embeddings_generated++;
      } catch {
        // Skip failed embeddings silently
      }
    }
  }

  return { ...stats, embeddings_generated, embeddings_skipped, warnings: warnings.length > 0 ? warnings : undefined };
}

export async function indexSingleCard(filePath: string, projectRoot: string, db: Database.Database, embedder?: IEmbedder): Promise<void> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);

  let card;
  try {
    card = parseMarkdownFile(absPath, projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`WARNING: frontmatter in file ${filePath} is malformed — skipping (${msg})`);
    return;
  }

  // Check if content actually changed by comparing SHA hashes
  const storedHash = getContentHash(db, card.id);
  const contentChanged = storedHash !== card.content_hash;

  const transaction = db.transaction(() => {
    upsertCard(db, card);

    // Rebuild edges only when content changed (see indexAllCards rationale).
    if (contentChanged) {
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
    }
  });

  transaction();

  // Generate embedding when content changed OR none exists yet (backfill).
  if (embedder && (contentChanged || !getEmbedding(db, card.id))) {
    try {
      const text = formatCardText(card);
      const vec = await embedder.generateEmbedding(text);
      upsertEmbedding(db, card.id, serializeEmbedding(vec));
    } catch {
      // Skip failed embedding silently
    }
  }
}

export function removeCard(cardId: string, db: Database.Database): void {
  deleteCard(db, cardId);
  deleteEmbedding(db, cardId);
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
    ignore: loadIgnorePatterns(projectRoot),
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
