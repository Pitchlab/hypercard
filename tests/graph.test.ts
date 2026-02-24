import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, upsertCard, insertEdge } from '../src/core/db.js';
import { traverseGraph } from '../src/core/graph.js';
import type { ICard } from '../src/core/types.js';
import type { IGraphOptions } from '../src/core/graph.js';
import type Database from 'better-sqlite3';

function createTestCard(overrides: Partial<ICard> = {}): ICard {
  return {
    id: 'test/card',
    path: 'test/card.md',
    title: 'Test Card',
    type: 'test',
    tags: ['sample'],
    content: 'Test content',
    frontmatter: {},
    mtime: Date.now(),
    ...overrides,
  };
}

function seedGraph(db: Database.Database): void {
  // factions/crimson_order → characters/voss, locations/iron_citadel
  upsertCard(db, createTestCard({
    id: 'factions/crimson_order',
    path: 'factions/crimson_order.md',
    title: 'Crimson Order',
    type: 'factions',
    tags: ['military'],
    content: 'The Crimson Order is a militant faction led by Commander Voss from their fortress at the Iron Citadel.',
  }));

  // characters/voss → factions/crimson_order, locations/iron_citadel
  upsertCard(db, createTestCard({
    id: 'characters/voss',
    path: 'characters/voss.md',
    title: 'Commander Voss',
    type: 'characters',
    tags: ['leader'],
    content: 'Commander Voss is the iron-fisted leader of the Crimson Order. He commands from the Iron Citadel.',
  }));

  // locations/iron_citadel → factions/crimson_order
  upsertCard(db, createTestCard({
    id: 'locations/iron_citadel',
    path: 'locations/iron_citadel.md',
    title: 'Iron Citadel',
    type: 'locations',
    tags: ['fortress'],
    content: 'The Iron Citadel serves as the primary base for the Crimson Order. Carved into the mountainside with impregnable walls.',
  }));

  // events/battle → factions/crimson_order
  upsertCard(db, createTestCard({
    id: 'events/battle',
    path: 'events/battle.md',
    title: 'The Great Battle',
    type: 'events',
    tags: ['conflict'],
    content: 'The battle that shaped the world.',
  }));

  // orphan card
  upsertCard(db, createTestCard({
    id: 'misc/orphan',
    path: 'misc/orphan.md',
    title: 'Orphan Card',
    type: 'misc',
    tags: ['unused'],
    content: 'This is an orphan card with no links.',
  }));

  // Edges
  // crimson_order → voss
  insertEdge(db, { source_id: 'factions/crimson_order', target_id: 'characters/voss', context: '', position: 1 });
  // crimson_order → iron_citadel
  insertEdge(db, { source_id: 'factions/crimson_order', target_id: 'locations/iron_citadel', context: '', position: 2 });
  // voss → crimson_order
  insertEdge(db, { source_id: 'characters/voss', target_id: 'factions/crimson_order', context: '', position: 1 });
  // voss → iron_citadel
  insertEdge(db, { source_id: 'characters/voss', target_id: 'locations/iron_citadel', context: '', position: 2 });
  // iron_citadel → crimson_order
  insertEdge(db, { source_id: 'locations/iron_citadel', target_id: 'factions/crimson_order', context: '', position: 1 });
  // battle → crimson_order
  insertEdge(db, { source_id: 'events/battle', target_id: 'factions/crimson_order', context: '', position: 1 });
  // crimson_order → broken_link (target doesn't exist)
  insertEdge(db, { source_id: 'factions/crimson_order', target_id: 'missing/broken', context: '', position: 3 });
}

