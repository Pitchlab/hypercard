import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

export async function getCommand(id: string): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Maas project (no .maas/ found)\n');
    process.exit(1);
  }

  try {
    const data = await sendCommand(projectRoot, 'get', { id });
    outputYaml(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Ambiguous')) {
      const candidates = msg.match(/Candidates: (.+)/)?.[1]?.split(', ') ?? [];
      outputYaml({ error: 'ambiguous_id', query: id, candidates });
    } else {
      outputYaml({ error: 'not_found', query: id });
    }
    process.exit(1);
  }
}
