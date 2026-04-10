import { findProjectRoot } from '../../util/paths.js';
import { isDaemonRunning } from '../../daemon/lifecycle.js';
import { ensureDaemon } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

export async function startCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Maas project (no .maas/ found)\n');
    process.exit(1);
  }

  if (isDaemonRunning(projectRoot)) {
    outputYaml({ started: false, message: 'Daemon is already running' });
    return;
  }

  try {
    await ensureDaemon(projectRoot);
    outputYaml({ started: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}
