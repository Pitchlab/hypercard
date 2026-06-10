import type Database from 'better-sqlite3';
import type { ICommandHandler } from './server.js';
import {
  getCardById,
  getAllCards,
  getAllCardIds,
  getOrphanCards,
  getCardsFiltered,
  searchCardsFiltered,
  searchCardsWithScores,
  getOutgoingLinks,
  getIncomingLinks,
  getCardCount,
  getTypes,
  getEmbeddingCount,
} from '../core/db.js';
import { indexAllCards, indexSingleCard, checkStaleness, removeCard } from '../core/indexer.js';
import { traverseGraph, buildSearchNeighborhood } from '../core/graph.js';
import type { IGraphOptions } from '../core/graph.js';
import { resolveFuzzyId } from '../util/fuzzy.js';
import type { IEmbedder } from '../core/embedder.js';
import { searchSemantic, searchHybrid, shapeSearchResult } from '../core/search.js';
import type { SearchFormat } from '../core/search.js';
import { parseDateBoundary } from '../util/dates.js';
import type { ISearchResult } from '../core/types.js';

const SEARCH_FORMATS: SearchFormat[] = ['list', 'summary', 'full'];
const SEARCH_MODES = ['bm25', 'semantic', 'hybrid'];
import { suggestLinks } from '../core/suggestions.js';
import { createSerialQueue } from './lifecycle.js';
import type { RunExclusive } from './lifecycle.js';
import type { IProgressCallback } from '../core/types.js';

export type { IEmbedder };

export class CommandHandler implements ICommandHandler {
  private db: Database.Database;
  private projectRoot: string;
  private embedder?: IEmbedder;
  private startTime = Date.now();
  private lastStalenessCheck = 0;
  private runExclusive: RunExclusive;

  constructor(options: {
    db: Database.Database;
    projectRoot: string;
    embedder?: IEmbedder;
    runExclusive?: RunExclusive;
  }) {
    this.db = options.db;
    this.projectRoot = options.projectRoot;
    this.embedder = options.embedder;
    // Shared with the file watcher in daemon mode so reindex jobs never overlap;
    // own private queue in local (one-shot) mode.
    this.runExclusive = options.runExclusive ?? createSerialQueue();
  }

  setEmbedder(embedder: IEmbedder): void {
    this.embedder = embedder;
  }

  async handle(command: string, args: Record<string, unknown>, onProgress?: IProgressCallback): Promise<unknown> {
    // Auto-reindex before query commands (throttled to every 5s)
    if (['get', 'ls', 'search', 'graph', 'suggest-links'].includes(command)) {
      await this.autoReindex();
    }

    switch (command) {
      case 'ping': return { pong: true };
      case 'status': return this.handleStatus();
      case 'get': return this.handleGet(args);
      case 'ls': return this.handleLs(args);
      case 'search': return this.handleSearch(args);
      case 'graph': return this.handleGraph(args);
      case 'suggest-links': return this.handleSuggestLinks(args);
      case 'index': return this.handleIndex(args, onProgress);
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  private async autoReindex(): Promise<void> {
    const now = Date.now();
    if (now - this.lastStalenessCheck < 5000) return;
    this.lastStalenessCheck = now;

    const stale = checkStaleness(this.projectRoot, this.db);
    if (stale.stale.length > 0 || stale.missing.length > 0 || stale.new_files.length > 0) {
      await this.runExclusive(() => indexAllCards(this.projectRoot, this.db, this.embedder));
    }
  }

  private handleStatus(): Record<string, unknown> {
    const cards = getCardCount(this.db);
    const embeddings = getEmbeddingCount(this.db);

    const status: Record<string, unknown> = {
      daemon: 'running',
      pid: process.pid,
      uptime_seconds: Math.round((Date.now() - this.startTime) / 1000),
      cards,
      types: getTypes(this.db),
      embeddings,
      embedder_loaded: !!this.embedder,
    };

    // Surface incomplete embedding coverage instead of failing silently —
    // semantic/hybrid search only covers embedded cards until backfilled.
    if (embeddings < cards) {
      status.embeddings_pending = cards - embeddings;
      status.warning =
        `Embeddings incomplete: ${embeddings}/${cards} cards. ` +
        `Run "hypercard index" to backfill — semantic/hybrid search only covers embedded cards until then.`;
    }

    return status;
  }

  private handleGet(args: Record<string, unknown>): Record<string, unknown> {
    const id = args.id as string;
    if (!id) throw new Error('Missing required argument: id');

    const allIds = getAllCardIds(this.db);
    const resolved = resolveFuzzyId(id, allIds);

    if (typeof resolved !== 'string') {
      if (resolved.error === 'ambiguous') {
        throw new Error(`Ambiguous ID: ${id}. Candidates: ${resolved.candidates.join(', ')}`);
      }
      throw new Error(`Card not found: ${id}`);
    }

    const card = getCardById(this.db, resolved);
    if (!card) throw new Error(`Card not found: ${resolved}`);

    const links_out = getOutgoingLinks(this.db, card.id);
    const links_in = getIncomingLinks(this.db, card.id);

    return {
      card: {
        id: card.id,
        path: card.path,
        title: card.title,
        type: card.type,
        tags: card.tags,
        content: card.content,
        links_out,
        links_in,
      },
    };
  }

  private handleLs(args: Record<string, unknown>): Record<string, unknown> {
    if (args.orphans) {
      const entries = getOrphanCards(this.db);
      return { count: entries.length, cards: entries };
    }

    const whereFilters = this.parseWhereFilters(args.where as string[] | undefined);
    const temporal = this.parseTemporalArgs(args);
    const hasTemporal = temporal.after !== undefined || temporal.before !== undefined;
    const hasWhere = Object.keys(whereFilters).length > 0;

    let cards;
    if (args.search) {
      cards = searchCardsFiltered(this.db, args.search as string, {
        type: args.type as string | undefined,
        tag: args.tag as string | undefined,
        where: hasWhere ? whereFilters : undefined,
        after: temporal.after,
        before: temporal.before,
      });
    } else if (args.type || args.tag || hasWhere || hasTemporal) {
      cards = getCardsFiltered(this.db, {
        type: args.type as string | undefined,
        tag: args.tag as string | undefined,
        where: hasWhere ? whereFilters : undefined,
        after: temporal.after,
        before: temporal.before,
      });
    } else {
      cards = getAllCards(this.db);
    }

    const entries = cards.map((card) => {
      const outCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ?').get(card.id) as { c: number }
      ).c;
      const inCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE target_id = ?').get(card.id) as { c: number }
      ).c;
      return {
        id: card.id,
        title: card.title,
        type: card.type,
        tags: card.tags,
        links_out: outCount,
        links_in: inCount,
      };
    });

    return { count: entries.length, cards: entries };
  }

