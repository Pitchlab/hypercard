import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import jsYaml from 'js-yaml';

const CLI_PATH = path.resolve('/Users/erikvanderpluijm/Sites/tools/pitchlab-tools/hypercard-cli/dist/cli/index.js');

describe('hypercard search', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-search-test-'));
    createFixtures(tempDir);
    runCLI('init', tempDir);
  });

  afterEach(() => {
    // Kill daemon if running
    try {
      const pidPath = path.join(tempDir, '.hypercard', 'daemon.pid');
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        if (!isNaN(pid)) process.kill(pid, 'SIGTERM');
      }
    } catch {}
    // Wait a bit for daemon to clean up
    try { execSync('sleep 0.2'); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns results with correct YAML structure', () => {
    const output = runCLI('search "crimson"', tempDir);
    const result = parseYaml(output);

    expect(result.query).toBe('crimson');
    expect(result.mode).toBe('bm25');
    expect(result.count).toBeGreaterThan(0);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);

    const first = result.results[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('type');
    expect(first).toHaveProperty('tags');
    expect(first).toHaveProperty('score');
    expect(first).toHaveProperty('snippet');
  });

  it('finds cards by content', () => {
    const output = runCLI('search "militant faction"', tempDir);
    const result = parseYaml(output);

    expect(result.count).toBeGreaterThan(0);
    const ids = result.results.map((r: { id: string }) => r.id);
    expect(ids).toContain('factions/crimson_order');
  });

  it('finds cards by title', () => {
    const output = runCLI('search "Commander Voss"', tempDir);
    const result = parseYaml(output);

    expect(result.count).toBeGreaterThan(0);
    const ids = result.results.map((r: { id: string }) => r.id);
    expect(ids).toContain('characters/voss');
  });

  it('filters by --type', () => {
    const output = runCLI('search "crimson" --type=factions', tempDir);
    const result = parseYaml(output);

    expect(result.count).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.type).toBe('factions');
    }
  });

  it('filters by --tag', () => {
    const output = runCLI('search "crimson" --tag=military', tempDir);
    const result = parseYaml(output);

    expect(result.count).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.tags).toContain('military');
    }
  });

  it('respects --limit', () => {
    const output = runCLI('search "the" --limit=1', tempDir);
    const result = parseYaml(output);

    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty results for no matches', () => {
    const output = runCLI('search "zzzznonexistent"', tempDir);
    const result = parseYaml(output);

    expect(result.count).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('returns scores between 0 and 1', () => {
    const output = runCLI('search "crimson"', tempDir);
    const result = parseYaml(output);

    for (const r of result.results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns snippets as strings', () => {
    const output = runCLI('search "crimson"', tempDir);
    const result = parseYaml(output);

    for (const r of result.results) {
      expect(typeof r.snippet).toBe('string');
      expect(r.snippet.length).toBeGreaterThan(0);
    }
  });

  it('errors with --semantic flag when no embeddings', () => {
    expect(() => runCLI('search "test" --semantic', tempDir)).toThrow(/embeddings not available/i);
  });

  it('falls back to bm25 when --hybrid but no embeddings', () => {
    const output = runCLI('search "crimson" --hybrid', tempDir);
    const result = parseYaml(output);

    // Without embeddings, hybrid falls back to bm25
    expect(result.mode).toBe('bm25');
    expect(result.count).toBeGreaterThan(0);
  });

  it('filters by --where', () => {
    const output = runCLI('search "crimson" --where status=draft', tempDir);
    const result = parseYaml(output);

    expect(result.count).toBeGreaterThan(0);
    expect(result.results[0].id).toBe('factions/crimson_order');
  });

  it('fails when not in initialized project', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-search-empty-'));
    try {
      expect(() => runCLI('search "test"', emptyDir)).toThrow(/not in a hypercard project/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

function runCLI(command: string, cwd: string): string {
  try {
    const result = execSync(`node ${CLI_PATH} ${command}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
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

function createFixtures(tempDir: string) {
  fs.mkdirSync(path.join(tempDir, 'factions'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'locations'), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, 'factions', 'crimson_order.md'),
    `---
tags: [military]
status: draft
era: medieval
---

# Crimson Order

The Crimson Order is a militant faction led by [[characters/voss]] from their fortress at [[locations/iron_citadel]].
`,
    'utf-8',
  );

  fs.writeFileSync(
    path.join(tempDir, 'characters', 'voss.md'),
    `---
tags: [leader]
status: published
---

# Commander Voss

Commander Voss is the iron-fisted leader of the [[factions/crimson_order]].
`,
    'utf-8',
  );

  fs.writeFileSync(
    path.join(tempDir, 'locations', 'iron_citadel.md'),
    `---
tags: [fortress]
status: published
---

# Iron Citadel

The Iron Citadel serves as the primary base for the [[factions/crimson_order]].
`,
    'utf-8',
  );
}
