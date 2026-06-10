import type Database from 'better-sqlite3';
import { getCardById, getOutgoingLinks, getIncomingLinks } from './db.js';
import { formatDate } from '../util/dates.js';

export interface IGraphOptions {
  rootId: string;
  depth: number;       // default 1, max 3
  max: number;         // default 20, hard max 50
  direction: 'both' | 'out' | 'in';
  exclude?: string[];  // type names to exclude
  include?: Record<string, 'full' | 'summary' | 'meta' | 'id'>; // type:detail mappings
}

export interface IGraphResult {
  card: IGraphNode;           // root at full detail
  included: IGraphNode[];     // fetched neighbors
  truncated: string[];        // within scope but cut by --max
  not_fetched: INotFetched[]; // excluded, broken, or beyond depth
}

export interface IGraphNode {
  id: string;
  title: string;
  type: string;
  tags: string[];
  depth: number;
  detail: 'full' | 'summary' | 'meta' | 'id';
  content?: string;           // only for full detail
  snippet?: string;           // only for summary detail
  links_out?: string[];       // for full and summary
  links_in?: string[];        // for full and summary
}

export interface INotFetched {
  id: string;
  reason: 'excluded' | 'depth_limit' | 'broken_link';
}

function getNeighborIds(db: Database.Database, cardId: string, direction: 'both' | 'out' | 'in'): string[] {
  const ids = new Set<string>();

  if (direction === 'out' || direction === 'both') {
    for (const id of getOutgoingLinks(db, cardId)) {
      ids.add(id);
    }
  }

  if (direction === 'in' || direction === 'both') {
    for (const id of getIncomingLinks(db, cardId)) {
      ids.add(id);
    }
  }

  return [...ids];
}

function generateSnippet(content: string): string {
  const trimmed = content.replace(/\n+/g, ' ').trim();
  if (trimmed.length <= 200) return trimmed;

  const cut = trimmed.slice(0, 200);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 150) {
    return cut.slice(0, lastSpace) + '...';
  }
  return cut + '...';
}

function determineDetail(type: string, includeMap?: Record<string, 'full' | 'summary' | 'meta' | 'id'>): 'full' | 'summary' | 'meta' | 'id' {
  if (includeMap && type in includeMap) {
    return includeMap[type];
  }
  return 'summary';
}

function buildGraphNode(
  db: Database.Database,
  cardId: string,
  depth: number,
  detail: 'full' | 'summary' | 'meta' | 'id',
): IGraphNode {
  const card = getCardById(db, cardId)!;

  const node: IGraphNode = {
    id: card.id,
    title: card.title,
    type: card.type,
    tags: card.tags,
    depth,
    detail,
  };

  if (detail === 'full') {
    node.content = card.content;
    node.links_out = getOutgoingLinks(db, card.id);
    node.links_in = getIncomingLinks(db, card.id);
  } else if (detail === 'summary') {
    node.snippet = generateSnippet(card.content);
    node.links_out = getOutgoingLinks(db, card.id);
    node.links_in = getIncomingLinks(db, card.id);
  }
  // meta and id: no content/snippet/links

  return node;
}

/**
 * Compact representation of a traversed neighbor card. Neighbors are context,
 * not primary results, so they never carry snippet/content/score — just enough
 * to identify them and place them in time. Deeper hops nest recursively.
 */
export interface ICompactNode {
  id: string;
  title: string;
  type: string;
  timestamp: string; // ISO calendar date (YYYY-MM-DD), consistent with --format list
  tags: string[];
  links_out?: ICompactNode[];
  links_in?: ICompactNode[];
}

export interface ICompactNeighborhood {
  links_out: ICompactNode[];
  links_in: ICompactNode[];
}

const TRAVERSE_MAX_NODES = 50; // hard cap per hit, mirroring graph --max

