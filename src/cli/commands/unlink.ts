import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, resolveCardPath } from '../../util/paths.js';
import { initDatabase, getAllCardIds } from '../../core/db.js';
import { resolveFuzzyId } from '../../util/fuzzy.js';
import { removeLink } from '../../core/linker.js';
import { sendNotify } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

export async function unlinkCommand(sourceId: string, targetId: string): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a HyperCard project (no .hypercard/ found)\n');
    process.exit(1);
  }

  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  if (!fs.existsSync(dbPath)) {
    process.stderr.write('Error: No index found. Run "hypercard init" first.\n');
    process.exit(1);
  }

  const db = initDatabase(dbPath);
  let allIds: string[];
  try {
    allIds = getAllCardIds(db);
  } finally {
    db.close();
  }

  // Resolve source ID
  const resolvedSource = resolveFuzzyId(sourceId, allIds);
  if (typeof resolvedSource !== 'string') {
    if (resolvedSource.error === 'ambiguous') {
      outputYaml({ error: 'ambiguous_id', query: sourceId, candidates: resolvedSource.candidates });
    } else {
      outputYaml({ error: 'not_found', query: sourceId });
    }
    process.exit(1);
  }

  // Resolve target ID — for unlink, allow removing links to cards that may no longer be in the index
  // So we try fuzzy resolution first, but fall back to using the raw targetId
  let resolvedTarget: string;
  const targetResolution = resolveFuzzyId(targetId, allIds);
  if (typeof targetResolution === 'string') {
    resolvedTarget = targetResolution;
  } else {
    // Target might not be in the index anymore (deleted card), use as-is
    resolvedTarget = targetId;
  }

  const sourceFilePath = resolveCardPath(resolvedSource, projectRoot);
  if (!fs.existsSync(sourceFilePath)) {
    outputYaml({ error: 'file_not_found', path: sourceFilePath });
    process.exit(1);
  }

  const result = removeLink(sourceFilePath, resolvedTarget, projectRoot);

  outputYaml({
    command: 'unlink',
    source: resolvedSource,
    target: resolvedTarget,
    removed: result.removed,
    count: result.count,
    ...(!result.removed ? { reason: 'link_not_found' } : {}),
  });

  // Trigger reindex if links were removed
  if (result.removed) {
    const relPath = path.relative(projectRoot, sourceFilePath);
    await sendNotify(projectRoot, relPath);
  }
}
