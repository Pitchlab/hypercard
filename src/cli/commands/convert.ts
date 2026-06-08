import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { findProjectRoot } from '../../util/paths.js';
import { initDatabase, getAllCardIds } from '../../core/db.js';
import { convertFile } from '../../core/converter.js';
import { outputYaml } from '../../util/yaml.js';
import type { IConversionSummary, IConversionWarning } from '../../core/types.js';

interface IConvertOptions {
  all?: boolean;
  write?: boolean;
}

export async function convertCommand(file: string | undefined, options: IConvertOptions): Promise<void> {
  if (!file && !options.all) {
    process.stderr.write('Error: Provide a file path or use --all\n');
    process.exit(1);
  }
  if (file && options.all) {
    process.stderr.write('Error: Cannot use both a file argument and --all\n');
    process.exit(1);
  }

  const projectRoot = findProjectRoot() ?? process.cwd();
  const dryRun = !options.write;

  // Try to load card IDs from DB for link resolution
  let allCardIds: string[] | undefined;
  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  if (fs.existsSync(dbPath)) {
    const db = initDatabase(dbPath);
    try {
      allCardIds = getAllCardIds(db);
    } finally {
      db.close();
    }
  }

  // Resolve file list
  let files: string[];
  if (options.all) {
    const mdFiles = await glob('**/*.md', {
      cwd: projectRoot,
      ignore: ['.hypercard/**', 'node_modules/**'],
      absolute: true,
    });
    files = mdFiles.sort();
  } else {
    const resolved = path.resolve(projectRoot, file!);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`Error: File not found: ${file}\n`);
      process.exit(1);
    }
    files = [resolved];
  }

  const allWarnings: IConversionWarning[] = [];
  const summary: IConversionSummary = {
    dry_run: dryRun,
    files_processed: files.length,
    files_modified: 0,
    files_renamed: 0,
    changes: [],
    warnings: [],
  };

  for (const filePath of files) {
    const result = convertFile(filePath, projectRoot, allCardIds);

    if (result.modified || result.filename_issues.length > 0) {
      summary.changes.push({
        file: result.file,
        frontmatter_added: result.frontmatter_added,
        links_fixed: result.links_fixed,
        link_changes: result.link_changes,
        filename_issues: result.filename_issues,
      });
    }

    if (result.modified) {
      summary.files_modified++;

      if (!dryRun) {
        fs.writeFileSync(filePath, result.converted_content, 'utf-8');
      }
    }

    // Handle filename rename with --write — exactly one rename to the single
    // canonical target computed by convertFile (never one per issue).
    if (!dryRun && result.rename) {
      const newPath = path.join(projectRoot, result.rename.to);
      const currentPath = path.join(projectRoot, result.rename.from);

      // Collision guard: refuse to clobber a different existing file. A pure
      // case-only rename on a case-insensitive FS (macOS) points at the same
      // inode and is safe; anything else that already exists is a real collision.
      const sameTarget = path.resolve(newPath) === path.resolve(currentPath);
      const caseOnly = newPath.toLowerCase() === currentPath.toLowerCase();
      if (fs.existsSync(newPath) && !sameTarget && !caseOnly) {
        allWarnings.push({
          file: result.file,
          message: `Skipped rename to ${result.rename.to} — target already exists (would overwrite)`,
        });
      } else if (!sameTarget) {
        const newDir = path.dirname(newPath);
        if (!fs.existsSync(newDir)) {
          fs.mkdirSync(newDir, { recursive: true });
        }
        fs.renameSync(currentPath, newPath);
        summary.files_renamed++;

        // Keep `files` pointing at the new location so a later rename's
        // reference scan reads this file's updated content, not a dead path.
        const idx = files.indexOf(filePath);
        if (idx !== -1) files[idx] = newPath;

        const oldId = result.rename.from.replace(/\.md$/, '');
        const newId = result.rename.to.replace(/\.md$/, '');
        updateReferencesInFiles(files, oldId, newId);
      }
    }

    allWarnings.push(...result.warnings);
  }

  summary.warnings = allWarnings;

  // Strip empty arrays for cleaner output
  for (const change of summary.changes) {
    if (change.link_changes.length === 0) delete (change as Record<string, unknown>).link_changes;
    if (change.filename_issues.length === 0) delete (change as Record<string, unknown>).filename_issues;
  }
  if (summary.warnings.length === 0) delete (summary as unknown as Record<string, unknown>).warnings;
  if (summary.changes.length === 0) delete (summary as unknown as Record<string, unknown>).changes;

  outputYaml(summary);
}

function updateReferencesInFiles(knownFiles: string[], oldId: string, newId: string): void {
  // Rewrite both [[oldId]] and [[oldId|display]] forms. Read once, apply both
  // substitutions in memory, write once — no stale double-read that could
  // clobber a concurrent write between the two passes.
  const oldLink = `[[${oldId}]]`;
  const newLink = `[[${newId}]]`;
  const oldLinkPrefix = `[[${oldId}|`;
  const newLinkPrefix = `[[${newId}|`;

  for (const filePath of knownFiles) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.includes(oldLink) && !content.includes(oldLinkPrefix)) continue;
    const updated = content.replaceAll(oldLink, newLink).replaceAll(oldLinkPrefix, newLinkPrefix);
    if (updated !== content) {
      fs.writeFileSync(filePath, updated, 'utf-8');
    }
  }
}
