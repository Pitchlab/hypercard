import { describe, it, expect } from 'vitest';
import { stripCodeRegions, structuralLineFlags } from '../src/util/markdown.js';

describe('stripCodeRegions', () => {
  it('preserves total length and newlines exactly', () => {
    const input = 'a\n```\ncode [[x/y]]\n```\nb `inline [[z]]` c';
    const out = stripCodeRegions(input);
    expect(out.length).toBe(input.length);
    expect(out.split('\n').length).toBe(input.split('\n').length);
  });

  it('blanks wiki-links inside fenced code blocks', () => {
    const input = '# Title\n\nReal [[a/one]].\n\n```\nExample [[b/two]] here\n```';
    const out = stripCodeRegions(input);
    expect(out).toContain('[[a/one]]');
    expect(out).not.toContain('[[b/two]]');
  });

  it('blanks wiki-links inside inline code spans', () => {
    const input = 'Use `[[type/id]]` syntax for [[real/link]].';
    const out = stripCodeRegions(input);
    expect(out).not.toContain('[[type/id]]');
    expect(out).toContain('[[real/link]]');
  });

  it('keeps match offsets aligned with the original', () => {
    const input = 'prefix [[real/link]] suffix';
    const out = stripCodeRegions(input);
    const idx = out.indexOf('[[real/link]]');
    expect(input.slice(idx, idx + '[[real/link]]'.length)).toBe('[[real/link]]');
  });

  it('treats an unterminated fence as code through EOF (no phantom links)', () => {
    const input = '# T\n\n```\n[[never/closed]]';
    const out = stripCodeRegions(input);
    expect(out).not.toContain('[[never/closed]]');
  });

  it('handles ~~~ fences as well as backticks', () => {
    const input = '~~~\n[[in/fence]]\n~~~\n[[out/fence]]';
    const out = stripCodeRegions(input);
    expect(out).not.toContain('[[in/fence]]');
    expect(out).toContain('[[out/fence]]');
  });
});

describe('structuralLineFlags', () => {
  it('flags frontmatter lines when the file opens with ---', () => {
    const input = '---\ntags: []\n---\n# Title\nbody';
    const { inFrontmatter } = structuralLineFlags(input);
    expect(inFrontmatter[0]).toBe(true); // opening ---
    expect(inFrontmatter[1]).toBe(true); // tags: []
    expect(inFrontmatter[2]).toBe(true); // closing ---
    expect(inFrontmatter[3]).toBe(false); // # Title
  });

  it('does not flag --- as frontmatter when not at the top', () => {
    const input = '# Title\n\n---\nnot frontmatter';
    const { inFrontmatter } = structuralLineFlags(input);
    expect(inFrontmatter.every((f) => f === false)).toBe(true);
  });

  it('flags fenced code block lines', () => {
    const input = '# T\n\n```js\ncode\n```\nprose';
    const { inCode } = structuralLineFlags(input);
    expect(inCode[2]).toBe(true); // ```js
    expect(inCode[3]).toBe(true); // code
    expect(inCode[4]).toBe(true); // ```
    expect(inCode[5]).toBe(false); // prose
  });
});