  private async handleSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const query = args.query as string;
    if (!query) throw new Error('Missing required argument: query');

    const hasEmbeddings = getEmbeddingCount(this.db) > 0;
    const mode = (args.mode as string) ?? (hasEmbeddings ? 'hybrid' : 'bm25');
    if (!SEARCH_MODES.includes(mode)) {
      throw new Error(`Unknown search mode: ${mode}. Expected bm25, semantic, or hybrid.`);
    }
    const topk = (args.topk as number) ?? 10;
    const format = this.parseFormat(args.format);
    const traverse = this.parseTraverseDepth(args.traverse);
    const whereFilters = this.parseWhereFilters(args.where as string[] | undefined);
    const temporal = this.parseTemporalArgs(args);

    const searchOptions = {
      type: args.type as string | undefined,
      tag: args.tag as string | undefined,
      where: Object.keys(whereFilters).length > 0 ? whereFilters : undefined,
      after: temporal.after,
      before: temporal.before,
      limit: topk,
    };

    let results: ISearchResult[];
    let effectiveMode = mode;
    let warning: string | undefined;

    if (mode === 'bm25') {
      results = searchCardsWithScores(this.db, query, searchOptions);
    } else if (!this.embedder || !hasEmbeddings) {
      if (mode === 'semantic') {
        throw new Error('Embeddings not available. Run "hypercard index" to generate embeddings.');
      }
      // hybrid without embedder/embeddings: fall back to bm25 with warning
      results = searchCardsWithScores(this.db, query, searchOptions);
      effectiveMode = 'bm25';
      warning =
        'Embeddings not available — falling back to BM25. Run "hypercard index" with daemon to enable hybrid search.';
    } else if (mode === 'semantic') {
      results = await searchSemantic(this.db, query, this.embedder, searchOptions);
    } else if (mode === 'hybrid') {
      results = await searchHybrid(this.db, query, this.embedder, searchOptions);
    } else {
      throw new Error(`Unknown search mode: ${mode}. Expected bm25, semantic, or hybrid.`);
    }

    // Shape each hit per --format, optionally attaching a compact link
    // neighborhood (--traverse). Neighbors are always compact regardless of
    // --format — they are context, not primary results.
    const shaped = results.map((r) => {
      const content = format === 'full' ? (getCardById(this.db, r.id)?.content ?? '') : undefined;
      const entry = shapeSearchResult(r, format, content);
      if (traverse > 0) {
        const hood = buildSearchNeighborhood(this.db, r.id, traverse);
        entry.links_out = hood.links_out;
        entry.links_in = hood.links_in;
      }
      return entry;
    });

