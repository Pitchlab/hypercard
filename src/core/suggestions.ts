import type Database from 'better-sqlite3';
import type { IEmbedder } from './embedder.js';
import { cosineSimilarity, deserializeEmbedding } from './embedder.js';
import { getAllEmbeddings, getOutgoingLinks, getCardById, getAllCardIds } from './db.js';

export interface ILinkSuggestion {
  target_id: string;
  target_title: string;
  reason: string;
  score: number;
}

const SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 10;

export async function suggestLinks(
  db: Database.Database,
  cardId: string,
  embedder: IEmbedder,
  options?: { limit?: number },
): Promise<ILinkSuggestion[]> {
  const limit = options?.limit ?? DEFAULT_LIMIT;

  const sourceCard = getCardById(db, cardId);
  if (!sourceCard) throw new Error(`Card not found: ${cardId}`);

  const existingLinks = new Set(getOutgoingLinks(db, cardId));

  // Strategy A: Semantic similarity
  const semanticSuggestions = findSemanticSuggestions(db, cardId, existingLinks);

  // Strategy B: Mention detection
  const mentionSuggestions = findMentionSuggestions(db, cardId, sourceCard.content, existingLinks);

  // Merge and deduplicate (prefer higher score)
  const merged = new Map<string, ILinkSuggestion>();

  for (const suggestion of [...semanticSuggestions, ...mentionSuggestions]) {
    const existing = merged.get(suggestion.target_id);
    if (!existing || suggestion.score > existing.score) {
      merged.set(suggestion.target_id, suggestion);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findSemanticSuggestions(
  db: Database.Database,
  cardId: string,
  existingLinks: Set<string>,
): ILinkSuggestion[] {
  const allEmbeddings = getAllEmbeddings(db);

  let sourceVec: Float32Array | null = null;
  const otherEmbeddings: { id: string; vec: Float32Array }[] = [];

  for (const row of allEmbeddings) {
    const vec = deserializeEmbedding(row.embedding);
    if (row.id === cardId) {
      sourceVec = vec;
    } else {
      otherEmbeddings.push({ id: row.id, vec });
    }
  }

  if (!sourceVec) return [];

  const suggestions: ILinkSuggestion[] = [];

  for (const other of otherEmbeddings) {
    if (existingLinks.has(other.id)) continue;

    const similarity = cosineSimilarity(sourceVec, other.vec);
    if (similarity < SIMILARITY_THRESHOLD) continue;

    const card = getCardById(db, other.id);
    if (!card) continue;

    suggestions.push({
      target_id: other.id,
      target_title: card.title,
      reason: `semantically similar (${similarity.toFixed(2)})`,
      score: similarity,
    });
  }

  return suggestions;
}

function findMentionSuggestions(
  db: Database.Database,
  cardId: string,
  sourceContent: string,
  existingLinks: Set<string>,
): ILinkSuggestion[] {
  const contentLower = sourceContent.toLowerCase();
  const allIds = getAllCardIds(db);
  const suggestions: ILinkSuggestion[] = [];

  for (const otherId of allIds) {
    if (otherId === cardId) continue;
    if (existingLinks.has(otherId)) continue;

    const card = getCardById(db, otherId);
    if (!card) continue;

    // Check if source content mentions the other card's title
    const titleLower = card.title.toLowerCase();
    if (titleLower.length >= 3 && contentLower.includes(titleLower)) {
      suggestions.push({
        target_id: otherId,
        target_title: card.title,
        reason: `mentions '${card.title}' in content`,
        score: 0.8,
      });
      continue;
    }

    // Check if source content contains the last segment of the card ID
    // e.g., "context/business/clients/artific" -> check for "artific"
    const segments = otherId.split('/');
    const lastSegment = segments[segments.length - 1].replace(/_/g, ' ');
    if (lastSegment.length >= 4 && contentLower.includes(lastSegment.toLowerCase())) {
      suggestions.push({
        target_id: otherId,
        target_title: card.title,
        reason: `mentions '${lastSegment}' in content`,
        score: 0.6,
      });
    }
  }

  return suggestions;
}
