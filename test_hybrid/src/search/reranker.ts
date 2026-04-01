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
 * For production, replace with actual cross-encoder model.
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
 * LLM-based reranker that uses an LLM to score relevance.
 * More accurate but slower than simple reranking.
 */
export class LLMReranker implements Reranker {
  private llmClient: {
    complete: (prompt: string) => Promise<string>;
  };

  constructor(llmClient: { complete: (prompt: string) => Promise<string> }) {
    this.llmClient = llmClient;
  }

  async rerank(
    query: string,
    results: FusedResult[],
    topK: number = 20
  ): Promise<RerankedResult[]> {
    if (results.length === 0) return [];

    // Batch rerank for efficiency
    const rerankPromises = results.map(async (result, index) => {
      const score = await this.scoreRelevance(query, result.text);
      return {
        ...result,
        rerankScore: score,
        finalRank: index + 1,
      };
    });

    const reranked = await Promise.all(rerankPromises);

    // Sort by rerank score descending
    reranked.sort((a, b) => b.rerankScore - a.rerankScore);

    // Assign final ranks
    for (let i = 0; i < reranked.length; i++) {
      reranked[i].finalRank = i + 1;
    }

    return reranked.slice(0, topK);
  }

  private async scoreRelevance(query: string, document: string): Promise<number> {
    const prompt = `Rate the relevance of this document excerpt to the query on a scale of 0 to 1.

Query: ${query}

Document excerpt: ${document.slice(0, 1000)}

Respond with ONLY a number between 0 and 1, nothing else.`;

    try {
      const response = await this.llmClient.complete(prompt);
      const score = parseFloat(response.trim());
      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch {
      return 0.5;
    }
  }
}

/**
 * Cohere API reranker.
 * Uses Cohere's rerank API for high-quality reranking.
 */
export class CohereReranker implements Reranker {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'rerank-english-v2.0') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async rerank(
    query: string,
    results: FusedResult[],
    topK: number = 20
  ): Promise<RerankedResult[]> {
    if (results.length === 0) return [];

    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: results.map((r) => r.text),
        top_n: Math.min(topK, results.length),
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere rerank API error: ${await response.text()}`);
    }

    const data = await response.json();
    
    return data.results.map((item: any, index: number) => {
      const originalResult = results[item.index];
      return {
        ...originalResult,
        rerankScore: item.relevance_score,
        finalRank: index + 1,
      };
    });
  }
}

/**
 * Create a reranker based on configuration.
 */
export function createReranker(options?: {
  type?: 'simple' | 'llm' | 'cohere';
  apiKey?: string;
  model?: string;
  llmClient?: { complete: (prompt: string) => Promise<string> };
}): Reranker {
  const type = options?.type || 'simple';

  switch (type) {
    case 'cohere':
      if (!options?.apiKey) {
        throw new Error('API key required for Cohere reranker');
      }
      return new CohereReranker(options.apiKey, options.model);

    case 'llm':
      if (!options?.llmClient) {
        throw new Error('LLM client required for LLM reranker');
      }
      return new LLMReranker(options.llmClient);

    default:
      return new SimpleReranker();
  }
}