    const response: Record<string, unknown> = { query, mode: effectiveMode, format, count: shaped.length, results: shaped };
    if (traverse > 0) response.traverse = traverse;
    if (warning) response.warning = warning;
    return response;
  }

  private parseFormat(raw: unknown): SearchFormat {
    if (raw === undefined || raw === null) return 'summary';
    const value = String(raw);
    if (!SEARCH_FORMATS.includes(value as SearchFormat)) {
      throw new Error(`Invalid --format "${value}". Expected one of: ${SEARCH_FORMATS.join(', ')}`);
    }
    return value as SearchFormat;
  }

  private parseTraverseDepth(raw: unknown): number {
    if (raw === undefined || raw === null) return 0;
    const depth = Math.trunc(Number(raw));
    if (Number.isNaN(depth) || depth < 0) {
      throw new Error(`Invalid --traverse "${raw}". Expected a depth >= 0.`);
    }
    return Math.min(depth, 3); // cap at 3 hops, matching the graph command
  }

  private handleGraph(args: Record<string, unknown>): unknown {
    const id = args.id as string;
    if (!id) throw new Error('Missing required argument: id');

    const allIds = getAllCardIds(this.db);
    const resolved = resolveFuzzyId(id, allIds);

    if (typeof resolved !== 'string') {
      if (resolved.error === 'ambiguous') {
        throw new Error(`Ambiguous ID: ${id}. Candidates: ${resolved.candidates.join(', ')}`);
      }
      throw new Error(`Card not found: ${id}`);
    }

    let depth = (args.depth as number) ?? 1;
    if (depth < 1) depth = 1;
    if (depth > 3) depth = 3;

    let max = (args.max as number) ?? 20;
    if (max < 1) max = 1;
    if (max > 50) max = 50;

    let direction: 'both' | 'out' | 'in' = 'both';
    if (args.direction === 'out') direction = 'out';
    if (args.direction === 'in') direction = 'in';

    const exclude = args.exclude as string[] | undefined;
    const include = args.include as Record<string, 'full' | 'summary' | 'meta' | 'id'> | undefined;

    const graphOptions: IGraphOptions = { rootId: resolved, depth, max, direction, exclude, include };
    return traverseGraph(this.db, graphOptions);
  }

  private async handleSuggestLinks(args: Record<string, unknown>): Promise<unknown> {
    const id = args.id as string;
    if (!id) throw new Error('Missing required argument: id');

    const allIds = getAllCardIds(this.db);
    const resolved = resolveFuzzyId(id, allIds);

    if (typeof resolved !== 'string') {
      if (resolved.error === 'ambiguous') {
        throw new Error(`Ambiguous ID: ${id}. Candidates: ${resolved.candidates.join(', ')}`);
      }
      throw new Error(`Card not found: ${id}`);
    }

    if (!this.embedder) {
      throw new Error('Embeddings not available. Start daemon to enable suggest-links.');
    }

    const suggestions = await suggestLinks(this.db, resolved, this.embedder, {
      limit: (args.limit as number) ?? 10,
    });

    return { card: resolved, count: suggestions.length, suggestions };
  }

  private async handleIndex(args: Record<string, unknown>, onProgress?: IProgressCallback): Promise<unknown> {
    if (args.check) {
      const result = checkStaleness(this.projectRoot, this.db);
      return {
        stale: result.stale.length,
        stale_cards: result.stale,
        missing: result.missing.length,
        missing_cards: result.missing,
        new: result.new_files.length,
        new_files: result.new_files,
      };
    }

    if (args.only) {
      await this.runExclusive(() =>
        indexSingleCard(args.only as string, this.projectRoot, this.db, this.embedder),
      );
      return { indexed: args.only as string };
    }

    const stats = await this.runExclusive(() =>
      indexAllCards(this.projectRoot, this.db, this.embedder, onProgress),
    );
    return stats;
  }

  private parseWhereFilters(where: string[] | undefined): Record<string, string> {
    const filters: Record<string, string> = {};
    if (!where || where.length === 0) return filters;

    for (const filter of where) {
      const match = filter.match(/^([^=]+)=(.*)$/);
      if (!match) throw new Error(`Invalid --where format "${filter}". Expected key=value`);
      const [, key, value] = match;
      filters[key.trim()] = value.trim();
    }
    return filters;
  }

  /**
   * Parse the temporal-layer CLI args (--after / --before) into inclusive
   * epoch-ms bounds. `before` for a bare date is treated as end-of-day so the
   * whole day is included. Throws on unparseable dates for a clear error.
   */
  private parseTemporalArgs(args: Record<string, unknown>): { after?: number; before?: number } {
    const out: { after?: number; before?: number } = {};

    if (args.after !== undefined && args.after !== null) {
      const t = parseDateBoundary(String(args.after));
      if (t === null) throw new Error(`Invalid --after date: "${args.after}"`);
      out.after = t;
    }
    if (args.before !== undefined && args.before !== null) {
      const t = parseDateBoundary(String(args.before), { endOfDay: true });
      if (t === null) throw new Error(`Invalid --before date: "${args.before}"`);
      out.before = t;
    }

    return out;
  }
}
