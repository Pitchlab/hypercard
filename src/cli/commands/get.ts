import path from 'node:path';
import { initDatabase, getCardById, getAllCardIds, getOutgoingLinks, getIncomingLinks } from '../../core/db.js';
import { findProjectRoot } from '../../util/paths.js';
import { resolveFuzzyId } from '../../util/fuzzy.js';
import { outputYaml } from '../../util/yaml.js';

export async function getCommand(id: string): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a HyperCard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);

  try {
    const allIds = getAllCardIds(db);
    const resolved = resolveFuzzyId(id, allIds);

    if (typeof resolved !== 'string') {
      if (resolved.error === 'ambiguous') {
        outputYaml({ error: 'ambiguous_id', query: id, candidates: resolved.candidates });
      } else {
        outputYaml({ error: 'not_found', query: id });
      }
      process.exit(1);
    }

    const card = getCardById(db, resolved);
    if (!card) {
      outputYaml({ error: 'not_found', query: id });
      process.exit(1);
    }

    const links_out = getOutgoingLinks(db, card.id);
    const links_in = getIncomingLinks(db, card.id);

    outputYaml({
      card: {
        id: card.id,
        path: card.path,
        title: card.title,
        type: card.type,
        tags: card.tags,
        content: card.content,
        links_out,
        links_in,
      },
    });
  } finally {
    db.close();
  }
}
