import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

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

  let depth = options.depth ? parseInt(options.depth, 10) : 1;
  if (isNaN(depth) || depth < 1) depth = 1;
  if (depth > 3) depth = 3;

  let max = options.max ? parseInt(options.max, 10) : 20;
  if (isNaN(max) || max < 1) max = 1;
  if (max > 50) max = 50;

  let direction: string = 'both';
  if (options.out) direction = 'out';
  if (options.in) direction = 'in';

  const exclude = options.exclude ? options.exclude.split(',').map((s) => s.trim()) : undefined;

  let include: Record<string, string> | undefined;
  if (options.include) {
    include = {};
    const pairs = options.include.split(',');
    for (const pair of pairs) {
      const [type, detail] = pair.split(':').map((s) => s.trim());
      if (type && detail && ['full', 'summary', 'meta', 'id'].includes(detail)) {
        include[type] = detail;
      }
    }
  }

  try {
    const data = await sendCommand(projectRoot, 'graph', {
      id,
      depth,
      max,
      direction,
      exclude,
      include,
    });
    outputYaml(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Ambiguous')) {
      const candidates = msg.match(/Candidates: (.+)/)?.[1]?.split(', ') ?? [];
      outputYaml({ error: 'ambiguous_id', query: id, candidates });
    } else if (msg.includes('not found')) {
      outputYaml({ error: 'not_found', query: id });
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    process.exit(1);
  }
}
