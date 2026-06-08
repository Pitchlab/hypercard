import fs from 'node:fs';
import path from 'node:path';
import { extractLinks } from './parser.js';
import { resolveFuzzyId } from '../util/fuzzy.js';
import { deriveCardId, deriveCardType } from '../util/paths.js';
import type { IConversionResult, IFilenameIssue, ILinkChange, IConversionWarning } from './types.js';

/**
 * Split raw file content into its frontmatter block (the text between the
 * opening and closing `---` fences, exclusive) and the body. Returns
 * `frontmatter: null` when the file has no frontmatter. This is deliberately
 * textual — we never round-trip frontmatter through a YAML dumper, which would
 * silently reorder keys and rewrite quote styles.
 */
function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: null, body: raw };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      const frontmatter = lines.slice(1, i).join('\n');
      const body = lines.slice(i + 1).join('\n');
      return { frontmatter, body };
    }
  }
  // Unterminated frontmatter — treat the whole thing as body, untouched.
  return { frontmatter: null, body: raw };
}

function frontmatterHasTags(frontmatter: string): boolean {
  return /^\s*tags\s*:/m.test(frontmatter);
}

/**
 * Normalize a basename to the canonical form in one pass: lowercase + spaces to
 * underscores. Composing both fixes here avoids the bug where applying them
 * independently leaves a space behind (`My File` → `my file`).
 */
function normalizeBasename(basename: string): string {
  return basename.replace(/ /g, '_').toLowerCase();
}

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

  // --- Frontmatter (textual, no YAML round-trip) ---
  const { frontmatter, body: originalBody } = splitFrontmatter(raw);
  let frontmatterAdded = false;
  let frontmatterText = frontmatter;

  if (frontmatter === null) {
    frontmatterText = 'tags: []';
    frontmatterAdded = true;
  } else if (!frontmatterHasTags(frontmatter)) {
    frontmatterText = frontmatter === '' ? 'tags: []' : `${frontmatter}\ntags: []`;
    frontmatterAdded = true;
  }

  // --- Link resolution ---
  let body = originalBody;

  if (allCardIds && allCardIds.length > 0) {
    const links = extractLinks(body); // already code-block aware

    // Process links in reverse order so positions stay valid as we splice.
    const sortedLinks = [...links].sort((a, b) => b.position - a.position);

    for (const link of sortedLinks) {
      // Skip links that already have a path separator (already resolved)
      if (link.target_id.includes('/')) continue;

      const resolved = resolveFuzzyId(link.target_id, allCardIds);

      if (typeof resolved === 'string') {
        const originalMatch = link.display_text
          ? `[[${link.target_id}|${link.display_text}]]`
          : `[[${link.target_id}]]`;
        const replacement = link.display_text
          ? `[[${resolved}|${link.display_text}]]`
          : `[[${resolved}]]`;

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
  const convertedContent =
    frontmatterText === null ? body : `---\n${frontmatterText}\n---\n${body}`;

  // --- Filename checks ---
  const basename = path.basename(filePath, '.md');
  const dir = path.dirname(relPath);
  const cardType = deriveCardType(cardId);
  const canonical = normalizeBasename(basename);

  // The suggestion for every issue points at the single fully-normalized name,
  // so reporting and the actual rename can never disagree.
  const suggestion = dir === '.' ? `${canonical}.md` : `${dir}/${canonical}.md`;

  if (basename.includes(' ')) {
    filenameIssues.push({ issue: 'spaces_in_filename', suggestion });
  }
  if (basename !== basename.toLowerCase()) {
    filenameIssues.push({ issue: 'uppercase_in_filename', suggestion });
  }
  if (!cardType) {
    filenameIssues.push({ issue: 'no_type_directory' });
    warnings.push({ file: relPath, message: 'File in project root (no type directory)' });
  }

  const needsRename = canonical !== basename;
  const rename = needsRename ? { from: relPath, to: suggestion } : undefined;

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
    rename,
  };
}
