import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import type { ICard, IParsedLink } from './types.js';
import { deriveCardId, deriveCardType } from '../util/paths.js';
import { stripCodeRegions } from '../util/markdown.js';

const LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const TITLE_REGEX = /^#\s+(.+)$/m;

export function extractLinks(content: string): IParsedLink[] {
  const links: IParsedLink[] = [];
  let match: RegExpExecArray | null;

  // Match against a code-free shadow string so [[refs]] inside fenced/inline
  // code never become edges. stripCodeRegions preserves length, so match
  // indices remain valid against the original `content` for context slicing.
  const haystack = stripCodeRegions(content);

  // Reset lastIndex
  LINK_REGEX.lastIndex = 0;

  while ((match = LINK_REGEX.exec(haystack)) !== null) {
    const position = match.index;
    const target_id = match[1].trim();
    const display_text = match[2]?.trim() || undefined;

    const ctxStart = Math.max(0, position - 100);
    const ctxEnd = Math.min(content.length, position + match[0].length + 100);
    const context = content.slice(ctxStart, ctxEnd).trim();

    links.push({ target_id, display_text, context, position });
  }

  return links;
}

export function extractTitle(content: string, fallbackFilename: string): string {
  const match = TITLE_REGEX.exec(content);
  if (match) return match[1].trim();
  return fallbackFilename.replace(/\.md$/, '');
}

export function parseMarkdownFile(filePath: string, projectRoot: string): ICard {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const stat = fs.statSync(filePath);
  const { data: frontmatterData, content } = matter(raw);

  const id = deriveCardId(filePath, projectRoot);
  const type = deriveCardType(id);
  const tags = Array.isArray(frontmatterData.tags) ? frontmatterData.tags.map(String) : [];
  const filename = path.basename(filePath);
  const title = extractTitle(content, filename);

  const content_hash = computeContentHash(title, content, tags, frontmatterData as Record<string, unknown>);

  return {
    id,
    path: id + '.md',
    title,
    type,
    tags,
    content,
    frontmatter: frontmatterData as Record<string, unknown>,
    mtime: stat.mtimeMs,
    content_hash,
  };
}

export function computeContentHash(
  title: string,
  content: string,
  tags: string[],
  frontmatter: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(title + content + JSON.stringify(tags) + JSON.stringify(frontmatter))
    .digest('hex');
}
