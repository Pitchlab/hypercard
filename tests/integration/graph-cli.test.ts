import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import jsYaml from 'js-yaml';

const CLI_PATH = path.resolve(process.cwd(), 'dist/cli/index.js');

describe('Graph CLI Integration Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maas-graph-test-'));
    createFixtures(tempDir);
    runCLI('init', tempDir);
  });

  afterEach(() => {
    // Kill daemon if running
    try {
      const pidPath = path.join(tempDir, '.maas', 'daemon.pid');
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

  it('returns YAML with card, included, truncated, not_fetched', () => {
    const output = runCLI('graph factions/crimson_order', tempDir);
    const result = parseYaml(output);

    expect(result.card).toBeDefined();
    expect(result.included).toBeDefined();
    expect(result.truncated).toBeDefined();
    expect(result.not_fetched).toBeDefined();
  });

  it('root card is always full detail', () => {
    const output = runCLI('graph factions/crimson_order', tempDir);
    const result = parseYaml(output);

    expect(result.card.id).toBe('factions/crimson_order');
    expect(result.card.detail).toBe('full');
    expect(result.card.depth).toBe(0);
    expect(result.card.content).toBeDefined();
    expect(result.card.links_out).toBeDefined();
    expect(result.card.links_in).toBeDefined();
  });

  it('includes immediate neighbors at depth 1', () => {
    const output = runCLI('graph factions/crimson_order', tempDir);
    const result = parseYaml(output);

    const includedIds = result.included.map((n: { id: string }) => n.id);
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');
  });

  it('--depth flag works', () => {
    const output = runCLI('graph locations/iron_citadel --depth=2', tempDir);
    const result = parseYaml(output);

    // Depth 2 should reach more nodes
    const includedIds = result.included.map((n: { id: string }) => n.id);
    expect(includedIds).toContain('factions/crimson_order');
    expect(includedIds).toContain('characters/voss');
  });

  it('--out flag works', () => {
    const output = runCLI('graph factions/crimson_order --out', tempDir);
    const result = parseYaml(output);

    const includedIds = result.included.map((n: { id: string }) => n.id);
    // Outgoing from crimson_order: voss, iron_citadel
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');
  });

  it('--in flag works', () => {
    const output = runCLI('graph factions/crimson_order --in', tempDir);
    const result = parseYaml(output);

    const includedIds = result.included.map((n: { id: string }) => n.id);
    // Incoming to crimson_order: voss, iron_citadel, events/battle
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');
    expect(includedIds).toContain('events/battle');
  });

  it('--exclude flag works', () => {
    const output = runCLI('graph factions/crimson_order --in --exclude=events', tempDir);
    const result = parseYaml(output);

    const includedIds = result.included.map((n: { id: string }) => n.id);
    expect(includedIds).not.toContain('events/battle');

    const notFetchedIds = result.not_fetched
      .filter((n: { reason: string }) => n.reason === 'excluded')
      .map((n: { id: string }) => n.id);
    expect(notFetchedIds).toContain('events/battle');
  });

  it('--max flag truncates', () => {
    const output = runCLI('graph factions/crimson_order --max=1', tempDir);
    const result = parseYaml(output);

    expect(result.included).toHaveLength(1);
    expect(result.truncated.length).toBeGreaterThan(0);
  });

  it('fuzzy ID resolution works', () => {
    const output = runCLI('graph crimson_order', tempDir);
    const result = parseYaml(output);

    expect(result.card.id).toBe('factions/crimson_order');
  });

  it('error on nonexistent card', () => {
    expect(() => {
      runCLI('graph totally/fake/card', tempDir);
    }).toThrow();
  });

  it('error when not in initialized project', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maas-graph-empty-'));
    try {
      expect(() => {
        runCLI('graph something', emptyDir);
      }).toThrow(/not in a maas project/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('--include flag sets detail levels per type', () => {
    const output = runCLI('graph factions/crimson_order --out --include=characters:full,locations:meta', tempDir);
    const result = parseYaml(output);

    const voss = result.included.find((n: { id: string }) => n.id === 'characters/voss');
    expect(voss).toBeDefined();
    expect(voss.detail).toBe('full');
    expect(voss.content).toBeDefined();

    const citadel = result.included.find((n: { id: string }) => n.id === 'locations/iron_citadel');
    expect(citadel).toBeDefined();
    expect(citadel.detail).toBe('meta');
  });
});

// Helper functions

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
  fs.mkdirSync(path.join(tempDir, 'events'), { recursive: true });

  fs.writeFileSync(
    path.join(tempDir, 'factions', 'crimson_order.md'),
    `---
tags: [military]
status: draft
era: medieval
---

# Crimson Order

The Crimson Order is a militant faction led by [[characters/voss]] from their fortress at [[locations/iron_citadel]].

## History

They rose to power through military conquest.
`,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(tempDir, 'characters', 'voss.md'),
    `---
tags: [leader]
status: published
---

# Commander Voss

Commander Voss is the iron-fisted leader of the [[factions/crimson_order]].

## Background

Voss commands from the [[locations/iron_citadel]].
`,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(tempDir, 'locations', 'iron_citadel.md'),
    `---
tags: [fortress]
status: published
---

# Iron Citadel

The Iron Citadel serves as the primary base for the [[factions/crimson_order]].

## Architecture

Carved into the mountainside with impregnable walls.
`,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(tempDir, 'events', 'battle.md'),
    `---
tags: [conflict]
status: draft
---

# The Great Battle

A pivotal battle involving the [[factions/crimson_order]].

## Outcome

The order emerged victorious.
`,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(tempDir, 'orphan.md'),
    `---
tags: [unused]
status: draft
---

# Orphan Card

This is an orphan card with no links to or from other cards.
`,
    'utf-8'
  );
}
