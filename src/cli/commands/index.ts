import path from 'node:path';
import { initDatabase } from '../../core/db.js';
import { indexAllCards, indexSingleCard, checkStaleness } from '../../core/indexer.js';
import { findProjectRoot } from '../../util/paths.js';
import { outputYaml } from '../../util/yaml.js';

export async function indexCommand(options: { only?: string; check?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a HyperCard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);

  try {
    if (options.check) {
      const result = checkStaleness(projectRoot, db);
      outputYaml({
        stale: result.stale.length,
        stale_cards: result.stale,
        missing: result.missing.length,
        missing_cards: result.missing,
        new: result.new_files.length,
        new_files: result.new_files,
      });
    } else if (options.only) {
      indexSingleCard(options.only, projectRoot, db);
      outputYaml({ indexed: options.only });
    } else {
      const stats = indexAllCards(projectRoot, db);
      outputYaml(stats);
    }
  } finally {
    db.close();
  }
}
