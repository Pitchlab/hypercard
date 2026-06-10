import type Database from 'better-sqlite3';
import type { ISearchResult } from './types.js';
import type { IEmbedder } from './embedder.js';
import { cosineSimilarity, deserializeEmbedding } from './embedder.js';
import { searchCardsWithScores } from './db.js';

export { cosineSimilarity };

interface ISearchOptions {
  type?: string;
  tag?: string;
  where?: Record<string, string>;
  limit?: number;
  // Temporal layer
  since?: number;
  until?: number;
  around?: number;
}

interface IVecRow {
  id: string;
  embedding: Buffer;
  title: string;
  type: string;
  tags: string;
  content: string;
  frontmatter: string;
  timestamp: number | null;
  mtime: number;
}

function passesFilters(
  row: { type: string; tags: string; frontmatter: string; timestamp: number | null; mtime: number },
  options: ISearchOptions,
): boolean {
  if (options.type && row.type !== options.type) {
    return false;
  }

  if (options.tag) {
    const tags: string[] = JSON.parse(row.tags);
    if (!tags.includes(options.tag)) {
      return false;
    }
  }

  if (options.where) {
    const fm: Record<string, unknown> = JSON.parse(row.frontmatter);
    for (const [key, value] of Object.entries(options.where)) {
      if (String(fm[key] ?? '') !== value) {
        return false;
      }
    }
  }

  if (options.since !== undefined || options.until !== undefined) {
    const ts = row.timestamp ?? row.mtime;
    if (options.since !== undefined && ts < options.since) return false;
    if (options.until !== undefined && ts > options.until) return false;
  }

  return true;
}

/**
 * Fuse a temporal-proximity dimension into an already-ranked result list using
 * Reciprocal Rank Fusion — the same scheme that fuses BM25 + semantic, extended
 * with a third "temporal" ranker. Closest-in-time cards get the best temporal
 * rank; the combined score reorders the list and is sliced to `limit`.
 *
 * This is the query-time half of the temporal layer: relevance and temporal
 * nearness become co-equal dimensions over the same nodes.
 */
export function fuseTemporal(results: ISearchResult[], around: number, limit: number): ISearchResult[] {
  const k = 60; // RRF constant, matching searchHybrid
  const safeTs = (r: ISearchResult): number => r.timestamp ?? 0;

  const temporalSorted = [...results].sort(
    (a, b) => Math.abs(safeTs(a) - around) - Math.abs(safeTs(b) - around),
  );
  const temporalRank = new Map<string, number>();
  temporalSorted.forEach((r, i) => temporalRank.set(r.id, i + 1));

  const fused = results.map((r, relevanceRank) => {
    const tRank = temporalRank.get(r.id) ?? results.length + 1;
    const rrfScore = 1 / (k + (relevanceRank + 1)) + 1 / (k + tRank);
    return {
      ...r,
      temporal_rank: tRank,
      score: Math.round(rrfScore * 100000) / 100000,
    };
  });

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit);
}

function extractSnippet(content: string): string {
  const trimmed = content.slice(0, 200).replace(/\n+/g, ' ').trim();
  return content.length > 200 ? trimmed + '...' : trimmed;
}

export async function searchSemantic(
  db: Database.Database,
  query: string,
  embedder: IEmbedder,
  options: ISearchOptions = {},
): Promise<ISearchResult[]> {
  const limit = options.limit ?? 10;
  const queryVec = await embedder.generateEmbedding(query);

  const rows = db
    .prepare(
      `SELECT cv.id, cv.embedding, c.title, c.type, c.tags, c.content, c.frontmatter, c.timestamp, c.mtime
       FROM cards_vec cv
       JOIN cards c ON cv.id = c.id`,
    )
    .all() as IVecRow[];

  const scored: { row: IVecRow; similarity: number }[] = [];

  for (const row of rows) {
    if (!passesFilters(row, options)) continue;

    const embedding = deserializeEmbedding(row.embedding);
    const similarity = cosineSimilarity(queryVec, embedding);
    scored.push({ row, similarity });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  const topResults = scored.slice(0, limit);

  return topResults.map((item, index) => ({
    id: item.row.id,
    title: item.row.title,
    type: item.row.type,
    tags: JSON.parse(item.row.tags) as string[],
    score: Math.round(item.similarity * 1000) / 1000,
    snippet: extractSnippet(item.row.content),
    vec_rank: index + 1,
    timestamp: item.row.timestamp ?? item.row.mtime,
  }));
}

export async function searchHybrid(
  db: Database.Database,
  query: string,
  embedder: IEmbedder,
  options: ISearchOptions = {},
): Promise<ISearchResult[]> {
  const limit = options.limit ?? 10;
  const k = 60; // RRF constant

  const [bm25Results, semanticResults] = await Promise.all([
    searchCardsWithScores(db, query, { ...options, limit: 50 }),
    searchSemantic(db, query, embedder, { ...options, limit: 50 }),
  ]);

  // Build rank maps
  const bm25Ranks = new Map<string, number>();
  for (let i = 0; i < bm25Results.length; i++) {
    bm25Ranks.set(bm25Results[i].id, i + 1);
  }

  const vecRanks = new Map<string, number>();
  for (let i = 0; i < semanticResults.length; i++) {
    vecRanks.set(semanticResults[i].id, i + 1);
  }

  // Collect all unique card IDs
  const allIds = new Set<string>([...bm25Ranks.keys(), ...vecRanks.keys()]);

  // Build lookup for card metadata
  const cardData = new Map<string, ISearchResult>();
  for (const r of bm25Results) {
    cardData.set(r.id, r);
  }
  for (const r of semanticResults) {
    if (!cardData.has(r.id)) {
      cardData.set(r.id, r);
    }
  }

  // Compute RRF scores
  const penaltyRank = 1000;
  const merged: ISearchResult[] = [];

  for (const id of allIds) {
    const bm25Rank = bm25Ranks.get(id) ?? penaltyRank;
    const vecRank = vecRanks.get(id) ?? penaltyRank;
    const rrfScore = 1 / (k + bm25Rank) + 1 / (k + vecRank);
    const data = cardData.get(id)!;

    merged.push({
      id: data.id,
      title: data.title,
      type: data.type,
      tags: data.tags,
      score: Math.round(rrfScore * 100000) / 100000,
      snippet: data.snippet,
      bm25_rank: bm25Ranks.has(id) ? bm25Rank : undefined,
      vec_rank: vecRanks.has(id) ? vecRank : undefined,
      timestamp: data.timestamp,
    });
  }

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}
