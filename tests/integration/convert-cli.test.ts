import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import jsYaml from 'js-yaml';

const CLI_PATH = path.resolve(process.cwd(), 'dist/cli/index.js');

describe('hypercard convert', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-convert-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('dry-run (default)', () => {
    it('shows frontmatter_added for file without frontmatter', () => {
      fs.mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'notes', 'test.md'), '# Test\n\nSome content.\n', 'utf-8');

      const output = runCLI('convert notes/test.md', tempDir);
      const result = parseYaml(output);

      expect(result.dry_run).toBe(true);
      expect(result.files_processed).toBe(1);
      expect(result.files_modified).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].frontmatter_added).toBe(true);
    });

    it('does not modify the file in dry-run', () => {
      fs.mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
      const filePath = path.join(tempDir, 'notes', 'test.md');
      const original = '# Test\n\nSome content.\n';
      fs.writeFileSync(filePath, original, 'utf-8');

      runCLI('convert notes/test.md', tempDir);

      expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
    });

    it('shows link resolution when DB exists', () => {
      // Create project structure
      fs.mkdirSync(path.join(tempDir, 'factions'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'characters'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'factions', 'rebels.md'),
        '---\ntags: []\n---\n\n# Rebels\n\nLed by [[voss]].\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(tempDir, 'characters', 'voss.md'),
        '---\ntags: []\n---\n\n# Voss\n\nA leader.\n',
        'utf-8',
      );

      // Initialize project to create DB
      runCLI('init', tempDir);

      const output = runCLI('convert factions/rebels.md', tempDir);
      const result = parseYaml(output);

      expect(result.files_modified).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].links_fixed).toBe(1);
      expect(result.changes[0].link_changes[0].from).toBe('[[voss]]');
      expect(result.changes[0].link_changes[0].to).toBe('[[characters/voss]]');
    });

    it('works with --all flag', () => {
      fs.mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'notes', 'a.md'), '# A\n\nContent.\n', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'notes', 'b.md'), '# B\n\nContent.\n', 'utf-8');

      const output = runCLI('convert --all', tempDir);
      const result = parseYaml(output);

      expect(result.files_processed).toBe(2);
      expect(result.files_modified).toBe(2);
    });

    it('shows filename issues', () => {
      fs.mkdirSync(path.join(tempDir, 'factions'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'factions', 'crimson order.md'),
        '---\ntags: []\n---\n\n# Crimson Order\n',
        'utf-8',
      );

      const output = runCLI('convert "factions/crimson order.md"', tempDir);
      const result = parseYaml(output);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].filename_issues).toBeDefined();
      expect(result.changes[0].filename_issues[0].issue).toBe('spaces_in_filename');
    });
  });

  describe('--write mode', () => {
    it('modifies the file when --write is used', () => {
      fs.mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
      const filePath = path.join(tempDir, 'notes', 'test.md');
      fs.writeFileSync(filePath, '# Test\n\nSome content.\n', 'utf-8');

      const output = runCLI('convert notes/test.md --write', tempDir);
      const result = parseYaml(output);

      expect(result.dry_run).toBe(false);
      expect(result.files_modified).toBe(1);

      const updated = fs.readFileSync(filePath, 'utf-8');
      expect(updated).toContain('tags:');
      expect(updated).toContain('# Test');
    });

    it('renames files with spaces when --write is used', () => {
      fs.mkdirSync(path.join(tempDir, 'factions'), { recursive: true });
      const oldPath = path.join(tempDir, 'factions', 'crimson order.md');
      fs.writeFileSync(oldPath, '---\ntags: []\n---\n\n# Crimson Order\n', 'utf-8');

      const output = runCLI('convert "factions/crimson order.md" --write', tempDir);
      const result = parseYaml(output);

      expect(result.files_renamed).toBe(1);
      expect(fs.existsSync(path.join(tempDir, 'factions', 'crimson_order.md'))).toBe(true);
      expect(fs.existsSync(oldPath)).toBe(false);
    });
  });

  describe('error cases', () => {
    it('fails when neither file nor --all is provided', () => {
      expect(() => runCLI('convert', tempDir)).toThrow();
    });

    it('fails when file does not exist', () => {
      expect(() => runCLI('convert nonexistent.md', tempDir)).toThrow();
    });

    it('reports no changes for already-converted file', () => {
      fs.mkdirSync(path.join(tempDir, 'factions'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'factions', 'rebels.md'),
        '---\ntags:\n  - military\n---\n\n# Rebels\n\nContent.\n',
        'utf-8',
      );

      const output = runCLI('convert factions/rebels.md', tempDir);
      const result = parseYaml(output);

      expect(result.files_modified).toBe(0);
    });
  });
});

function runCLI(command: string, cwd: string): string {
  try {
    const result = execSync(`node ${CLI_PATH} ${command}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (error) {
    if (error instanceof Error && 'stderr' in error) {
      const execError = error as { stderr: Buffer | string };
      throw new Error(execError.stderr.toString());
    }
    throw error;
  }
}

function parseYaml(output: string): Record<string, unknown> {
  return jsYaml.load(output) as Record<string, unknown>;
}
