import type { FusedResult, RerankedResult } from '../types/index.js';

/**
 * Reranker interface for cross-encoder style reranking.
 * A reranker evaluates query-document pairs and produces a relevance score.
 */
export interface Reranker {
  rerank(query: string, results: FusedResult[], topK: number): Promise<RerankedResult[]>;
}

/**
 * Local Cross-Encoder reranker using a local server.
 * Uses SentenceTransformers CrossEncoder for best results.
 *
 * To start the server:
 *   python scripts/reranker_server.py
 *
 * The server runs on http://localhost:8003 by default.
 */
export class LocalCrossEncoderReranker implements Reranker {
  private baseUrl: string;
  private model: string;

  constructor(options?: { baseUrl?: string; model?: string }) {
    this.baseUrl = options?.baseUrl || process.env.LOCAL_RERANKER_URL || 'http://localhost:8003';
    this.model = options?.model || 'cross-encoder/ms-marco-MiniLM-L6-v2';
  }

  async rerank(
    query: string,
    results: FusedResult[],
    topK: number = 20
  ): Promise<RerankedResult[]> {
    if (results.length === 0) return [];

    const documents = results.map((r) => r.text);

    const response = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        documents,
        top_k: Math.min(topK, results.length),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Local cross-encoder reranker failed (${response.status}): ${errorText}. ` +
        `Ensure the reranker server is running at ${this.baseUrl} (start with: python scripts/reranker_server.py)`
      );
    }

    const data = await response.json();

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error(
        `Unexpected response format from local cross-encoder reranker: ${JSON.stringify(data)}`
      );
    }

    const reranked: RerankedResult[] = data.results.map((item: any, index: number) => {
      const originalResult = results[item.index];
      return {
        ...originalResult,
        rerankScore: item.score,
        finalRank: index + 1,
      };
    });

    return reranked;
  }
}

/**
 * Cross-Encoder reranker using HuggingFace Inference API.
 * Uses ms-marco-MiniLM-L-6-v for high-quality reranking.
 * Cross-encoders provide more accurate relevance scoring by processing
 * query-document pairs together (unlike bi-encoders that process separately).
 */
export class CrossEncoderReranker implements Reranker {
  private model: string;
  private apiUrl: string;
  private apiKey: string | undefined;

  constructor(options?: { model?: string; apiKey?: string }) {
    this.model = options?.model || 'cross-encoder/ms-marco-MiniLM-L-6-v';
    this.apiKey = options?.apiKey || process.env.HUGGINGFACE_API_KEY;
    this.apiUrl = `https://api-inference.huggingface.co/models/${this.model}`;
  }

  async rerank(
    query: string,
    results: FusedResult[],
    topK: number = 20
  ): Promise<RerankedResult[]> {
    if (results.length === 0) return [];

    const documents = results.map((r) => r.text);

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        query,
        documents,
        top_k: Math.min(topK, results.length),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HuggingFace cross-encoder reranker failed (${response.status}): ${errorText}. ` +
        `Check your HUGGINGFACE_API_KEY and model name.`
      );
    }

    const data = await response.json();

    // HuggingFace reranking API returns: [{ corpus_id: number, score: number, text: string }]
    if (!Array.isArray(data)) {
      throw new Error(
        `Unexpected response format from HuggingFace cross-encoder: ${JSON.stringify(data)}`
      );
    }

    const reranked: RerankedResult[] = data.map((item: any, index: number) => {
      const originalResult = results[item.corpus_id];
      return {
        ...originalResult,
        rerankScore: item.score,
        finalRank: index + 1,
      };
    });

    return reranked;
  }
}

/**
 * Create a reranker.
 *
 * Two reranker types:
 * - 'local-cross-encoder': Local server using SentenceTransformers (default, recommended)
 * - 'cross-encoder': HuggingFace Inference API cross-encoder
 *
 * Both throw errors if the service is unavailable — no silent degradation.
 * Set RERANKER_TYPE in .env to choose.
 */
export function createReranker(options?: {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  type?: 'local-cross-encoder' | 'cross-encoder';
}): Reranker {
  const type = options?.type || process.env.RERANKER_TYPE || 'local-cross-encoder';

  if (type === 'cross-encoder') {
    return new CrossEncoderReranker({
      model: options?.model,
      apiKey: options?.apiKey,
    });
  }

  // Default: local-cross-encoder
  return new LocalCrossEncoderReranker({
    baseUrl: options?.baseUrl,
    model: options?.model,
  });
}