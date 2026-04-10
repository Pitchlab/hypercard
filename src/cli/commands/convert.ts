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
  const dbPath = path.join(projectRoot, '.maas', 'maas.db');
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
      ignore: ['.maas/**', 'node_modules/**'],
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

    // Handle filename renames with --write
    if (!dryRun && result.filename_issues.length > 0) {
      for (const issue of result.filename_issues) {
        if (issue.suggestion && (issue.issue === 'spaces_in_filename' || issue.issue === 'uppercase_in_filename')) {
          const newPath = path.join(projectRoot, issue.suggestion);
          const currentPath = result.modified ? filePath : filePath; // content already written above
          const newDir = path.dirname(newPath);
          if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
          }
          fs.renameSync(currentPath, newPath);
          summary.files_renamed++;

          // Update references in other files
          const oldId = result.file.replace(/\.md$/, '');
          const newId = issue.suggestion.replace(/\.md$/, '');
          updateReferencesInFiles(projectRoot, files, oldId, newId);
        }
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

function updateReferencesInFiles(
  projectRoot: string,
  knownFiles: string[],
  oldId: string,
  newId: string,
): void {
  // Replace [[oldId]] with [[newId]] in all known project files
  const oldLink = `[[${oldId}]]`;
  const newLink = `[[${newId}]]`;

  for (const filePath of knownFiles) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes(oldLink)) {
      fs.writeFileSync(filePath, content.replaceAll(oldLink, newLink), 'utf-8');
    }
    // Also handle links with display text
    const oldLinkPrefix = `[[${oldId}|`;
    const newLinkPrefix = `[[${newId}|`;
    if (content.includes(oldLinkPrefix)) {
      fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf-8').replaceAll(oldLinkPrefix, newLinkPrefix), 'utf-8');
    }
  }
}