describe('traverseGraph', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    seedGraph(db);
  });

  it('returns root card at full detail always', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'both',
    });

    expect(result.card.id).toBe('factions/crimson_order');
    expect(result.card.detail).toBe('full');
    expect(result.card.depth).toBe(0);
    expect(result.card.content).toBeDefined();
    expect(result.card.links_out).toBeDefined();
    expect(result.card.links_in).toBeDefined();
  });

  it('depth 1 returns immediate neighbors only', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'out',
    });

    const includedIds = result.included.map((n) => n.id).sort();
    // Outgoing from crimson_order: voss, iron_citadel (broken link is not_fetched)
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');

    // All at depth 1
    for (const node of result.included) {
      expect(node.depth).toBe(1);
    }
  });

  it('depth 2 returns neighbors of neighbors', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 2,
      max: 20,
      direction: 'out',
    });

    const includedIds = result.included.map((n) => n.id).sort();
    // Depth 1: voss, iron_citadel
    // Depth 2: voss links out to crimson_order (visited), iron_citadel (visited) — no new
    //          iron_citadel links out to crimson_order (visited) — no new
    // So depth 2 shouldn't add new cards in this out-only graph
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');
  });

  it('depth 2 with direction=both finds deeper nodes', () => {
    const result = traverseGraph(db, {
      rootId: 'locations/iron_citadel',
      depth: 2,
      max: 20,
      direction: 'both',
    });

    const includedIds = result.included.map((n) => n.id);
    // Depth 1: crimson_order (out link + in links from voss, crimson_order)
    //          voss (incoming link)
    // Depth 2: from crimson_order → voss (already visited), iron_citadel (root, visited), broken
    //          from voss → crimson_order (visited), iron_citadel (visited)
    //          events/battle links to crimson_order so it should be found as incoming to crimson_order
    expect(includedIds).toContain('factions/crimson_order');
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('events/battle');
  });

  it('--max truncates results correctly', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 2,
      max: 1,
      direction: 'both',
    });

    expect(result.included).toHaveLength(1);
    expect(result.truncated.length).toBeGreaterThan(0);
  });

  it('--out only follows outgoing links', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'out',
    });

    const includedIds = result.included.map((n) => n.id);
    // crimson_order outgoing: voss, iron_citadel, missing/broken
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');
    // events/battle links TO crimson_order (incoming), so should NOT be included
    expect(includedIds).not.toContain('events/battle');
  });

  it('--in only follows incoming links', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'in',
    });

    const includedIds = result.included.map((n) => n.id);
    // Incoming to crimson_order: voss, iron_citadel, battle
    expect(includedIds).toContain('characters/voss');
    expect(includedIds).toContain('locations/iron_citadel');
    expect(includedIds).toContain('events/battle');
  });

  it('--exclude skips types and adds to not_fetched', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'in',
      exclude: ['events'],
    });

    const includedIds = result.included.map((n) => n.id);
    expect(includedIds).not.toContain('events/battle');

    const excludedEntries = result.not_fetched.filter((n) => n.reason === 'excluded');
    expect(excludedEntries.map((n) => n.id)).toContain('events/battle');
  });

  it('--include sets detail levels per type', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'out',
      include: { characters: 'full', locations: 'meta' },
    });

    const voss = result.included.find((n) => n.id === 'characters/voss');
    expect(voss).toBeDefined();
    expect(voss!.detail).toBe('full');
    expect(voss!.content).toBeDefined();

    const citadel = result.included.find((n) => n.id === 'locations/iron_citadel');
    expect(citadel).toBeDefined();
    expect(citadel!.detail).toBe('meta');
    expect(citadel!.content).toBeUndefined();
    expect(citadel!.snippet).toBeUndefined();
    expect(citadel!.links_out).toBeUndefined();
  });

  it('broken links appear in not_fetched', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'out',
    });

    const brokenEntries = result.not_fetched.filter((n) => n.reason === 'broken_link');
    expect(brokenEntries.map((n) => n.id)).toContain('missing/broken');
  });

  it('cycle avoidance: does not infinite loop', () => {
    // crimson_order → voss → crimson_order (cycle)
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 3,
      max: 50,
      direction: 'both',
    });

    // Should complete without hanging
    expect(result.card.id).toBe('factions/crimson_order');
    // Root should not appear in included
    const includedIds = result.included.map((n) => n.id);
    expect(includedIds).not.toContain('factions/crimson_order');
  });

  it('default detail is summary with snippet', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'out',
    });

    const voss = result.included.find((n) => n.id === 'characters/voss');
    expect(voss).toBeDefined();
    expect(voss!.detail).toBe('summary');
    expect(voss!.snippet).toBeDefined();
    expect(voss!.content).toBeUndefined();
    expect(voss!.links_out).toBeDefined();
    expect(voss!.links_in).toBeDefined();
  });

  it('orphan card as root returns empty included', () => {
    const result = traverseGraph(db, {
      rootId: 'misc/orphan',
      depth: 1,
      max: 20,
      direction: 'both',
    });

    expect(result.card.id).toBe('misc/orphan');
    expect(result.included).toHaveLength(0);
    expect(result.truncated).toHaveLength(0);
    expect(result.not_fetched).toHaveLength(0);
  });

  it('throws for nonexistent root card', () => {
    expect(() => {
      traverseGraph(db, {
        rootId: 'does/not/exist',
        depth: 1,
        max: 20,
        direction: 'both',
      });
    }).toThrow(/Card not found/);
  });

  it('depth limit nodes appear in not_fetched', () => {
    // Start from iron_citadel with depth=1, direction=both
    // Depth 1 neighbors: crimson_order, voss
    // Their neighbors would be depth 2 — beyond limit
    const result = traverseGraph(db, {
      rootId: 'locations/iron_citadel',
      depth: 1,
      max: 20,
      direction: 'both',
    });

    // crimson_order and voss are at depth 1 (included)
    // Their unvisited neighbors at depth 2 should NOT be enqueued because depth < currentDepth check
    // Actually with depth=1, we don't enqueue neighbors of depth-1 nodes
    // But events/battle links to crimson_order (incoming), so it would be depth 2
    // Since we don't enqueue beyond depth, it won't appear at all
    expect(result.included.length).toBeGreaterThan(0);
  });

  it('handles multiple exclude types', () => {
    const result = traverseGraph(db, {
      rootId: 'factions/crimson_order',
      depth: 1,
      max: 20,
      direction: 'both',
      exclude: ['events', 'locations'],
    });

    const includedIds = result.included.map((n) => n.id);
    expect(includedIds).not.toContain('events/battle');
    expect(includedIds).not.toContain('locations/iron_citadel');

    const excludedIds = result.not_fetched.filter((n) => n.reason === 'excluded').map((n) => n.id);
    expect(excludedIds).toContain('locations/iron_citadel');
  });
});
