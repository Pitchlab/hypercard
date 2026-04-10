import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

interface ISuggestLinksOptions {
  limit?: string;
}

export async function suggestLinksCommand(id: string, options: ISuggestLinksOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Maas project (no .maas/ found)\n');
    process.exit(1);
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 10;

  try {
    const data = await sendCommand(projectRoot, 'suggest-links', { id, limit });
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
