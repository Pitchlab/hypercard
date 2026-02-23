import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { extractLinks } from './parser.js';
import { resolveFuzzyId } from '../util/fuzzy.js';
import { deriveCardId, deriveCardType } from '../util/paths.js';
import type { IConversionResult, IFilenameIssue, ILinkChange, IConversionWarning } from './types.js';

export function convertFile(
  filePath: string,
  projectRoot: string,
  allCardIds?: string[],
): IConversionResult {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const relPath = path.relative(projectRoot, filePath);
  const cardId = deriveCardId(filePath, projectRoot);

  const warnings: IConversionWarning[] = [];
  const linkChanges: ILinkChange[] = [];
  const filenameIssues: IFilenameIssue[] = [];

  // --- Frontmatter ---
  const hasFrontmatter = raw.trimStart().startsWith('---');
  const parsed = matter(raw);
  let frontmatterAdded = false;

  if (!hasFrontmatter) {
    // No frontmatter at all — add tags: []
    parsed.data.tags = [];
    frontmatterAdded = true;
  } else if (!Array.isArray(parsed.data.tags)) {
    // Frontmatter exists but no tags field
    parsed.data.tags = [];
    frontmatterAdded = true;
  }

  // --- Link resolution ---
  let body = parsed.content;

  if (allCardIds && allCardIds.length > 0) {
    const links = extractLinks(body);

    // Process links in reverse order so positions stay valid
    const sortedLinks = [...links].sort((a, b) => b.position - a.position);

    for (const link of sortedLinks) {
      // Skip links that already have a path separator (already resolved)
      if (link.target_id.includes('/')) continue;

      const resolved = resolveFuzzyId(link.target_id, allCardIds);

      if (typeof resolved === 'string') {
        // Build replacement string
        const originalMatch = link.display_text
          ? `[[${link.target_id}|${link.display_text}]]`
          : `[[${link.target_id}]]`;
        const replacement = link.display_text
          ? `[[${resolved}|${link.display_text}]]`
          : `[[${resolved}]]`;

        // Replace at the exact position
        const before = body.slice(0, link.position);
        const after = body.slice(link.position + originalMatch.length);
        body = before + replacement + after;

        linkChanges.push({ from: `[[${link.target_id}]]`, to: `[[${resolved}]]` });
      } else if (resolved.error === 'ambiguous') {
        warnings.push({
          file: relPath,
          message: `Ambiguous link [[${link.target_id}]] - candidates: ${resolved.candidates.join(', ')}`,
        });
      } else {
        warnings.push({
          file: relPath,
          message: `Unresolved link [[${link.target_id}]] - not found in index`,
        });
      }
    }
  }

  // --- Reassemble ---
  const convertedContent = matter.stringify(body, parsed.data);

  // --- Filename checks ---
  const basename = path.basename(filePath, '.md');
  const cardType = deriveCardType(cardId);

  if (basename.includes(' ')) {
    const fixedName = basename.replace(/ /g, '_');
    const dir = path.dirname(relPath);
    const suggestion = dir === '.' ? `${fixedName}.md` : `${dir}/${fixedName}.md`;
    filenameIssues.push({ issue: 'spaces_in_filename', suggestion });
  }

  if (basename !== basename.toLowerCase()) {
    const fixedName = basename.toLowerCase();
    const dir = path.dirname(relPath);
    const suggestion = dir === '.' ? `${fixedName}.md` : `${dir}/${fixedName}.md`;
    filenameIssues.push({ issue: 'uppercase_in_filename', suggestion });
  }

  if (!cardType) {
    filenameIssues.push({ issue: 'no_type_directory' });
    warnings.push({ file: relPath, message: 'File in project root (no type directory)' });
  }

  const modified = frontmatterAdded || linkChanges.length > 0;

  return {
    file: relPath,
    converted_content: convertedContent,
    frontmatter_added: frontmatterAdded,
    links_fixed: linkChanges.length,
    link_changes: linkChanges,
    filename_issues: filenameIssues,
    warnings,
    modified,
  };
}
