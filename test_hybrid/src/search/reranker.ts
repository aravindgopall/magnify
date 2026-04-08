import type { FusedResult, RerankedResult } from '../types/index.js';

/**
 * Reranker interface for cross-encoder style reranking.
 * A reranker evaluates query-document pairs and produces a relevance score.
 */
export interface Reranker {
  rerank(query: string, results: FusedResult[], topK: number): Promise<RerankedResult[]>;
}

/**
 * Simple similarity-based reranker.
 * Uses term overlap and length normalization as a lightweight reranking method.
 * Used as fallback when cross-encoder is unavailable.
 */
export class SimpleReranker implements Reranker {
  /**
   * Calculate term overlap score between query and document.
   */
  private calculateTermOverlap(query: string, document: string): number {
    const queryTerms = new Set(
      query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
    );
    const docTerms = new Set(
      document.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
    );

    if (queryTerms.size === 0 || docTerms.size === 0) return 0;

    let overlap = 0;
    for (const term of queryTerms) {
      if (docTerms.has(term)) overlap++;
    }

    // Jaccard-like similarity with query bias
    const precision = overlap / docTerms.size;
    const recall = overlap / queryTerms.size;
    
    // F1-like score
    return precision > 0 && recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  }

  /**
   * Calculate phrase matching score.
   * Rewards consecutive term matches.
   */
  private calculatePhraseScore(query: string, document: string): number {
    const queryLower = query.toLowerCase();
    const docLower = document.toLowerCase();

    // Check for exact phrase match
    if (docLower.includes(queryLower)) {
      return 1.0;
    }

    // Check for partial phrase matches
    const queryWords = queryLower.split(/\s+/);
    let maxPhraseLen = 0;

    for (let start = 0; start < queryWords.length; start++) {
      for (let end = start + 1; end <= queryWords.length; end++) {
        const phrase = queryWords.slice(start, end).join(' ');
        if (docLower.includes(phrase)) {
          maxPhraseLen = Math.max(maxPhraseLen, end - start);
        }
      }
    }

    return maxPhraseLen / queryWords.length;
  }

  /**
   * Combine multiple signals into a final rerank score.
   */
  private calculateRerankScore(
    query: string,
    result: FusedResult
  ): number {
    const termOverlap = this.calculateTermOverlap(query, result.text);
    const phraseScore = this.calculatePhraseScore(query, result.text);
    
    // Combine with RRF score (weighted)
    const rrfNormalized = result.rrfScore * 10; // Scale up RRF score
    
    // Weighted combination
    return 0.3 * termOverlap + 0.3 * phraseScore + 0.4 * rrfNormalized;
  }

  async rerank(
    query: string,
    results: FusedResult[],
    topK: number = 20
  ): Promise<RerankedResult[]> {
    const reranked: RerankedResult[] = results.map((result, index) => ({
      ...result,
      rerankScore: this.calculateRerankScore(query, result),
      finalRank: index + 1,
    }));

    // Sort by rerank score descending
    reranked.sort((a, b) => b.rerankScore - a.rerankScore);

    // Assign final ranks
    for (let i = 0; i < reranked.length; i++) {
      reranked[i].finalRank = i + 1;
    }

    return reranked.slice(0, topK);
  }
}

/**
 * Cross-Encoder reranker using HuggingFace models.
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
    this.apiUrl = `https://api-inference.huggingface.co/pipeline/reranking/${this.model}`;
  }

  async rerank(
    query: string,
    results: FusedResult[],
    topK: number = 20
  ): Promise<RerankedResult[]> {
    if (results.length === 0) return [];

    const documents = results.map((r) => r.text);

    try {
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
        console.error(`[CrossEncoderReranker] API error: ${response.status} ${errorText}`);
        // Fallback to simple reranking on error
        return this.fallbackRerank(query, results, topK);
      }

      const data = await response.json();
      
      // HuggingFace reranking API returns: [{ corpus_id: number, score: number, text: string }]
      if (!Array.isArray(data)) {
        console.error('[CrossEncoderReranker] Unexpected response format:', data);
        return this.fallbackRerank(query, results, topK);
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
    } catch (error) {
      console.error('[CrossEncoderReranker] Error:', error);
      return this.fallbackRerank(query, results, topK);
    }
  }

  /**
   * Fallback to simple reranking if cross-encoder fails.
   */
  private async fallbackRerank(
    query: string,
    results: FusedResult[],
    topK: number
  ): Promise<RerankedResult[]> {
    console.log('[CrossEncoderReranker] Using fallback simple reranker');
    const simple = new SimpleReranker();
    return simple.rerank(query, results, topK);
  }
}

/**
 * Create a cross-encoder reranker.
 * This is the only reranker type used in production.
 */
export function createReranker(options?: {
  model?: string;
  apiKey?: string;
}): Reranker {
  return new CrossEncoderReranker({
    model: options?.model,
    apiKey: options?.apiKey,
  });
}