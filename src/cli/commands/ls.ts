import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

export async function lsCommand(options: {
  type?: string;
  tag?: string;
  orphans?: boolean;
  where?: string[];
  search?: string;
}): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Hypercard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  try {
    const data = await sendCommand(projectRoot, 'ls', {
      type: options.type,
      tag: options.tag,
      orphans: options.orphans,
      where: options.where,
      search: options.search,
    });
    outputYaml(data);
  } catch (err: unknown) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
