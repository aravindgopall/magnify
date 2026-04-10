/**
 * BM25 indexer for sparse search - designed for persistence.
 * Uses FlexSearch for consistent tokenization with the query-side BM25 index
 * (src/indexing/bm25-index.ts), ensuring that the same word is tokenized
 * identically during both ingest and query.
 */

import { Index } from 'flexsearch';
import { tokenize } from '../utils/index.js';

export interface BM25Document {
  id: string;
  text: string;
}

export interface BM25IndexData {
  documents: Array<[string, string]>;
  avgDocLength: number;
  totalDocs: number;
}

/**
 * BM25 Indexer for sparse keyword search.
 * Uses FlexSearch for tokenization (consistent with bm25-index.ts).
 * Supports persistence via toJSON/loadFromJSON.
 */
export class BM25Indexer {
  private documents: Map<string, BM25Document> = new Map();
  private avgDocLength: number = 0;
  private totalDocs: number = 0;

  // BM25 parameters
  private k1: number = 1.5;
  private b: number = 0.75;

  // FlexSearch index for tokenization and initial retrieval
  private flexIndex: Index;

  constructor() {
    this.flexIndex = new Index({
      preset: 'score',
      tokenize: 'forward',
      resolution: 9,
      cache: true,
    });
  }

  /**
   * Add a document to the index.
   */
  addDocument(id: string, text: string): void {
    // Remove existing document if present
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    // Add document
    this.documents.set(id, { id, text });
    this.totalDocs++;

    // Add to FlexSearch index
    this.flexIndex.add(id, text);

    // Update average document length
    this.updateAvgDocLength();
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    this.documents.delete(id);
    this.flexIndex.remove(id);
    this.totalDocs--;
    this.updateAvgDocLength();

    return true;
  }

  /**
   * Update average document length.
   */
  private updateAvgDocLength(): void {
    if (this.totalDocs === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const doc of this.documents.values()) {
      totalLength += tokenize(doc.text).length;
    }
    this.avgDocLength = totalLength / this.totalDocs;
  }

  /**
   * Calculate IDF for a term.
   */
  private idf(term: string): number {
    let docFreq = 0;
    const lowerTerm = term.toLowerCase();
    for (const doc of this.documents.values()) {
      if (doc.text.toLowerCase().includes(lowerTerm)) {
        docFreq++;
      }
    }

    return Math.log((this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
  }

  /**
   * Calculate BM25 score for a document given a query.
   */
  private scoreDocument(doc: BM25Document, queryTokens: string[]): number {
    if (this.avgDocLength === 0) return 0;

    const docTokens = tokenize(doc.text);
    const docLength = docTokens.length;
    let score = 0;

    // Count term frequencies in document
    const termFreqs = new Map<string, number>();
    for (const token of docTokens) {
      termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
    }

    // Calculate score for each query term
    for (const queryToken of queryTokens) {
      const tf = termFreqs.get(queryToken) || 0;
      if (tf === 0) continue;

      const idf = this.idf(queryToken);

      // BM25 scoring formula
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Search for documents matching a query.
   * Uses FlexSearch for initial candidate retrieval, then re-scores with BM25.
   */
  search(query: string, topK: number = 50): Array<{ chunkId: string; score: number; text: string }> {
    if (!query.trim()) return [];

    const queryTokens = tokenize(query);

    if (queryTokens.length === 0) {
      return [];
    }

    // Step 1: Use FlexSearch to get candidate matches
    const flexResults = this.flexIndex.search(query, { limit: topK * 2 }) as string[];

    if (flexResults.length === 0) {
      // Fallback: score all documents if FlexSearch returns nothing
      const scores: Array<{ id: string; score: number }> = [];
      for (const [id, doc] of this.documents) {
        const score = this.scoreDocument(doc, queryTokens);
        if (score > 0) {
          scores.push({ id, score });
        }
      }
      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, topK).map(({ id, score }) => ({
        chunkId: id,
        score,
        text: this.documents.get(id)?.text || '',
      }));
    }

    // Step 2: Re-score FlexSearch candidates with BM25
    const scoredResults: Array<{ id: string; score: number }> = [];
    for (const chunkId of flexResults) {
      const doc = this.documents.get(chunkId);
      if (!doc) continue;
      const bm25Score = this.scoreDocument(doc, queryTokens);
      if (bm25Score > 0) {
        scoredResults.push({ id: chunkId, score: bm25Score });
      }
    }

    // Sort by BM25 score descending
    scoredResults.sort((a, b) => b.score - a.score);

    // Return top K with text
    return scoredResults.slice(0, topK).map(({ id, score }) => ({
      chunkId: id,
      score,
      text: this.documents.get(id)?.text || '',
    }));
  }

  /**
   * Get index statistics.
   */
  getStats(): {
    totalDocuments: number;
    vocabularySize: number;
    avgDocLength: number;
  } {
    // Estimate vocabulary size from all documents
    const termSet = new Set<string>();
    for (const doc of this.documents.values()) {
      const tokens = tokenize(doc.text);
      for (const token of tokens) {
        termSet.add(token);
      }
    }

    return {
      totalDocuments: this.totalDocs,
      vocabularySize: termSet.size,
      avgDocLength: this.avgDocLength,
    };
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.documents.clear();
    this.flexIndex = new Index({
      preset: 'score',
      tokenize: 'forward',
      resolution: 9,
      cache: true,
    });
    this.avgDocLength = 0;
    this.totalDocs = 0;
  }

  /**
   * Export index for persistence.
   */
  toJSON(): BM25IndexData {
    return {
      documents: Array.from(this.documents.entries()).map(([id, doc]) => [
        id,
        doc.text,
      ]),
      avgDocLength: this.avgDocLength,
      totalDocs: this.totalDocs,
    };
  }

  /**
   * Load index from persisted data.
   */
  loadFromJSON(data: BM25IndexData): void {
    this.clear();

    // Restore documents and rebuild FlexSearch index
    if (data.documents) {
      for (const [id, text] of data.documents) {
        this.documents.set(id, { id, text });
        this.flexIndex.add(id, text);
      }
    }

    this.avgDocLength = data.avgDocLength || 0;
    this.totalDocs = data.totalDocs || 0;

    // Recalculate avgDocLength if not provided
    if (this.avgDocLength === 0 && this.totalDocs > 0) {
      this.updateAvgDocLength();
    }
  }
}