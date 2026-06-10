import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

interface ISearchOptions {
  mode?: string;
  type?: string;
  tag?: string;
  where?: string[];
  after?: string;
  before?: string;
  topk?: string;
  format?: string;
  traverse?: string;
}

export async function searchCommand(query: string, options: ISearchOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Hypercard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const topk = options.topk ? parseInt(options.topk, 10) : 10;
  const traverse = options.traverse ? parseInt(options.traverse, 10) : undefined;

  try {
    const data = await sendCommand(projectRoot, 'search', {
      query,
      mode: options.mode ?? 'hybrid',
      type: options.type,
      tag: options.tag,
      where: options.where,
      after: options.after,
      before: options.before,
      topk,
      format: options.format,
      traverse,
    }) as Record<string, unknown>;

    if (data.warning) {
      process.stderr.write(`Warning: ${data.warning}\n`);
      delete data.warning;
    }

    // `list` renders each hit on a single line; other formats stay block-style.
    outputYaml(data, data.format === 'list' ? { flowLevel: 2 } : {});
  } catch (err: unknown) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
