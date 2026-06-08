import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addLink, removeLink } from '../src/core/linker.js';

describe('linker', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-linker-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function write(name: string, content: string): string {
    const p = path.join(tempDir, name);
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  describe('addLink', () => {
    it('appends the link to the first prose paragraph', () => {
      const p = write('a.md', '# Title\n\nFirst paragraph.\n\nSecond.\n');
      const res = addLink(p, 'b/two', tempDir);
      expect(res.added).toBe(true);
      const out = fs.readFileSync(p, 'utf-8');
      expect(out).toContain('First paragraph. [[b/two]]');
      expect(out).not.toContain('Second. [[b/two]]');
    });

    it('is a no-op when the link already exists', () => {
      const p = write('a.md', '# Title\n\nSee [[b/two]].\n');
      const res = addLink(p, 'b/two', tempDir);
      expect(res.added).toBe(false);
    });

    it('does NOT insert the link into a code block right after the title', () => {
      const p = write('a.md', '# Title\n\n```\ncode block\n```\n\nReal prose.\n');
      addLink(p, 'b/two', tempDir);
      const out = fs.readFileSync(p, 'utf-8');
      // Link must land on the prose line, never on the fence or code line.
      expect(out).toContain('Real prose. [[b/two]]');
      expect(out).not.toMatch(/```.*\[\[b\/two\]\]/);
      expect(out).not.toContain('code block [[b/two]]');
    });

    it('does NOT insert the link into the frontmatter block', () => {
      const p = write('a.md', '---\ntags: []\n---\n\n# Title\n\nProse.\n');
      addLink(p, 'b/two', tempDir);
      const out = fs.readFileSync(p, 'utf-8');
      expect(out).toContain('Prose. [[b/two]]');
      expect(out).not.toMatch(/tags: \[\] \[\[b\/two\]\]/);
    });
  });

  describe('removeLink', () => {
    it('removes plain and display-text forms', () => {
      const p = write('a.md', '# T\n\nSee [[b/two]] and [[b/two|Two]].\n');
      const res = removeLink(p, 'b/two', tempDir);
      expect(res.removed).toBe(true);
      expect(res.count).toBe(2);
      expect(fs.readFileSync(p, 'utf-8')).not.toContain('[[b/two');
    });

    it('preserves Markdown table padding on untouched lines', () => {
      const table = '# T\n\n| col1  | col2 |\n| ----- | ---- |\n\nLink to [[b/two]].\n';
      const p = write('a.md', table);
      removeLink(p, 'b/two', tempDir);
      const out = fs.readFileSync(p, 'utf-8');
      // The table line (no link) must keep its double-space padding intact.
      expect(out).toContain('| col1  | col2 |');
    });

    it('preserves a trailing hard-break on an untouched line', () => {
      // Two trailing spaces = Markdown hard line break.
      const p = write('a.md', '# T\n\nHard break here.  \nNext line with [[b/two]].\n');
      removeLink(p, 'b/two', tempDir);
      const out = fs.readFileSync(p, 'utf-8');
      expect(out).toContain('Hard break here.  \n');
    });
  });
});
