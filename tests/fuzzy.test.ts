import { describe, it, expect } from 'vitest';
import { fuzzyMatchId, resolveFuzzyId } from '../src/util/fuzzy.js';

describe('fuzzyMatchId', () => {
  const allIds = [
    'characters/voss',
    'characters/sarah_voss',
    'factions/crimson_order',
    'locations/voss_station',
    'events/battle_of_voss',
    'items/voss_blade',
  ];

  it('should score exact match highest (1.0)', () => {
    const matches = fuzzyMatchId('characters/voss', allIds);
    expect(matches[0].id).toBe('characters/voss');
    expect(matches[0].score).toBe(1.0);
  });

  it('should score ends-with match second (0.9)', () => {
    const matches = fuzzyMatchId('voss', allIds);
    const exactEnding = matches.filter((m) => m.score === 0.9);
    expect(exactEnding.map((m) => m.id)).toContain('characters/voss');
  });

  it('should score word-boundary match third (0.8)', () => {
    const matches = fuzzyMatchId('voss', allIds);
    const wordBoundary = matches.filter((m) => m.score === 0.8);
    // voss_station, sarah_voss, battle_of_voss, voss_blade all have word boundaries
    expect(wordBoundary.length).toBeGreaterThan(0);
  });

  it('should score substring match lowest (0.5)', () => {
    const allIdsWithSubstring = [...allIds, 'items/glossary'];
    const matches = fuzzyMatchId('loss', allIdsWithSubstring);
    const substring = matches.find((m) => m.id === 'items/glossary');
    expect(substring?.score).toBe(0.5);
  });

  it('should return matches sorted by score descending', () => {
    const matches = fuzzyMatchId('voss', allIds);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it('should be case-insensitive', () => {
    const matches = fuzzyMatchId('VOSS', allIds);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe('characters/voss');
  });

  it('should return empty array when no matches', () => {
    const matches = fuzzyMatchId('xyz_no_match', allIds);
    expect(matches).toEqual([]);
  });

  it('should handle empty query', () => {
    const matches = fuzzyMatchId('', allIds);
    // Empty query matches all IDs with endsWith(''), so returns matches
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('resolveFuzzyId', () => {
  const allIds = [
    'characters/voss',
    'characters/sarah_voss',
    'factions/crimson_order',
    'locations/voss_station',
  ];

  it('should return exact match as string', () => {
    const result = resolveFuzzyId('characters/voss', allIds);
    expect(result).toBe('characters/voss');
  });

  it('should resolve unambiguous shorthand', () => {
    const result = resolveFuzzyId('crimson_order', allIds);
    expect(result).toBe('factions/crimson_order');
  });

  it('should resolve when only one fuzzy match exists', () => {
    const result = resolveFuzzyId('crimson', allIds);
    expect(result).toBe('factions/crimson_order');
  });

  it('should return error with candidates for ambiguous query', () => {
    const result = resolveFuzzyId('voss', allIds);
    expect(result).toHaveProperty('error', 'ambiguous');
    if (typeof result === 'object' && 'error' in result && result.error === 'ambiguous') {
      expect(result.candidates).toContain('characters/voss');
      expect(result.candidates.length).toBeGreaterThan(1);
    }
  });

  it('should return not_found error when no matches', () => {
    const result = resolveFuzzyId('xyz_no_match', allIds);
    expect(result).toEqual({ error: 'not_found' });
  });

  it('should return string when top match has higher score', () => {
    // When one match scores strictly higher than others
    const testIds = ['items/blade', 'characters/blade_runner'];
    const result = resolveFuzzyId('blade', testIds);
    expect(result).toBe('items/blade'); // Ends-with match scores higher
  });

  it('should return ambiguous when top matches have equal scores', () => {
    const testIds = ['a/voss', 'b/voss', 'c/voss'];
    const result = resolveFuzzyId('voss', testIds);
    expect(result).toHaveProperty('error', 'ambiguous');
  });

  it('should be case-insensitive', () => {
    const result = resolveFuzzyId('CRIMSON_ORDER', allIds);
    expect(result).toBe('factions/crimson_order');
  });

  it('should handle empty ID list', () => {
    const result = resolveFuzzyId('any', []);
    expect(result).toEqual({ error: 'not_found' });
  });

  it('should prioritize exact match over fuzzy', () => {
    const testIds = ['characters/voss', 'voss'];
    const result = resolveFuzzyId('voss', testIds);
    expect(result).toBe('voss'); // Exact match wins
  });
});
