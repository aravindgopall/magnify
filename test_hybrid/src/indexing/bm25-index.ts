import { Index } from 'flexsearch';
import type { Chunk, SparseSearchResult } from '../types/index.js';
import { tokenize } from '../utils/index.js';

/**
 * BM25-compatible sparse index using FlexSearch.
 * 
 * FlexSearch is a high-performance full-text search library that provides
 * BM25-like scoring with advanced tokenization, stemming, and phonetic matching.
 * 
 * Configuration:
 * - preset: "score" optimizes for relevance scoring (BM25-like)
 * - tokenize: "forward" provides subword matching with good performance
 * - resolution: 9 provides maximum scoring precision
 */
export class BM25Indexer {
  private index: Index;
  private chunkStore: Map<string, Chunk>;
  private documentLengths: Map<string, number>;
  private totalDocuments: number;
  private avgDocumentLength: number;
  private k1: number;
  private b: number;

  constructor(k1: number = 1.5, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.chunkStore = new Map();
    this.documentLengths = new Map();
    this.totalDocuments = 0;
    this.avgDocumentLength = 0;

    // Create FlexSearch index with scoring-optimized preset
    this.index = new Index({
      preset: 'score',
      tokenize: 'forward',
      resolution: 9,
      cache: true,
    });
  }

  /**
   * Add a chunk to the index.
   */
  addChunk(chunk: Chunk): void {
    const tokens = tokenize(chunk.text);
    
    // Store chunk for retrieval
    this.chunkStore.set(chunk.id, chunk);
    this.documentLengths.set(chunk.id, tokens.length);

    // Add to FlexSearch index
    this.index.add(chunk.id, chunk.text);

    // Update statistics
    this.totalDocuments = this.chunkStore.size;
    this.updateAverageDocumentLength();
  }

  /**
   * Add multiple chunks to the index.
   */
  addChunks(chunks: Chunk[]): void {
    for (const chunk of chunks) {
      this.addChunk(chunk);
    }
  }

  /**
   * Remove a chunk from the index.
   */
  removeChunk(chunkId: string): boolean {
    if (!this.chunkStore.has(chunkId)) return false;

    this.chunkStore.delete(chunkId);
    this.documentLengths.delete(chunkId);
    this.index.remove(chunkId);

    // Update statistics
    this.totalDocuments = this.chunkStore.size;
    this.updateAverageDocumentLength();

    return true;
  }

  /**
   * Update the average document length.
   */
  private updateAverageDocumentLength(): void {
    if (this.documentLengths.size === 0) {
      this.avgDocumentLength = 0;
      return;
    }

    let totalLength = 0;
    for (const length of this.documentLengths.values()) {
      totalLength += length;
    }
    this.avgDocumentLength = totalLength / this.documentLengths.size;
  }

  /**
   * Search for documents matching the query.
   * Returns top-k results sorted by relevance score.
   * 
   * Uses FlexSearch for initial retrieval, then applies BM25 scoring
   * for final ranking to maintain consistency with the hybrid search pipeline.
   */
  search(query: string, topK: number = 50): SparseSearchResult[] {
    if (!query.trim()) return [];

    // Step 1: Use FlexSearch to get candidate matches
    // FlexSearch returns IDs sorted by its internal scoring
    const flexResults = this.index.search(query, { limit: topK * 2 }) as string[];
    
    if (flexResults.length === 0) return [];

    // Step 2: Re-score candidates using BM25 formula for consistency
    // with the hybrid search pipeline
    const queryTerms = tokenize(query);
    const scoredResults: Array<{
      chunkId: string;
      score: number;
      matchedTerms: string[];
    }> = [];

    for (const chunkId of flexResults) {
      const chunk = this.chunkStore.get(chunkId);
      if (!chunk) continue;

      const bm25Score = this.calculateBM25Score(chunk.text, queryTerms);
      const matchedTerms = queryTerms.filter((term) =>
        chunk.text.toLowerCase().includes(term)
      );

      scoredResults.push({
        chunkId,
        score: bm25Score,
        matchedTerms,
      });
    }

    // Sort by BM25 score descending
    scoredResults.sort((a, b) => b.score - a.score);

    // Return top-k results
    return scoredResults.slice(0, topK).map((result) => {
      const chunk = this.chunkStore.get(result.chunkId)!;
      return {
        chunkId: result.chunkId,
        score: result.score,
        text: chunk.text,
        metadata: chunk.metadata,
        bm25Score: result.score,
        matchedTerms: result.matchedTerms,
      };
    });
  }

