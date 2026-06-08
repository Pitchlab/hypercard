import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractLinks, extractTitle, parseMarkdownFile } from '../src/core/parser.js';

describe('extractLinks', () => {
  it('should extract simple wiki links with IDs', () => {
    const content = 'This references [[characters/voss]] and [[factions/crimson_order]].';
    const links = extractLinks(content);

    expect(links).toHaveLength(2);
    expect(links[0].target_id).toBe('characters/voss');
    expect(links[0].display_text).toBeUndefined();
    expect(links[1].target_id).toBe('factions/crimson_order');
  });

  it('should extract display-text links [[id|text]]', () => {
    const content = 'See [[characters/voss|Commander Voss]] for details.';
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0].target_id).toBe('characters/voss');
    expect(links[0].display_text).toBe('Commander Voss');
  });

  it('should capture link context (±100 chars around link)', () => {
    const prefix = 'a'.repeat(150);
    const suffix = 'b'.repeat(150);
    const content = `${prefix}[[test/card]]${suffix}`;
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0].context.length).toBeLessThanOrEqual(214); // 100 + link + 100 + trimming
    expect(links[0].context).toContain('[[test/card]]');
    expect(links[0].context).toMatch(/^a+\[\[test\/card\]\]b+$/);
  });

  it('should record accurate position for each link', () => {
    const content = 'First [[link/one]] then [[link/two]].';
    const links = extractLinks(content);

    expect(links).toHaveLength(2);
    expect(links[0].position).toBe(6);
    expect(links[1].position).toBe(24);
  });

  it('should handle empty content', () => {
    expect(extractLinks('')).toEqual([]);
  });

  it('should handle content with no links', () => {
    expect(extractLinks('Just plain text here.')).toEqual([]);
  });

  it('should trim whitespace from target_id and display_text', () => {
    const content = '[[ spaced/id | Display Text ]]';
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0].target_id).toBe('spaced/id');
    expect(links[0].display_text).toBe('Display Text');
  });

  it('should handle multiple links on the same line', () => {
    const content = '[[a/one]] [[b/two]] [[c/three]]';
    const links = extractLinks(content);

    expect(links).toHaveLength(3);
    expect(links.map((l) => l.target_id)).toEqual(['a/one', 'b/two', 'c/three']);
  });

  it('should NOT extract links inside fenced code blocks', () => {
    const content = 'Real [[a/one]].\n\n```\nExample syntax: [[b/two]]\n```\n';
    const links = extractLinks(content);
    expect(links.map((l) => l.target_id)).toEqual(['a/one']);
  });

  it('should NOT extract links inside inline code spans', () => {
    const content = 'Use `[[type/id]]` to link, e.g. [[real/card]].';
    const links = extractLinks(content);
    expect(links.map((l) => l.target_id)).toEqual(['real/card']);
  });

  it('should keep correct positions for links outside code', () => {
    const content = '`[[code/ref]]` then [[real/ref]]';
    const links = extractLinks(content);
    expect(links).toHaveLength(1);
    expect(content.slice(links[0].position, links[0].position + links[0].context.length)).toContain(
      '[[real/ref]]',
    );
  });
});

describe('extractTitle', () => {
  it('should extract title from first # heading', () => {
    const content = '# Commander Voss\n\nSome content here.';
    expect(extractTitle(content, 'voss.md')).toBe('Commander Voss');
  });

  it('should fall back to filename if no heading', () => {
    const content = 'Just content, no heading.';
    expect(extractTitle(content, 'my-card.md')).toBe('my-card');
  });

  it('should remove .md extension from fallback filename', () => {
    const content = 'No heading';
    expect(extractTitle(content, 'test.md')).toBe('test');
    expect(extractTitle(content, 'nested.file.md')).toBe('nested.file');
  });

  it('should handle headings with extra whitespace', () => {
    const content = '#   Spaced Title  \n\nContent.';
    expect(extractTitle(content, 'fallback.md')).toBe('Spaced Title');
  });

  it('should only match level 1 headings', () => {
    const content = '## Second Level\n\n# First Level';
    expect(extractTitle(content, 'test.md')).toBe('First Level');
  });

  it('should handle empty content', () => {
    expect(extractTitle('', 'empty.md')).toBe('empty');
  });
});

describe('parseMarkdownFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'hypercard-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse a complete markdown file with frontmatter', () => {
    const content = `---
tags:
  - sci-fi
  - character
custom: value
---

# Commander Voss

A decorated officer of [[factions/crimson_order]].
`;
    const filePath = path.join(tempDir, 'characters', 'voss.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);

    expect(card.id).toBe('characters/voss');
    expect(card.path).toBe('characters/voss.md');
    expect(card.title).toBe('Commander Voss');
    expect(card.type).toBe('characters');
    expect(card.tags).toEqual(['sci-fi', 'character']);
    expect(card.content).toContain('A decorated officer');
    expect(card.frontmatter.custom).toBe('value');
    expect(card.mtime).toBeGreaterThan(0);
  });

  it('should handle missing frontmatter', () => {
    const content = '# Simple Card\n\nNo frontmatter here.';
    const filePath = path.join(tempDir, 'simple.md');
    fs.writeFileSync(filePath, content, 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);

    expect(card.id).toBe('simple');
    expect(card.tags).toEqual([]);
    expect(card.frontmatter).toEqual({});
  });

  it('should extract frontmatter tags as array', () => {
    const content = `---
tags:
  - alpha
  - beta
  - gamma
---
Content here.
`;
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, content, 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);
    expect(card.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('should handle non-array tags in frontmatter', () => {
    const content = `---
tags: single-tag
---
Content.
`;
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, content, 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);
    expect(card.tags).toEqual([]);
  });

  it('should derive type from first path segment', () => {
    const filePath = path.join(tempDir, 'factions', 'northern', 'raiders.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Raiders', 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);
    expect(card.type).toBe('factions');
    expect(card.id).toBe('factions/northern/raiders');
  });

  it('should derive ID from relative path', () => {
    const filePath = path.join(tempDir, 'nested', 'deep', 'structure.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Structure', 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);
    expect(card.id).toBe('nested/deep/structure');
  });

  it('should handle root-level cards (no type)', () => {
    const filePath = path.join(tempDir, 'readme.md');
    fs.writeFileSync(filePath, '# README', 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);
    expect(card.id).toBe('readme');
    expect(card.type).toBe('');
  });

  it('should preserve numeric tags as strings', () => {
    const content = `---
tags:
  - 2024
  - year
  - 42
---
Content.
`;
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, content, 'utf-8');

    const card = parseMarkdownFile(filePath, tempDir);
    expect(card.tags).toEqual(['2024', 'year', '42']);
    expect(card.tags.every((t) => typeof t === 'string')).toBe(true);
  });
});
