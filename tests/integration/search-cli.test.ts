import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import jsYaml from 'js-yaml';

const CLI_PATH = path.resolve(process.cwd(), 'dist/cli/index.js');

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
    // Retry rmSync — daemon may still hold file handles briefly
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        break;
      } catch {
        try { execSync('sleep 0.2'); } catch {}
      }
    }
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

  it('respects --topk', () => {
    const output = runCLI('search "the" --topk=1', tempDir);
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

  it('errors with --mode semantic when no embeddings', () => {
    expect(() => runCLI('search "test" --mode semantic', tempDir)).toThrow(/embeddings not available/i);
  });

  it('falls back to bm25 when --mode hybrid but no embeddings', () => {
    const output = runCLI('search "crimson" --mode hybrid', tempDir);
    const result = parseYaml(output);

    // Without embeddings, hybrid falls back to bm25
    expect(result.mode).toBe('bm25');
    expect(result.count).toBeGreaterThan(0);
  });

  it('rejects an invalid --mode', () => {
    expect(() => runCLI('search "crimson" --mode bogus', tempDir)).toThrow(/unknown search mode/i);
  });

  it('filters by --after / --before (card timestamps default to mtime ~ now)', () => {
    const future = parseYaml(runCLI('search "crimson" --before 2000-01-01', tempDir));
    expect(future.count).toBe(0);

    const present = parseYaml(runCLI('search "crimson" --after 2000-01-01', tempDir));
    expect(present.count).toBeGreaterThan(0);
  });

  it('--format list emits compact entries (no snippet, date timestamp)', () => {
    const result = parseYaml(runCLI('search "crimson" --format list', tempDir));
    expect(result.format).toBe('list');
    const first = result.results[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('timestamp');
    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first).not.toHaveProperty('snippet');
    expect(first).not.toHaveProperty('type');
  });

  it('--format full includes the card content', () => {
    const result = parseYaml(runCLI('search "Crimson Order" --format full', tempDir));
    const hit = result.results.find((r: { id: string }) => r.id === 'factions/crimson_order');
    expect(hit).toBeDefined();
    expect(typeof hit.content).toBe('string');
    expect(hit.content).toMatch(/militant faction/i);
  });

  it('--traverse nests each hit\'s compact link neighborhood', () => {
    const result = parseYaml(runCLI('search "Crimson Order" --traverse 1', tempDir));
    expect(result.traverse).toBe(1);
    const hit = result.results.find((r: { id: string }) => r.id === 'factions/crimson_order');
    expect(hit).toBeDefined();
    const outIds = hit.links_out.map((n: { id: string }) => n.id);
    expect(outIds).toContain('characters/voss');
    expect(outIds).toContain('locations/iron_citadel');
    // neighbors are compact: no snippet/score
    expect(hit.links_out[0]).not.toHaveProperty('snippet');
    expect(hit.links_out[0]).not.toHaveProperty('score');
    expect(hit.links_out[0]).toHaveProperty('timestamp');
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
