import type { BM25Index, BM25IndexEntry, Chunk, SparseSearchResult } from '../types/index.js';

/**
 * Tokenize text into lowercase terms.
 * Removes punctuation and splits on whitespace.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Calculate term frequencies for a list of tokens.
 */
function calculateTermFrequencies(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return frequencies;
}

/**
 * BM25 Index implementation for sparse keyword search.
 * 
 * BM25 scoring formula:
 * score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D|/avgdl))
 * 
 * Where:
 * - D = document
 * - Q = query terms
 * - f(qi, D) = term frequency of qi in D
 * - |D| = document length (in terms)
 * - avgdl = average document length
 * - k1 = term frequency saturation parameter (typically 1.2-2.0)
 * - b = length normalization parameter (typically 0.75)
 * - IDF(qi) = log((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
 *   - N = total number of documents
 *   - n(qi) = number of documents containing qi
 */
export class BM25Indexer {
  private index: BM25Index;
  private chunkStore: Map<string, Chunk>;

  constructor(k1: number = 1.5, b: number = 0.75) {
    this.index = {
      documents: new Map(),
      avgDocumentLength: 0,
      totalDocuments: 0,
      documentFrequency: new Map(),
      k1,
      b,
    };
    this.chunkStore = new Map();
  }

  /**
   * Add a chunk to the index.
   */
  addChunk(chunk: Chunk): void {
    const tokens = tokenize(chunk.text);
    const termFrequencies = calculateTermFrequencies(tokens);

    const entry: BM25IndexEntry = {
      chunkId: chunk.id,
      text: chunk.text,
      tokens,
      termFrequencies,
      documentLength: tokens.length,
    };

    this.index.documents.set(chunk.id, entry);
    this.chunkStore.set(chunk.id, chunk);

    // Update document frequency for each term
    const seenTerms = new Set<string>();
    for (const token of tokens) {
      if (!seenTerms.has(token)) {
        this.index.documentFrequency.set(
          token,
          (this.index.documentFrequency.get(token) || 0) + 1
        );
        seenTerms.add(token);
      }
    }

    // Update statistics
    this.index.totalDocuments = this.index.documents.size;
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
    const entry = this.index.documents.get(chunkId);
    if (!entry) return false;

    // Update document frequency
    const seenTerms = new Set<string>();
    for (const token of entry.tokens) {
      if (!seenTerms.has(token)) {
        const currentDf = this.index.documentFrequency.get(token) || 0;
        if (currentDf > 1) {
          this.index.documentFrequency.set(token, currentDf - 1);
        } else {
          this.index.documentFrequency.delete(token);
        }
        seenTerms.add(token);
      }
    }

    this.index.documents.delete(chunkId);
    this.chunkStore.delete(chunkId);

    // Update statistics
    this.index.totalDocuments = this.index.documents.size;
    this.updateAverageDocumentLength();

    return true;
  }

  /**
   * Update the average document length.
   */
  private updateAverageDocumentLength(): void {
    if (this.index.documents.size === 0) {
      this.index.avgDocumentLength = 0;
      return;
    }

    let totalLength = 0;
    for (const entry of this.index.documents.values()) {
      totalLength += entry.documentLength;
    }
    this.index.avgDocumentLength = totalLength / this.index.documents.size;
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term.
   */
  private calculateIDF(term: string): number {
    const n = this.index.documentFrequency.get(term) || 0;
    const N = this.index.totalDocuments;
    // BM25 IDF formula
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  }

  /**
   * Calculate BM25 score for a document given query terms.
   */
  private calculateBM25Score(entry: BM25IndexEntry, queryTerms: string[]): number {
    const { k1, b, avgDocumentLength } = this.index;
    let score = 0;

    for (const term of queryTerms) {
      const tf = entry.termFrequencies.get(term) || 0;
      if (tf === 0) continue;

      const idf = this.calculateIDF(term);
      const docLength = entry.documentLength;

      // BM25 term score
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocumentLength));
      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Search for documents matching the query.
   * Returns top-k results sorted by BM25 score.
   */
  search(query: string, topK: number = 50): SparseSearchResult[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const scores: Array<{ chunkId: string; score: number; matchedTerms: string[] }> = [];

    // Score all documents
    for (const [chunkId, entry] of this.index.documents) {
      const score = this.calculateBM25Score(entry, queryTerms);
      if (score > 0) {
        // Find which terms matched
        const matchedTerms = queryTerms.filter((term) => entry.termFrequencies.has(term));
        scores.push({ chunkId, score, matchedTerms });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top-k results
    return scores.slice(0, topK).map((result, index) => {
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
   * Get the chunk by ID.
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
    return {
      totalDocuments: this.index.totalDocuments,
      avgDocumentLength: this.index.avgDocumentLength,
      vocabularySize: this.index.documentFrequency.size,
      k1: this.index.k1,
      b: this.index.b,
    };
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.index.documents.clear();
    this.index.documentFrequency.clear();
    this.index.totalDocuments = 0;
    this.index.avgDocumentLength = 0;
    this.chunkStore.clear();
  }

  /**
   * Export index for persistence.
   */
  export(): {
    documents: Array<[string, { chunkId: string; text: string; tokens: string[]; termFrequencies: Array<[string, number]>; documentLength: number }]>;
    documentFrequency: Array<[string, number]>;
    stats: {
      avgDocumentLength: number;
      totalDocuments: number;
      k1: number;
      b: number;
    };
  } {
    return {
      documents: Array.from(this.index.documents.entries()).map(([id, entry]) => [
        id,
        {
          chunkId: entry.chunkId,
          text: entry.text,
          tokens: entry.tokens,
          termFrequencies: Array.from(entry.termFrequencies.entries()),
          documentLength: entry.documentLength,
        },
      ]),
      documentFrequency: Array.from(this.index.documentFrequency.entries()),
      stats: {
        avgDocumentLength: this.index.avgDocumentLength,
        totalDocuments: this.index.totalDocuments,
        k1: this.index.k1,
        b: this.index.b,
      },
    };
  }

  /**
   * Get the underlying index.
   */
  getIndex(): BM25Index {
    return this.index;
  }

  /**
   * Get all chunks in the store.
   */
  getAllChunks(): Chunk[] {
    return Array.from(this.chunkStore.values());
  }
}

/**
 * Create a BM25 indexer.
 */
export function createBM25Indexer(k1?: number, b?: number): BM25Indexer {
  return new BM25Indexer(k1, b);
}