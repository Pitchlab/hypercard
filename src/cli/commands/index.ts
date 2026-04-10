import { findProjectRoot } from '../../util/paths.js';
import { sendCommand } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

function progressBar(current: number, total: number, width = 30): string {
  const ratio = current / total;
  const filled = Math.round(ratio * width);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  const pct = Math.round(ratio * 100);
  return `[${bar}] ${pct}% (${current}/${total})`;
}

export async function indexCommand(options: { only?: string; check?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Maas project (no .maas/ found)\n');
    process.exit(1);
  }

  try {
    if (!options.check && process.stderr.isTTY) {
      process.stderr.write(options.only ? `Indexing ${options.only}...\n` : 'Indexing...\n');
    } else if (!options.check) {
      process.stderr.write(options.only ? `Indexing ${options.only}...` : 'Indexing all cards...');
    }

    const onProgress = process.stderr.isTTY
      ? (phase: string, current: number, total: number) => {
          process.stderr.write(`\r  ${phase}: ${progressBar(current, total)}`);
          if (current === total) process.stderr.write('\n');
        }
      : undefined;

    const data = await sendCommand(projectRoot, 'index', {
      only: options.only,
      check: options.check,
    }, onProgress) as Record<string, unknown>;

    if (!options.check && !process.stderr.isTTY) {
      process.stderr.write(' done.\n');
    }

    outputYaml(data);
  } catch (err: unknown) {
    if (!options.check) process.stderr.write(' failed.\n');
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
