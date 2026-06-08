import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { convertFile } from '../src/core/converter.js';

describe('convertFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-converter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('frontmatter', () => {
    it('adds frontmatter with tags to a file without frontmatter', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '# Test\n\nSome content.\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.frontmatter_added).toBe(true);
      expect(result.modified).toBe(true);
      expect(result.converted_content).toContain('tags:');
      expect(result.converted_content).toContain('# Test');
    });

    it('adds tags to frontmatter that has no tags', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\nstatus: draft\n---\n\n# Test\n\nContent.\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.frontmatter_added).toBe(true);
      expect(result.modified).toBe(true);
      expect(result.converted_content).toContain('tags:');
      expect(result.converted_content).toContain('status: draft');
    });

    it('preserves existing frontmatter with tags', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags:\n  - cool\nstatus: published\n---\n\n# Test\n\nContent.\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.frontmatter_added).toBe(false);
      expect(result.modified).toBe(false);
      expect(result.converted_content).toContain('cool');
      expect(result.converted_content).toContain('status: published');
    });

    it('preserves all existing frontmatter fields when adding tags', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\nstatus: draft\nera: medieval\n---\n\n# Test\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.converted_content).toContain('status: draft');
      expect(result.converted_content).toContain('era: medieval');
      expect(result.converted_content).toContain('tags:');
    });
  });

  describe('link resolution', () => {
    it('resolves bare wiki-links to full paths', () => {
      const filePath = path.join(tempDir, 'factions', 'order.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Order\n\nLed by [[voss]].\n', 'utf-8');

      const allCardIds = ['factions/order', 'characters/voss', 'locations/citadel'];
      const result = convertFile(filePath, tempDir, allCardIds);

      expect(result.links_fixed).toBe(1);
      expect(result.link_changes).toHaveLength(1);
      expect(result.link_changes[0].from).toBe('[[voss]]');
      expect(result.link_changes[0].to).toBe('[[characters/voss]]');
      expect(result.converted_content).toContain('[[characters/voss]]');
      expect(result.converted_content).not.toContain('[[voss]]');
    });

    it('skips links that already have full paths', () => {
      const filePath = path.join(tempDir, 'factions', 'order.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Order\n\nLed by [[characters/voss]].\n', 'utf-8');

      const allCardIds = ['factions/order', 'characters/voss'];
      const result = convertFile(filePath, tempDir, allCardIds);

      expect(result.links_fixed).toBe(0);
      expect(result.link_changes).toHaveLength(0);
    });

    it('warns on ambiguous links', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Test\n\nSee [[order]].\n', 'utf-8');

      const allCardIds = ['factions/crimson_order', 'items/holy_order'];
      const result = convertFile(filePath, tempDir, allCardIds);

      expect(result.links_fixed).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.message.includes('Ambiguous link'))).toBe(true);
    });

    it('warns on unresolved links', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Test\n\nSee [[nonexistent]].\n', 'utf-8');

      const allCardIds = ['factions/order', 'characters/voss'];
      const result = convertFile(filePath, tempDir, allCardIds);

      expect(result.links_fixed).toBe(0);
      expect(result.warnings.some((w) => w.message.includes('not found'))).toBe(true);
    });

    it('preserves display text in resolved links', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Test\n\nSee [[voss|Commander Voss]].\n', 'utf-8');

      const allCardIds = ['characters/voss'];
      const result = convertFile(filePath, tempDir, allCardIds);

      expect(result.links_fixed).toBe(1);
      expect(result.converted_content).toContain('[[characters/voss|Commander Voss]]');
    });

    it('resolves multiple bare links in the same file', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        '---\ntags: []\n---\n\n# Test\n\n[[voss]] at [[citadel]].\n',
        'utf-8',
      );

      const allCardIds = ['characters/voss', 'locations/citadel'];
      const result = convertFile(filePath, tempDir, allCardIds);

      expect(result.links_fixed).toBe(2);
      expect(result.converted_content).toContain('[[characters/voss]]');
      expect(result.converted_content).toContain('[[locations/citadel]]');
    });

    it('skips link resolution when no card IDs provided', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Test\n\nSee [[voss]].\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.links_fixed).toBe(0);
      expect(result.converted_content).toContain('[[voss]]');
    });

    it('does NOT rewrite bare links inside fenced code blocks', () => {
      const filePath = path.join(tempDir, 'docs', 'guide.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        '---\ntags: []\n---\n\n# Guide\n\n```\nLink like [[voss]] in examples\n```\n',
        'utf-8',
      );

      const result = convertFile(filePath, tempDir, ['characters/voss']);

      expect(result.links_fixed).toBe(0);
      expect(result.converted_content).toContain('[[voss]]'); // untouched in code
      expect(result.converted_content).not.toContain('[[characters/voss]]');
    });
  });

  describe('frontmatter formatting preservation', () => {
    it('preserves key order and quoting when only adding tags', () => {
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Order zebra→alpha and a quoted scalar must survive verbatim.
      fs.writeFileSync(filePath, '---\nzebra: "Quoted Value"\nalpha: 1\n---\n\n# Test\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.frontmatter_added).toBe(true);
      const fm = result.converted_content.split('---')[1];
      expect(fm).toContain('zebra: "Quoted Value"');
      // zebra must still come before alpha (no YAML re-serialisation reordering).
      expect(fm.indexOf('zebra')).toBeLessThan(fm.indexOf('alpha'));
      expect(fm).toContain('tags: []');
    });
  });

  describe('canonical rename', () => {
    it('produces a single normalized target for a name with spaces AND uppercase', () => {
      const filePath = path.join(tempDir, 'factions', 'My Faction.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# My Faction\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      // One canonical target — lowercase AND underscored, never "my faction.md".
      expect(result.rename).toBeDefined();
      expect(result.rename!.to).toBe('factions/my_faction.md');
      // Every filename-issue suggestion agrees with the single canonical target.
      for (const issue of result.filename_issues) {
        if (issue.suggestion) expect(issue.suggestion).toBe('factions/my_faction.md');
      }
    });

    it('has no rename for an already-clean filename', () => {
      const filePath = path.join(tempDir, 'factions', 'clean_name.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Clean\n', 'utf-8');

      const result = convertFile(filePath, tempDir);
      expect(result.rename).toBeUndefined();
    });
  });

  describe('filename checks', () => {
    it('detects spaces in filename', () => {
      const filePath = path.join(tempDir, 'factions', 'crimson order.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Crimson Order\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.filename_issues).toHaveLength(1);
      expect(result.filename_issues[0].issue).toBe('spaces_in_filename');
      expect(result.filename_issues[0].suggestion).toBe('factions/crimson_order.md');
    });

    it('detects uppercase in filename', () => {
      const filePath = path.join(tempDir, 'factions', 'CrimsonOrder.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Crimson Order\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.filename_issues.some((i) => i.issue === 'uppercase_in_filename')).toBe(true);
      expect(result.filename_issues.find((i) => i.issue === 'uppercase_in_filename')?.suggestion).toBe(
        'factions/crimsonorder.md',
      );
    });

    it('detects file in project root (no type directory)', () => {
      const filePath = path.join(tempDir, 'notes.md');
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Notes\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.filename_issues.some((i) => i.issue === 'no_type_directory')).toBe(true);
      expect(result.warnings.some((w) => w.message.includes('no type directory'))).toBe(true);
    });

    it('returns no issues for clean filenames', () => {
      const filePath = path.join(tempDir, 'factions', 'crimson_order.md');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '---\ntags: []\n---\n\n# Crimson Order\n', 'utf-8');

      const result = convertFile(filePath, tempDir);

      expect(result.filename_issues).toHaveLength(0);
    });
  });
});
