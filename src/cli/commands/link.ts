import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, resolveCardPath } from '../../util/paths.js';
import { initDatabase, getAllCardIds } from '../../core/db.js';
import { resolveFuzzyId } from '../../util/fuzzy.js';
import { addLink } from '../../core/linker.js';
import { sendNotify } from '../client.js';
import { outputYaml } from '../../util/yaml.js';

export async function linkCommand(sourceId: string, targetId: string): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    process.stderr.write('Error: Not in a Hypercard project (no .hypercard/ found)\n');
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

  // Resolve target ID
  const resolvedTarget = resolveFuzzyId(targetId, allIds);
  if (typeof resolvedTarget !== 'string') {
    if (resolvedTarget.error === 'ambiguous') {
      outputYaml({ error: 'ambiguous_id', query: targetId, candidates: resolvedTarget.candidates });
    } else {
      outputYaml({ error: 'not_found', query: targetId });
    }
    process.exit(1);
  }

  const sourceFilePath = resolveCardPath(resolvedSource, projectRoot);
  if (!fs.existsSync(sourceFilePath)) {
    outputYaml({ error: 'file_not_found', path: sourceFilePath });
    process.exit(1);
  }

  const result = addLink(sourceFilePath, resolvedTarget, projectRoot);

  outputYaml({
    command: 'link',
    source: resolvedSource,
    target: resolvedTarget,
    added: result.added,
    ...(result.added ? { line: result.line } : { reason: 'link_already_exists' }),
  });

  // Trigger reindex if link was added
  if (result.added) {
    const relPath = path.relative(projectRoot, sourceFilePath);
    await sendNotify(projectRoot, relPath);
  }
}
