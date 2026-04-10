import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import jsYaml from 'js-yaml';

const CLI_PATH = path.resolve(process.cwd(), 'dist/cli/index.js');

describe('CLI Integration Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maas-cli-test-'));

    // Create fixture markdown files
    createFixtures(tempDir);
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

  describe('maas init', () => {
    it('creates .maas/ directory and initializes project', () => {
      const output = runCLI('init', tempDir);
      const result = parseYaml(output);

      // Verify YAML output
      expect(result.initialized).toBe(true);
      // Use realpathSync to handle /var vs /private/var on macOS
      expect(fs.realpathSync(result.root as string)).toBe(fs.realpathSync(tempDir));
      expect(result.cards).toBe(4);
      expect(result.types).toContain('factions');
      expect(result.types).toContain('characters');
      expect(result.types).toContain('locations');
      expect(result.links).toBeGreaterThan(0);

      // Verify .maas directory was created
      const maasDir = path.join(tempDir, '.maas');
      expect(fs.existsSync(maasDir)).toBe(true);

      // Verify config.yaml was created
      const configPath = path.join(maasDir, 'config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
      const config = jsYaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      expect(config.root).toBe('.');

      // Verify database was created
      const dbPath = path.join(maasDir, 'maas.db');
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('indexes all markdown files on init', () => {
      const output = runCLI('init', tempDir);
      const result = parseYaml(output);

      expect(result.cards).toBe(4);
      expect(result.links).toBeGreaterThan(0);
    });

    it('outputs valid YAML', () => {
      const output = runCLI('init', tempDir);
      expect(() => jsYaml.load(output)).not.toThrow();
    });

    it('fails if already initialized', () => {
      // First init
      runCLI('init', tempDir);

      // Try to init again
      expect(() => {
        runCLI('init', tempDir);
      }).toThrow(/already exists/i);
    });
  });

  describe('maas ls', () => {
    beforeEach(() => {
      // Initialize project
      runCLI('init', tempDir);
    });

    it('lists all cards with correct count', () => {
      const output = runCLI('ls', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(4);
      expect(result.cards).toHaveLength(4);

      // Verify card structure
      const card = result.cards[0];
      expect(card).toHaveProperty('id');
      expect(card).toHaveProperty('title');
      expect(card).toHaveProperty('type');
      expect(card).toHaveProperty('tags');
      expect(card).toHaveProperty('links_out');
      expect(card).toHaveProperty('links_in');
    });

    it('filters by type correctly', () => {
      const output = runCLI('ls --type=factions', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('factions/crimson_order');
      expect(result.cards[0].type).toBe('factions');
    });

    it('filters by type=characters', () => {
      const output = runCLI('ls --type=characters', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('characters/voss');
      expect(result.cards[0].type).toBe('characters');
    });

    it('shows orphan cards', () => {
      const output = runCLI('ls --orphans', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('orphan');
      expect(result.cards[0].links_out).toBe(0);
      expect(result.cards[0].links_in).toBe(0);
    });

    it('shows correct link counts', () => {
      const output = runCLI('ls', tempDir);
      const result = parseYaml(output);

      // Find crimson_order card
      const crimsonOrder = result.cards.find((c: { id: string }) => c.id === 'factions/crimson_order');
      expect(crimsonOrder).toBeDefined();
      expect(crimsonOrder.links_out).toBeGreaterThan(0);

      // Find orphan card
      const orphan = result.cards.find((c: { id: string }) => c.id === 'orphan');
      expect(orphan).toBeDefined();
      expect(orphan.links_out).toBe(0);
      expect(orphan.links_in).toBe(0);
    });

    it('filters by single frontmatter key using --where', () => {
      const output = runCLI('ls --where status=draft', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(2);
      expect(result.cards).toHaveLength(2);
      const ids = result.cards.map((c: { id: string }) => c.id).sort();
      expect(ids).toEqual(['factions/crimson_order', 'orphan']);
    });

    it('filters by multiple frontmatter keys using --where (AND logic)', () => {
      const output = runCLI('ls --where status=draft --where era=medieval', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('factions/crimson_order');
    });

    it('combines --type and --where filters', () => {
      const output = runCLI('ls --type=factions --where status=draft', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('factions/crimson_order');
      expect(result.cards[0].type).toBe('factions');
    });

    it('combines --tag and --where filters', () => {
      const output = runCLI('ls --tag=military --where status=draft', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('factions/crimson_order');
    });

    it('combines --type, --tag, and --where filters', () => {
      const output = runCLI('ls --type=factions --tag=military --where status=draft --where era=medieval', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(1);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe('factions/crimson_order');
    });

    it('returns empty result for non-existent frontmatter value', () => {
      const output = runCLI('ls --where status=nonexistent', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(0);
      expect(result.cards).toHaveLength(0);
    });

    it('returns empty result for non-existent frontmatter key', () => {
      const output = runCLI('ls --where nonexistentkey=value', tempDir);
      const result = parseYaml(output);

      expect(result.count).toBe(0);
      expect(result.cards).toHaveLength(0);
    });

    it('fails with error for invalid --where format', () => {
      expect(() => {
        runCLI('ls --where invalidformat', tempDir);
      }).toThrow(/Invalid --where format/);
    });
  });

  describe('maas get', () => {
    beforeEach(() => {
      // Initialize project
      runCLI('init', tempDir);
    });

    it('returns full card with links_out and links_in', () => {
      const output = runCLI('get factions/crimson_order', tempDir);
      const result = parseYaml(output);

      expect(result.card).toBeDefined();
      expect(result.card.id).toBe('factions/crimson_order');
      expect(result.card.title).toBe('Crimson Order');
      expect(result.card.type).toBe('factions');
      expect(result.card.tags).toContain('military');
      expect(result.card.content).toContain('Crimson Order');
      expect(result.card.path).toBe('factions/crimson_order.md');

      // Verify links
      expect(result.card.links_out).toBeDefined();
      expect(Array.isArray(result.card.links_out)).toBe(true);
      expect(result.card.links_out).toContain('characters/voss');
      expect(result.card.links_out).toContain('locations/iron_citadel');

      expect(result.card.links_in).toBeDefined();
      expect(Array.isArray(result.card.links_in)).toBe(true);
    });

    it('resolves fuzzy shorthand', () => {
      const output = runCLI('get voss', tempDir);
      const result = parseYaml(output);

      expect(result.card).toBeDefined();
      expect(result.card.id).toBe('characters/voss');
      expect(result.card.title).toBe('Commander Voss');
    });

    it('shows links_in for referenced cards', () => {
      const output = runCLI('get characters/voss', tempDir);
      const result = parseYaml(output);

      expect(result.card).toBeDefined();
      expect(result.card.links_in).toBeDefined();
      expect(result.card.links_in).toContain('factions/crimson_order');
    });

    it('returns error for nonexistent card', () => {
      expect(() => {
        runCLI('get nonexistent/card', tempDir);
      }).toThrow();
    });

    it('handles exact ID match', () => {
      const output = runCLI('get locations/iron_citadel', tempDir);
      const result = parseYaml(output);

      expect(result.card).toBeDefined();
      expect(result.card.id).toBe('locations/iron_citadel');
      expect(result.card.title).toBe('Iron Citadel');
      expect(result.card.type).toBe('locations');
    });
  });

  describe('maas index', () => {
    beforeEach(() => {
      // Initialize project
      runCLI('init', tempDir);
    });

    it('detects stale cards after file modification', () => {
      // Touch a file to change mtime
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      const now = new Date();
      fs.utimesSync(vossPath, now, now);

      const output = runCLI('index --check', tempDir);
      const result = parseYaml(output);

      expect(result.stale).toBeGreaterThan(0);
      expect(result.stale_cards).toContain('characters/voss');
    });

    it('detects missing cards after file deletion', () => {
      // Delete orphan.md
      const orphanPath = path.join(tempDir, 'orphan.md');
      fs.unlinkSync(orphanPath);

      const output = runCLI('index --check', tempDir);
      const result = parseYaml(output);

      expect(result.missing).toBeGreaterThan(0);
      expect(result.missing_cards).toContain('orphan');
    });

    it('detects new files', () => {
      // Create a new file
      const newCardDir = path.join(tempDir, 'events');
      fs.mkdirSync(newCardDir, { recursive: true });
      const newCardPath = path.join(newCardDir, 'new_event.md');
      fs.writeFileSync(
        newCardPath,
        '---\ntags: [event]\n---\n\n# New Event\n\nThis is new.',
        'utf-8'
      );

      const output = runCLI('index --check', tempDir);
      const result = parseYaml(output);

      expect(result.new).toBeGreaterThan(0);
      expect(result.new_files).toContain('events/new_event.md');
    });

    it('re-indexes all cards', () => {
      const output = runCLI('index', tempDir);
      const result = parseYaml(output);

      // On re-index, all existing cards are "updated"
      expect(result.cards_updated).toBe(4);
      expect(result.cards_added).toBe(0);
      expect(result.cards_deleted).toBe(0);
    });

    it('indexes new cards when running full index', () => {
      // Create a new file
      const newCardDir = path.join(tempDir, 'items');
      fs.mkdirSync(newCardDir, { recursive: true });
      const newCardPath = path.join(newCardDir, 'sword.md');
      fs.writeFileSync(
        newCardPath,
        '---\ntags: [item]\n---\n\n# Magic Sword\n\nPowerful weapon.',
        'utf-8'
      );

      const output = runCLI('index', tempDir);
      const result = parseYaml(output);

      expect(result.cards_added).toBe(1);

      // Verify card was indexed
      const getOutput = runCLI('get items/sword', tempDir);
      const getResult = parseYaml(getOutput);
      expect(getResult.card.id).toBe('items/sword');
    });
  });

  describe('error cases', () => {
    it('fails when not in initialized project (ls)', () => {
      expect(() => {
        runCLI('ls', tempDir);
      }).toThrow(/not in a maas project/i);
    });

    it('fails when not in initialized project (get)', () => {
      expect(() => {
        runCLI('get voss', tempDir);
      }).toThrow(/not in a maas project/i);
    });

    it('fails when not in initialized project (index)', () => {
      expect(() => {
        runCLI('index', tempDir);
      }).toThrow(/not in a maas project/i);
    });

    it('fails when getting nonexistent card', () => {
      runCLI('init', tempDir);

      expect(() => {
        runCLI('get totally/fake/card', tempDir);
      }).toThrow();
    });
  });

  describe('data integrity', () => {
    it('maintains referential integrity across operations', () => {
      // Initialize
      runCLI('init', tempDir);

      // Get crimson_order and verify it links to voss
      const crimsonOutput = runCLI('get factions/crimson_order', tempDir);
      const crimson = parseYaml(crimsonOutput);
      expect(crimson.card.links_out).toContain('characters/voss');

      // Get voss and verify reverse link
      const vossOutput = runCLI('get characters/voss', tempDir);
      const voss = parseYaml(vossOutput);
      expect(voss.card.links_in).toContain('factions/crimson_order');
    });

    it('updates links when cards are modified', () => {
      runCLI('init', tempDir);

      // Add a new link to voss
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      const content = fs.readFileSync(vossPath, 'utf-8');
      fs.writeFileSync(
        vossPath,
        content + '\n\nVoss has a connection to [[locations/iron_citadel]].',
        'utf-8'
      );

      // Re-index
      runCLI('index', tempDir);

      // Verify new link
      const output = runCLI('get characters/voss', tempDir);
      const result = parseYaml(output);
      expect(result.card.links_out).toContain('locations/iron_citadel');
    });

    it('preserves card count across re-indexing', () => {
      runCLI('init', tempDir);

      const ls1 = parseYaml(runCLI('ls', tempDir));
      expect(ls1.count).toBe(4);

      // Re-index
      runCLI('index', tempDir);

      const ls2 = parseYaml(runCLI('ls', tempDir));
      expect(ls2.count).toBe(4);
    });
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
    // execSync throws on non-zero exit codes
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
  // Create directory structure
  fs.mkdirSync(path.join(tempDir, 'factions'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'locations'), { recursive: true });

  // factions/crimson_order.md
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

## Relations

The Order maintains control over strategic territories.
`,
    'utf-8'
  );

  // characters/voss.md
  fs.writeFileSync(
    path.join(tempDir, 'characters', 'voss.md'),
    `---
tags: [leader]
status: published
era: modern
---

# Commander Voss

Commander Voss is the iron-fisted leader of the [[factions/crimson_order]].

## Background

Voss commands from the [[locations/iron_citadel]].

## Legacy

His strategies continue to shape regional politics.
`,
    'utf-8'
  );

  // locations/iron_citadel.md
  fs.writeFileSync(
    path.join(tempDir, 'locations', 'iron_citadel.md'),
    `---
tags: [fortress]
status: published
era: medieval
---

# Iron Citadel

The Iron Citadel serves as the primary base for the [[factions/crimson_order]].

## Architecture

Carved into the mountainside with impregnable walls.

## Strategic Importance

Controls access to northern trade routes.
`,
    'utf-8'
  );

  // orphan.md
  fs.writeFileSync(
    path.join(tempDir, 'orphan.md'),
    `---
tags: [unused]
status: draft
era: ancient
---

# Orphan Card

This is an orphan card with no links to or from other cards.

## Purpose

Used for testing isolated nodes in the graph.
`,
    'utf-8'
  );
}
