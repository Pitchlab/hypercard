import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
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
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Hypercard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  let mode = 'hybrid'; // default: hybrid (auto-falls back to bm25 if no embeddings)
  if (options.bm25) mode = 'bm25';
  if (options.semantic) mode = 'semantic';
  if (options.hybrid) mode = 'hybrid';

  const limit = options.limit ? parseInt(options.limit, 10) : 10;

  try {
    const data = await sendCommand(projectRoot, 'search', {
      query,
      type: options.type,
      tag: options.tag,
      where: options.where,
      limit,
      mode,
    }) as Record<string, unknown>;

    if (data.warning) {
      process.stderr.write(`Warning: ${data.warning}\n`);
      delete data.warning;
    }

    outputYaml(data);
  } catch (err: unknown) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