  /**
   * Calculate BM25 score for a document given query terms.
   * 
   * BM25 scoring formula:
   * score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D|/avgdl))
   */
  private calculateBM25Score(documentText: string, queryTerms: string[]): number {
    const docTerms = tokenize(documentText);
    const docLength = docTerms.length;
    
    // Guard against division by zero: if avgDocumentLength is 0, skip length normalization
    const lengthNorm = this.avgDocumentLength > 0
      ? docLength / this.avgDocumentLength
      : 1.0;
    
    // Calculate term frequencies
    const termFreqs = new Map<string, number>();
    for (const term of docTerms) {
      termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
    }

    let score = 0;

    for (const term of queryTerms) {
      const tf = termFreqs.get(term) || 0;
      if (tf === 0) continue;

      const idf = this.calculateIDF(term);
      
      // BM25 term score
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * lengthNorm);
      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term.
   * Uses document frequency from chunk store analysis.
   */
  private calculateIDF(term: string): number {
    // Count documents containing the term
    let n = 0;
    for (const chunk of this.chunkStore.values()) {
      if (chunk.text.toLowerCase().includes(term)) {
        n++;
      }
    }
    
    const N = this.totalDocuments;
    // BM25 IDF formula
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  }

  /**
   * Get a chunk by ID.
   */
  getChunk(chunkId: string): Chunk | undefined {
    return this.chunkStore.get(chunkId);
  }

  /**
   * Get index statistics.
   */
  getStats(): {
    totalDocuments: number;
    avgDocumentLength: number;
    vocabularySize: number;
    k1: number;
    b: number;
  } {
    // Estimate vocabulary size
    const termSet = new Set<string>();
    for (const chunk of this.chunkStore.values()) {
      const tokens = tokenize(chunk.text);
      for (const token of tokens) {
        termSet.add(token);
      }
    }

    return {
      totalDocuments: this.totalDocuments,
      avgDocumentLength: this.avgDocumentLength,
      vocabularySize: termSet.size,
      k1: this.k1,
      b: this.b,
    };
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.index = new Index({
      preset: 'score',
      tokenize: 'forward',
      resolution: 9,
      cache: true,
    });
    this.chunkStore.clear();
    this.documentLengths.clear();
    this.totalDocuments = 0;
    this.avgDocumentLength = 0;
  }

  /**
   * Export index data for persistence.
   */
  export(): {
    chunks: Array<{ id: string; text: string; documentLength: number }>;
    stats: {
      avgDocumentLength: number;
      totalDocuments: number;
      k1: number;
      b: number;
    };
  } {
    const chunks: Array<{ id: string; text: string; documentLength: number }> = [];
    for (const [id, chunk] of this.chunkStore) {
      chunks.push({
        id,
        text: chunk.text,
        documentLength: this.documentLengths.get(id) || 0,
      });
    }

    return {
      chunks,
      stats: {
        avgDocumentLength: this.avgDocumentLength,
        totalDocuments: this.totalDocuments,
        k1: this.k1,
        b: this.b,
      },
    };
  }

  /**
   * Get all chunks in the store.
   */
  getAllChunks(): Chunk[] {
    return Array.from(this.chunkStore.values());
  }

}

/**
 * Create a BM25 indexer using FlexSearch.
 */
export function createBM25Indexer(k1?: number, b?: number): BM25Indexer {
  return new BM25Indexer(k1, b);
}