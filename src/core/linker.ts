import fs from 'node:fs';
import { structuralLineFlags } from '../util/markdown.js';

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

  // Map out frontmatter and code-fence regions so we never insert a link inside
  // them — that would corrupt the YAML block or a code example.
  const { inFrontmatter, inCode } = structuralLineFlags(content);
  const isStructural = (i: number): boolean => inFrontmatter[i] || inCode[i];

  // Find the `# Title` line, but only one that is real prose (not inside a fence).
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isStructural(i) && lines[i].startsWith('# ')) {
      titleLineIdx = i;
      break;
    }
  }

  // If no title found, append after first non-empty prose line
  const startSearch = titleLineIdx >= 0 ? titleLineIdx + 1 : 0;

  // Skip blank lines AND any frontmatter/code lines to land on real prose.
  let paragraphStart = startSearch;
  while (
    paragraphStart < lines.length &&
    (lines[paragraphStart].trim() === '' || isStructural(paragraphStart))
  ) {
    paragraphStart++;
  }

  // No prose paragraph found — append link on its own line after the title.
  if (paragraphStart >= lines.length) {
    const insertLine = titleLineIdx >= 0 ? titleLineIdx + 1 : 0;
    lines.splice(insertLine, 0, '', plainLink);
    fs.writeFileSync(sourceFilePath, lines.join('\n'), 'utf-8');
    return { added: true, line: insertLine + 2 }; // 1-indexed
  }

  // Find end of the first prose paragraph (next blank line, code fence, or EOF).
  let paragraphEnd = paragraphStart;
  while (
    paragraphEnd < lines.length &&
    lines[paragraphEnd].trim() !== '' &&
    !isStructural(paragraphEnd)
  ) {
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

  // Only touch lines that actually contained a link. Collapsing whitespace
  // globally would destroy Markdown hard line breaks (trailing double space)
  // and table column padding elsewhere in the file.
  const linePattern = new RegExp(`\\[\\[${escapeRegex(targetId)}(\\|[^\\]]*)?\\]\\]`, 'g');
  const updated = content
    .split('\n')
    .map((line) => {
      if (!linePattern.test(line)) return line;
      linePattern.lastIndex = 0;
      // Remove the link, then tidy only the whitespace it left behind on this line.
      return line
        .replace(linePattern, '')
        .replace(/ {2,}/g, ' ')
        .replace(/\s+$/, '');
    })
    .join('\n');

  fs.writeFileSync(sourceFilePath, updated, 'utf-8');
  return { removed: true, count: matches.length };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
