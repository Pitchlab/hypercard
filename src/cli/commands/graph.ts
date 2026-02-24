import path from 'node:path';
import { initDatabase, getAllCardIds } from '../../core/db.js';
import { traverseGraph } from '../../core/graph.js';
import { findProjectRoot } from '../../util/paths.js';
import { resolveFuzzyId } from '../../util/fuzzy.js';
import { outputYaml } from '../../util/yaml.js';
import type { IGraphOptions } from '../../core/graph.js';

interface IGraphCommandOptions {
  depth?: string;
  max?: string;
  out?: boolean;
  in?: boolean;
  exclude?: string;
  include?: string;
}

export async function graphCommand(id: string, options: IGraphCommandOptions): Promise<void> {
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

    // Parse depth (clamp 1-3, default 1)
    let depth = options.depth ? parseInt(options.depth, 10) : 1;
    if (isNaN(depth) || depth < 1) depth = 1;
    if (depth > 3) depth = 3;

    // Parse max (clamp 1-50, default 20)
    let max = options.max ? parseInt(options.max, 10) : 20;
    if (isNaN(max) || max < 1) max = 1;
    if (max > 50) max = 50;

    // Parse direction
    let direction: 'both' | 'out' | 'in' = 'both';
    if (options.out) direction = 'out';
    if (options.in) direction = 'in';

    // Parse exclude
    const exclude = options.exclude ? options.exclude.split(',').map((s) => s.trim()) : undefined;

    // Parse include
    let include: Record<string, 'full' | 'summary' | 'meta' | 'id'> | undefined;
    if (options.include) {
      include = {};
      const pairs = options.include.split(',');
      for (const pair of pairs) {
        const [type, detail] = pair.split(':').map((s) => s.trim());
        if (type && detail && ['full', 'summary', 'meta', 'id'].includes(detail)) {
          include[type] = detail as 'full' | 'summary' | 'meta' | 'id';
        }
      }
    }

    const graphOptions: IGraphOptions = {
      rootId: resolved,
      depth,
      max,
      direction,
      exclude,
      include,
    };

    const result = traverseGraph(db, graphOptions);
    outputYaml(result);
  } finally {
    db.close();
  }
}
