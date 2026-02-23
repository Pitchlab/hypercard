import path from 'node:path';
import fs from 'node:fs';

export function findProjectRoot(startPath?: string): string | null {
  let dir = startPath ?? process.cwd();

  while (true) {
    const candidate = path.join(dir, '.hypercard');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function deriveCardId(absolutePath: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, absolutePath);
  return rel.replace(/\.md$/, '').split(path.sep).join('/');
}

export function deriveCardType(cardId: string): string {
  const firstSlash = cardId.indexOf('/');
  if (firstSlash === -1) return '';
  return cardId.slice(0, firstSlash);
}

export function resolveCardPath(cardId: string, projectRoot: string): string {
  return path.join(projectRoot, ...cardId.split('/')) + '.md';
}
