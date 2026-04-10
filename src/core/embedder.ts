import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ICard } from './types.js';

export interface IEmbedder {
  generateEmbedding(text: string): Promise<Float32Array>;
  generateEmbeddings(texts: string[]): Promise<Float32Array[]>;
}

const DEFAULT_CACHE_DIR = join(homedir(), '.maas', 'models');
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let embedderInstance: IEmbedder | null = null;

async function createEmbedder(cacheDir: string): Promise<IEmbedder> {
  const extractor: FeatureExtractionPipeline = await pipeline(
    'feature-extraction',
    MODEL_NAME,
    { dtype: 'fp32', cache_dir: cacheDir },
  );

  return {
    async generateEmbedding(text: string): Promise<Float32Array> {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return new Float32Array(output.data as Float32Array);
    },

    async generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
      const results: Float32Array[] = [];
      for (const text of texts) {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        results.push(new Float32Array(output.data as Float32Array));
      }
      return results;
    },
  };
}

export async function loadEmbedder(cacheDir?: string): Promise<IEmbedder> {
  if (!embedderInstance) {
    embedderInstance = await createEmbedder(cacheDir ?? DEFAULT_CACHE_DIR);
  }
  return embedderInstance;
}

export async function getEmbedder(): Promise<IEmbedder> {
  if (!embedderInstance) {
    return loadEmbedder();
  }
  return embedderInstance;
}

export function formatCardText(card: ICard): string {
  const tagsStr = card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}. ` : '';
  const words = card.content.split(/\s+/);
  const truncated = words.slice(0, 512).join(' ');
  return `${tagsStr}${card.title}\n${truncated}`;
}

export function generateEmbedding(text: string): Promise<Float32Array> {
  return getEmbedder().then((e) => e.generateEmbedding(text));
}

export function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  return getEmbedder().then((e) => e.generateEmbeddings(texts));
}

export function serializeEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function deserializeEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(new Uint8Array(blob).buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
