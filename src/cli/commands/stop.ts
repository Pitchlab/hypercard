import { findProjectRoot } from '../../util/paths.js';
import { isDaemonRunning, readPidFile, cleanupDaemonFiles } from '../../daemon/lifecycle.js';
import { outputYaml } from '../../util/yaml.js';

export async function stopCommand(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a HyperCard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const pid = readPidFile(projectRoot);
  if (pid === null || !isDaemonRunning(projectRoot)) {
    outputYaml({ stopped: false, message: 'Daemon is not running' });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    // Wait briefly for cleanup
    await new Promise((r) => setTimeout(r, 500));
    cleanupDaemonFiles(projectRoot);
    outputYaml({ stopped: true, pid });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputYaml({ stopped: false, message: msg });
  }
}
