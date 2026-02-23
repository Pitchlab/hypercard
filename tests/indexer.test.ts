import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDatabase } from '../src/core/db.js';
import { indexAllCards, indexSingleCard, checkStaleness } from '../src/core/indexer.js';
import type Database from 'better-sqlite3';

describe('indexer', () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-test-'));

    // Create fixture markdown files
    createFixtures(tempDir);

    // Initialize in-memory database for testing
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    // Clean up
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('indexAllCards()', () => {
    it('indexes all .md files correctly', () => {
      const stats = indexAllCards(tempDir, db);

      expect(stats.cards_added).toBe(4);
      expect(stats.cards_updated).toBe(0);
      expect(stats.cards_deleted).toBe(0);
      expect(stats.edges).toBeGreaterThan(0);

      // Verify card count in database
      const cardCount = db.prepare('SELECT COUNT(*) as count FROM cards').get() as { count: number };
      expect(cardCount.count).toBe(4);
    });

    it('extracts and stores edges correctly', () => {
      indexAllCards(tempDir, db);

      // Verify edges table has entries
      const edgeCount = db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
      expect(edgeCount.count).toBeGreaterThan(0);

      // Verify specific edge: crimson_order -> characters/voss
      const edge = db
        .prepare('SELECT * FROM edges WHERE source_id = ? AND target_id = ?')
        .get('factions/crimson_order', 'characters/voss') as unknown;
      expect(edge).toBeDefined();

      // Verify edge: voss -> factions/crimson_order
      const reverseEdge = db
        .prepare('SELECT * FROM edges WHERE source_id = ? AND target_id = ?')
        .get('characters/voss', 'factions/crimson_order') as unknown;
      expect(reverseEdge).toBeDefined();
    });

    it('stores card metadata correctly', () => {
      indexAllCards(tempDir, db);

      // Check voss card
      const voss = db.prepare('SELECT * FROM cards WHERE id = ?').get('characters/voss') as Record<string, unknown>;
      expect(voss).toBeDefined();
      expect(voss.id).toBe('characters/voss');
      expect(voss.title).toBe('Commander Voss');
      expect(voss.type).toBe('characters');
      expect(JSON.parse(voss.tags as string)).toContain('leader');
      expect(JSON.parse(voss.tags as string)).toContain('antagonist');
      expect(voss.content).toContain('iron-fisted leader');
    });

    it('updates card on re-index', () => {
      // First index
      const stats1 = indexAllCards(tempDir, db);
      expect(stats1.cards_added).toBe(4);
      expect(stats1.cards_updated).toBe(0);

      // Modify a file
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      const content = fs.readFileSync(vossPath, 'utf-8');
      const modifiedContent = content.replace('iron-fisted leader', 'legendary commander');
      fs.writeFileSync(vossPath, modifiedContent, 'utf-8');

      // Re-index
      const stats2 = indexAllCards(tempDir, db);
      expect(stats2.cards_added).toBe(0);
      expect(stats2.cards_updated).toBe(4); // All cards are "updated" on re-index
      expect(stats2.cards_deleted).toBe(0);

      // Verify content was updated
      const voss = db.prepare('SELECT * FROM cards WHERE id = ?').get('characters/voss') as Record<string, unknown>;
      expect(voss.content).toContain('legendary commander');
      expect(voss.content).not.toContain('iron-fisted leader');
    });

    it('deletes cards whose files were removed', () => {
      // First index
      indexAllCards(tempDir, db);

      const initialCount = (db.prepare('SELECT COUNT(*) as count FROM cards').get() as { count: number }).count;
      expect(initialCount).toBe(4);

      // Delete orphan.md
      fs.unlinkSync(path.join(tempDir, 'orphan.md'));

      // Re-index
      const stats = indexAllCards(tempDir, db);
      expect(stats.cards_deleted).toBe(1);

      // Verify card was deleted
      const finalCount = (db.prepare('SELECT COUNT(*) as count FROM cards').get() as { count: number }).count;
      expect(finalCount).toBe(3);

      const orphan = db.prepare('SELECT * FROM cards WHERE id = ?').get('orphan') as unknown;
      expect(orphan).toBeUndefined();
    });

    it('updates edges when links change', () => {
      indexAllCards(tempDir, db);

      // Get initial edge count for voss
      const initialEdges = db
        .prepare('SELECT COUNT(*) as count FROM edges WHERE source_id = ?')
        .get('characters/voss') as { count: number };
      const initialCount = initialEdges.count;

      // Add a new link to voss.md
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      const content = fs.readFileSync(vossPath, 'utf-8');
      const modifiedContent = content + '\n\nVoss has a rival in [[characters/some_other_character]].';
      fs.writeFileSync(vossPath, modifiedContent, 'utf-8');

      // Re-index
      indexAllCards(tempDir, db);

      // Verify edge count increased
      const finalEdges = db
        .prepare('SELECT COUNT(*) as count FROM edges WHERE source_id = ?')
        .get('characters/voss') as { count: number };
      expect(finalEdges.count).toBe(initialCount + 1);

      // Verify new edge exists
      const newEdge = db
        .prepare('SELECT * FROM edges WHERE source_id = ? AND target_id = ?')
        .get('characters/voss', 'characters/some_other_character') as unknown;
      expect(newEdge).toBeDefined();
    });
  });

  describe('indexSingleCard()', () => {
    it('indexes a single card', () => {
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      indexSingleCard(vossPath, tempDir, db);

      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get('characters/voss') as Record<string, unknown>;
      expect(card).toBeDefined();
      expect(card.id).toBe('characters/voss');
      expect(card.title).toBe('Commander Voss');
    });

    it('updates existing card', () => {
      // First index
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      indexSingleCard(vossPath, tempDir, db);

      const card1 = db.prepare('SELECT * FROM cards WHERE id = ?').get('characters/voss') as Record<string, unknown>;
      expect(card1.content).toContain('iron-fisted leader');

      // Modify and re-index
      const content = fs.readFileSync(vossPath, 'utf-8');
      const modifiedContent = content.replace('iron-fisted leader', 'ruthless commander');
      fs.writeFileSync(vossPath, modifiedContent, 'utf-8');

      indexSingleCard(vossPath, tempDir, db);

      const card2 = db.prepare('SELECT * FROM cards WHERE id = ?').get('characters/voss') as Record<string, unknown>;
      expect(card2.content).toContain('ruthless commander');
      expect(card2.content).not.toContain('iron-fisted leader');
    });

    it('handles relative paths', () => {
      const relPath = 'characters/voss.md';
      indexSingleCard(relPath, tempDir, db);

      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get('characters/voss') as Record<string, unknown>;
      expect(card).toBeDefined();
    });
  });

  describe('checkStaleness()', () => {
    beforeEach(() => {
      // Index all cards first
      indexAllCards(tempDir, db);
    });

    it('detects stale cards after file modification', () => {
      // Wait a bit to ensure mtime difference
      const vossPath = path.join(tempDir, 'characters', 'voss.md');

      // Touch the file (update mtime)
      const now = new Date();
      fs.utimesSync(vossPath, now, now);

      const result = checkStaleness(tempDir, db);

      expect(result.stale).toContain('characters/voss');
      expect(result.missing).toEqual([]);
      expect(result.new_files).toEqual([]);
    });

    it('detects missing cards after file deletion', () => {
      const orphanPath = path.join(tempDir, 'orphan.md');
      fs.unlinkSync(orphanPath);

      const result = checkStaleness(tempDir, db);

      expect(result.missing).toContain('orphan');
      expect(result.stale.length).toBe(0);
    });

    it('detects new files not in database', () => {
      // Create a new file
      const newCardDir = path.join(tempDir, 'events');
      fs.mkdirSync(newCardDir, { recursive: true });
      const newCardPath = path.join(newCardDir, 'new_event.md');
      fs.writeFileSync(
        newCardPath,
        '---\ntags: [event]\n---\n\n# New Event\n\nThis is a new card.',
        'utf-8'
      );

      const result = checkStaleness(tempDir, db);

      expect(result.new_files).toContain('events/new_event.md');
      expect(result.missing).toEqual([]);
      expect(result.stale.length).toBe(0);
    });

    it('returns empty results when everything is in sync', () => {
      const result = checkStaleness(tempDir, db);

      expect(result.stale).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.new_files).toEqual([]);
    });

    it('detects multiple types of staleness simultaneously', () => {
      // Stale: touch voss
      const vossPath = path.join(tempDir, 'characters', 'voss.md');
      const now = new Date();
      fs.utimesSync(vossPath, now, now);

      // Missing: delete orphan
      const orphanPath = path.join(tempDir, 'orphan.md');
      fs.unlinkSync(orphanPath);

      // New: create new file
      const newCardDir = path.join(tempDir, 'items');
      fs.mkdirSync(newCardDir, { recursive: true });
      const newCardPath = path.join(newCardDir, 'magic_sword.md');
      fs.writeFileSync(
        newCardPath,
        '---\ntags: [item]\n---\n\n# Magic Sword\n\nA powerful artifact.',
        'utf-8'
      );

      const result = checkStaleness(tempDir, db);

      expect(result.stale).toContain('characters/voss');
      expect(result.missing).toContain('orphan');
      expect(result.new_files).toContain('items/magic_sword.md');
    });
  });
});

// Helper function to create test fixtures
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
---

# Crimson Order

The Crimson Order is led by [[characters/voss]] from their base at [[locations/iron_citadel]].

## History

They rose to power through military might.
`,
    'utf-8'
  );

  // characters/voss.md
  fs.writeFileSync(
    path.join(tempDir, 'characters', 'voss.md'),
    `---
tags: [leader, antagonist]
---

# Commander Voss

Commander Voss is the iron-fisted leader of the [[factions/crimson_order]].

## Background

Voss commands from [[locations/iron_citadel]].
`,
    'utf-8'
  );

  // locations/iron_citadel.md
  fs.writeFileSync(
    path.join(tempDir, 'locations', 'iron_citadel.md'),
    `---
tags: [fortress]
---

# Iron Citadel

The Iron Citadel serves as the base for [[factions/crimson_order]].

## Strategic Importance

The fortress controls northern territories.
`,
    'utf-8'
  );

  // orphan.md
  fs.writeFileSync(
    path.join(tempDir, 'orphan.md'),
    `---
tags: [unused]
---

# Orphan Card

This card has no links to or from other cards.
`,
    'utf-8'
  );
}
