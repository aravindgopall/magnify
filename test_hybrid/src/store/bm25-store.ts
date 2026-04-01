/**
 * BM25 indexer for sparse search - designed for persistence.
 * This is a separate module from the indexing/bm25-index.ts for use with ChromaDB store.
 */

import natural from 'natural';

export interface BM25Document {
  id: string;
  text: string;
  tokens: string[];
}

export interface BM25IndexData {
  documents: Array<[string, { text: string; tokens: string[] }]>;
  avgDocLength: number;
  totalDocs: number;
  vocabulary: Map<string, { docFreq: number }>;
}

/**
 * BM25 Indexer for sparse keyword search.
 * Supports persistence via toJSON/loadFromJSON.
 */
export class BM25Indexer {
  private documents: Map<string, BM25Document> = new Map();
  private vocabulary: Map<string, { docFreq: number }> = new Map();
  private avgDocLength: number = 0;
  private totalDocs: number = 0;
  
  // BM25 parameters
  private k1: number = 1.5;
  private b: number = 0.75;
  
  // Tokenizer and stemmer
  private tokenizer: natural.WordTokenizer;
  private stemmer: natural.Stemmer;

  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
  }

  /**
   * Tokenize and stem text.
   */
  private tokenize(text: string): string[] {
    // Lowercase and tokenize
    const tokens = this.tokenizer.tokenize(text.toLowerCase()) || [];
    
    // Remove stopwords and stem
    const stopwords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't',
      'just', 'don', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours',
      'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
      'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
      'this', 'that', 'these', 'those', 'am', 'if', 'because', 'until',
      'while', 'about', 'against', 'both', 'but', 'and', 'or', 'any',
    ]);

    return tokens
      .filter(token => token.length > 1 && !stopwords.has(token))
      .map(token => this.stemmer.stem(token));
  }

  /**
   * Add a document to the index.
   */
  addDocument(id: string, text: string): void {
    const tokens = this.tokenize(text);
    
    // Remove existing document if present
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    // Add document
    this.documents.set(id, { id, text, tokens });
    this.totalDocs++;

    // Update vocabulary
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      const entry = this.vocabulary.get(token);
      if (entry) {
        entry.docFreq++;
      } else {
        this.vocabulary.set(token, { docFreq: 1 });
      }
    }

    // Update average document length
    this.updateAvgDocLength();
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // Update vocabulary
    const uniqueTokens = new Set(doc.tokens);
    for (const token of uniqueTokens) {
      const entry = this.vocabulary.get(token);
      if (entry) {
        entry.docFreq--;
        if (entry.docFreq <= 0) {
          this.vocabulary.delete(token);
        }
      }
    }

    this.documents.delete(id);
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
      totalLength += doc.tokens.length;
    }
    this.avgDocLength = totalLength / this.totalDocs;
  }

  /**
   * Calculate IDF for a term.
   */
  private idf(term: string): number {
    const entry = this.vocabulary.get(term);
    if (!entry) return 0;

    // Standard IDF formula
    return Math.log((this.totalDocs - entry.docFreq + 0.5) / (entry.docFreq + 0.5) + 1);
  }

  /**
   * Calculate BM25 score for a document given a query.
   */
  private scoreDocument(doc: BM25Document, queryTokens: string[]): number {
    if (this.avgDocLength === 0) return 0;

    let score = 0;
    const docLength = doc.tokens.length;
    
    // Count term frequencies in document
    const termFreqs = new Map<string, number>();
    for (const token of doc.tokens) {
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
   */
  search(query: string, topK: number = 50): Array<{ chunkId: string; score: number; text: string }> {
    const queryTokens = this.tokenize(query);
    
    if (queryTokens.length === 0) {
      return [];
    }

    // Score all documents
    const scores: Array<{ id: string; score: number }> = [];
    for (const [id, doc] of this.documents) {
      const score = this.scoreDocument(doc, queryTokens);
      if (score > 0) {
        scores.push({ id, score });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top K with text
    return scores.slice(0, topK).map(({ id, score }) => ({
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
    return {
      totalDocuments: this.totalDocs,
      vocabularySize: this.vocabulary.size,
      avgDocLength: this.avgDocLength,
    };
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.documents.clear();
    this.vocabulary.clear();
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
        { text: doc.text, tokens: doc.tokens },
      ]),
      avgDocLength: this.avgDocLength,
      totalDocs: this.totalDocs,
      vocabulary: this.vocabulary,
    };
  }

  /**
   * Load index from persisted data.
   */
  loadFromJSON(data: BM25IndexData): void {
    this.clear();
    
    // Restore documents
    for (const [id, docData] of data.documents) {
      this.documents.set(id, {
        id,
        text: docData.text,
        tokens: docData.tokens,
      });
    }

    this.avgDocLength = data.avgDocLength;
    this.totalDocs = data.totalDocs;
    
    // Restore vocabulary
    if (data.vocabulary) {
      if (data.vocabulary instanceof Map) {
        this.vocabulary = data.vocabulary;
      } else {
        // Handle case where vocabulary was serialized as object
        this.vocabulary = new Map(Object.entries(data.vocabulary as any));
      }
    }
  }
}