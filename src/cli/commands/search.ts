import path from 'node:path';
import { initDatabase, searchCardsWithScores } from '../../core/db.js';
import { findProjectRoot } from '../../util/paths.js';
import { outputYaml } from '../../util/yaml.js';

interface ISearchOptions {
  type?: string;
  tag?: string;
  where?: string[];
  limit?: string;
  bm25?: boolean;
  semantic?: boolean;
  hybrid?: boolean;
}

export async function searchCommand(query: string, options: ISearchOptions): Promise<void> {
  if (options.semantic) {
    process.stderr.write('Error: Semantic search not yet implemented (Phase 4)\n');
    process.exit(1);
  }
  if (options.hybrid) {
    process.stderr.write('Error: Hybrid search not yet implemented (Phase 4)\n');
    process.exit(1);
  }

  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a HyperCard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);

  try {
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

    const limit = options.limit ? parseInt(options.limit, 10) : 10;

    const results = searchCardsWithScores(db, query, {
      type: options.type,
      tag: options.tag,
      where: Object.keys(whereFilters).length > 0 ? whereFilters : undefined,
      limit,
    });

    outputYaml({
      query,
      mode: 'bm25',
      count: results.length,
      results,
    });
  } finally {
    db.close();
  }
}
