import { findProjectRoot } from '../../util/paths.js';
import { isDaemonRunning, readPidFile } from '../../daemon/lifecycle.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

export async function statusCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Hypercard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  if (!isDaemonRunning(projectRoot)) {
    outputYaml({ daemon: 'stopped' });
    return;
  }

  try {
    const data = await sendCommand(projectRoot, 'status');
    outputYaml(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputYaml({ daemon: 'error', message: msg });
  }
}
