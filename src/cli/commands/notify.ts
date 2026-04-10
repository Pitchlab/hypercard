import path from 'node:path';
import { findProjectRoot } from '../../util/paths.js';
import { sendNotify } from '../client.js';

export async function notifyCommand(file: string): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return; // Not in a Maas project, silently skip

  const relPath = path.relative(projectRoot, path.resolve(file));
  if (!relPath.endsWith('.md')) return; // Not a markdown file

  await sendNotify(projectRoot, relPath);
}