/**
 * Build a search hit's link neighborhood as nested compact nodes, following
 * both directions up to `depth` hops. Cycles are avoided per hit (a hit never
 * re-includes itself or an already-seen card), and a shared node budget bounds
 * total fan-out so depth 2–3 can't explode the output.
 */
export function buildSearchNeighborhood(
  db: Database.Database,
  hitId: string,
  depth: number,
): ICompactNeighborhood {
  const visited = new Set<string>([hitId]);
  const budget = { remaining: TRAVERSE_MAX_NODES };
  return expandNeighbors(db, hitId, depth, visited, budget);
}

function toCompactNode(db: Database.Database, cardId: string): ICompactNode | null {
  const card = getCardById(db, cardId);
  if (!card) return null; // broken link — skip
  return {
    id: card.id,
    title: card.title,
    type: card.type,
    timestamp: formatDate(card.timestamp),
    tags: card.tags,
  };
}

function expandNeighbors(
  db: Database.Database,
  cardId: string,
  depthLeft: number,
  visited: Set<string>,
  budget: { remaining: number },
): ICompactNeighborhood {
  const collect = (ids: string[]): ICompactNode[] => {
    const out: ICompactNode[] = [];
    for (const id of ids) {
      if (budget.remaining <= 0) break;
      if (visited.has(id)) continue;
      const node = toCompactNode(db, id);
      if (!node) continue;
      visited.add(id);
      budget.remaining--;
      if (depthLeft > 1) {
        const sub = expandNeighbors(db, id, depthLeft - 1, visited, budget);
        if (sub.links_out.length) node.links_out = sub.links_out;
        if (sub.links_in.length) node.links_in = sub.links_in;
      }
      out.push(node);
    }
    return out;
  };

  return {
    links_out: collect(getOutgoingLinks(db, cardId)),
    links_in: collect(getIncomingLinks(db, cardId)),
  };
}

export function traverseGraph(db: Database.Database, options: IGraphOptions): IGraphResult {
  const { rootId, depth, max, direction, exclude, include } = options;

  const rootCard = getCardById(db, rootId);
  if (!rootCard) {
    throw new Error(`Card not found: ${rootId}`);
  }

  // Root is always full detail
  const rootNode = buildGraphNode(db, rootId, 0, 'full');

  const visited = new Set<string>([rootId]);
  const included: IGraphNode[] = [];
  const truncated: string[] = [];
  const notFetched: INotFetched[] = [];

  // BFS queue: [cardId, currentDepth]
  const queue: Array<[string, number]> = [];

  // Seed from root's neighbors
  const rootNeighbors = getNeighborIds(db, rootId, direction);
  for (const neighborId of rootNeighbors) {
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queue.push([neighborId, 1]);
    }
  }

  while (queue.length > 0) {
    const [currentId, currentDepth] = queue.shift()!;

    // Depth limit check
    if (currentDepth > depth) {
      notFetched.push({ id: currentId, reason: 'depth_limit' });
      continue;
    }

    // Check if card exists
    const card = getCardById(db, currentId);
    if (!card) {
      notFetched.push({ id: currentId, reason: 'broken_link' });
      continue;
    }

    // Exclude check
    if (exclude && exclude.includes(card.type)) {
      notFetched.push({ id: currentId, reason: 'excluded' });
      continue;
    }

    // Max check — placed AFTER existence/exclude so `truncated` only ever lists
    // cards that genuinely exist and could be fetched with a higher --max.
    if (included.length >= max) {
      truncated.push(currentId);
      continue;
    }

    // Fetch and add to included
    const detail = determineDetail(card.type, include);
    const node = buildGraphNode(db, currentId, currentDepth, detail);
    included.push(node);

    // Enqueue neighbors for next depth level
    if (currentDepth < depth) {
      const neighbors = getNeighborIds(db, currentId, direction);
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push([neighborId, currentDepth + 1]);
        }
      }
    }
  }

  return {
    card: rootNode,
    included,
    truncated,
    not_fetched: notFetched,
  };
}
