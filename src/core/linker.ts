import fs from 'node:fs';

export interface IAddLinkResult {
  added: boolean;
  line: number;
}

export interface IRemoveLinkResult {
  removed: boolean;
  count: number;
}

/**
 * Add a [[targetId]] link to the end of the first paragraph in a markdown file.
 * The first paragraph is the text block after the `# Title` line.
 */
export function addLink(sourceFilePath: string, targetId: string, _projectRoot: string): IAddLinkResult {
  const content = fs.readFileSync(sourceFilePath, 'utf-8');
  const lines = content.split('\n');

  // Check if link already exists (plain or with display text)
  const plainLink = `[[${targetId}]]`;
  const linkWithTextPattern = new RegExp(`\\[\\[${escapeRegex(targetId)}(\\|[^\\]]*)?\\]\\]`);
  if (linkWithTextPattern.test(content)) {
    return { added: false, line: -1 };
  }

  // Find first paragraph after the title.
  // Strategy: skip leading blank lines, skip the `# Title` line, skip blank lines after it,
  // then the next non-blank block is the first paragraph. We append to its last line.
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      titleLineIdx = i;
      break;
    }
  }

  // If no title found, append after first non-empty line
  const startSearch = titleLineIdx >= 0 ? titleLineIdx + 1 : 0;

  // Skip blank lines after title (or from start)
  let paragraphStart = startSearch;
  while (paragraphStart < lines.length && lines[paragraphStart].trim() === '') {
    paragraphStart++;
  }

  // If we landed on a frontmatter fence or another heading, or end of file, just append after title
  if (paragraphStart >= lines.length) {
    // No paragraph found — append link on a new line after title
    const insertLine = titleLineIdx >= 0 ? titleLineIdx + 1 : 0;
    lines.splice(insertLine, 0, '', plainLink);
    fs.writeFileSync(sourceFilePath, lines.join('\n'), 'utf-8');
    return { added: true, line: insertLine + 2 }; // 1-indexed
  }

  // Find end of the first paragraph (next blank line or end of file)
  let paragraphEnd = paragraphStart;
  while (paragraphEnd < lines.length && lines[paragraphEnd].trim() !== '') {
    paragraphEnd++;
  }

  // Append link to the last line of the paragraph
  const lastLineIdx = paragraphEnd - 1;
  lines[lastLineIdx] = lines[lastLineIdx] + ' ' + plainLink;

  fs.writeFileSync(sourceFilePath, lines.join('\n'), 'utf-8');
  return { added: true, line: lastLineIdx + 1 }; // 1-indexed
}

/**
 * Remove all occurrences of [[targetId]] and [[targetId|...]] from a markdown file.
 * Cleans up double spaces left behind.
 */
export function removeLink(sourceFilePath: string, targetId: string, _projectRoot: string): IRemoveLinkResult {
  const content = fs.readFileSync(sourceFilePath, 'utf-8');

  // Match [[targetId]] and [[targetId|anything]]
  const pattern = new RegExp(`\\[\\[${escapeRegex(targetId)}(\\|[^\\]]*)?\\]\\]`, 'g');
  const matches = content.match(pattern);

  if (!matches || matches.length === 0) {
    return { removed: false, count: 0 };
  }

  let updated = content.replace(pattern, '');

  // Clean up double spaces left behind
  updated = updated.replace(/ {2,}/g, ' ');

  // Clean up lines that are now only whitespace (but preserve intentional blank lines)
  updated = updated
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : line.trimEnd()))
    .join('\n');

  fs.writeFileSync(sourceFilePath, updated, 'utf-8');
  return { removed: true, count: matches.length };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
