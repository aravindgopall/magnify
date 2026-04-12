import type {
  Chunk,
  DenseSearchResult,
  SparseSearchResult,
  FusedResult,
  RerankedResult,
  RRFConfig,
  HybridSearchConfig,
} from '../types/index.js';
import { DEFAULT_HYBRID_SEARCH_CONFIG } from '../types/index.js';
import { BM25Indexer, createBM25Indexer } from './bm25-index.js';
import { DenseIndexer, createDenseIndexer, EmbeddingProvider, createEmbeddingProvider } from './dense-index.js';

/**
 * Reciprocal Rank Fusion (RRF) implementation.
 * 
 * RRF formula: score = Σ 1/(k + rank_i)
 * Where k is typically 60.
 * 
 * This bubbles up chunks that rank highly on both semantic and keyword lists.
 */
export function reciprocalRankFusion(
  denseResults: DenseSearchResult[],
  sparseResults: SparseSearchResult[],
  config: { k: number; topK: number } = { k: 60, topK: 50 }
): FusedResult[] {
  const rrfScores = new Map<string, { denseRank?: number; sparseRank?: number; rrfScore: number; text: string; metadata: any }>();

  // Process dense results
  for (let i = 0; i < denseResults.length; i++) {
    const result = denseResults[i];
    const rank = i + 1; // 1-based rank
    const existing = rrfScores.get(result.chunkId) || {
      rrfScore: 0,
      text: result.text,
      metadata: result.metadata,
    };
    existing.denseRank = rank;
    existing.rrfScore += 1 / (config.k + rank);
    rrfScores.set(result.chunkId, existing);
  }

  // Process sparse results
  for (let i = 0; i < sparseResults.length; i++) {
    const result = sparseResults[i];
    const rank = i + 1; // 1-based rank
    const existing = rrfScores.get(result.chunkId) || {
      rrfScore: 0,
      text: result.text,
      metadata: result.metadata,
    };
    existing.sparseRank = rank;
    existing.rrfScore += 1 / (config.k + rank);
    rrfScores.set(result.chunkId, existing);
  }

  // Sort by RRF score descending
  const sortedResults = Array.from(rrfScores.entries())
    .map(([chunkId, data]) => ({
      chunkId,
      score: data.rrfScore,
      text: data.text,
      metadata: data.metadata,
      denseRank: data.denseRank,
      sparseRank: data.sparseRank,
      rrfScore: data.rrfScore,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore);

  return sortedResults.slice(0, config.topK);
}

/**
 * Master RRF Fusion for combining results from multiple subagents.
 * Aggregates ranked lists from multiple sources and produces a final ranking.
 */
export function masterRRFFusion(
  subagentResults: Array<RerankedResult[]>,
  config: { k: number; topK: number } = { k: 60, topK: 50 }
): Array<RerankedResult & { agreementCount: number; sourceAgents: string[]; masterRrfScore: number }> {
  const masterScores = new Map<string, {
    result: RerankedResult;
    agreementCount: number;
    sourceAgents: string[];
    masterRrfScore: number;
  }>();

  // Process each subagent's results
  for (let agentIdx = 0; agentIdx < subagentResults.length; agentIdx++) {
    const results = subagentResults[agentIdx];
    const agentId = `agent-${agentIdx}`;

    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      const existing = masterScores.get(result.chunkId);

      if (existing) {
        // Chunk already seen by another agent - update score and agreement
        existing.masterRrfScore += 1 / (config.k + rank + 1);
        existing.agreementCount += 1;
        existing.sourceAgents.push(agentId);
      } else {
        // New chunk
        masterScores.set(result.chunkId, {
          result,
          agreementCount: 1,
          sourceAgents: [agentId],
          masterRrfScore: 1 / (config.k + rank + 1),
        });
      }
    }
  }

  // Sort by master RRF score
  const sortedResults = Array.from(masterScores.values())
    .map((data) => ({
      ...data.result,
      agreementCount: data.agreementCount,
      sourceAgents: data.sourceAgents,
      masterRrfScore: data.masterRrfScore,
    }))
    .sort((a, b) => b.masterRrfScore - a.masterRrfScore);

  return sortedResults.slice(0, config.topK);
}

/**
 * Hybrid Index that combines dense vector search and BM25 sparse search.
 * Stores chunks and supports dual indexing.
 */
export class HybridIndexer {
  private denseIndexer: DenseIndexer;
  private sparseIndexer: BM25Indexer;
  private chunkStore: Map<string, Chunk>;
  private embeddingProvider: EmbeddingProvider;
  private config: HybridSearchConfig;

  constructor(
    config: Partial<HybridSearchConfig> = {},
    embeddingProvider?: EmbeddingProvider
  ) {
    this.config = { ...DEFAULT_HYBRID_SEARCH_CONFIG, ...config };
    this.chunkStore = new Map();
    
    this.denseIndexer = createDenseIndexer(
      this.config.embeddingDimensions,
      this.config.embeddingModel
    );
    
    this.sparseIndexer = createBM25Indexer(
      this.config.bm25K1,
      this.config.bm25B
    );

    this.embeddingProvider = embeddingProvider || createEmbeddingProvider({
      type: 'mock',
      dimensions: this.config.embeddingDimensions,
    });
  }

  /**
   * Add a chunk to both indexes.
   */
  async addChunk(chunk: Chunk): Promise<void> {
    // Get embedding for the chunk
    const embedding = await this.embeddingProvider.embedSingle(chunk.text);

    // Add to both indexes
    this.denseIndexer.addEmbedding(chunk, embedding);
    this.sparseIndexer.addChunk(chunk);
    this.chunkStore.set(chunk.id, chunk);
  }

  /**
   * Add multiple chunks to both indexes.
   */
  async addChunks(chunks: Chunk[]): Promise<void> {
    // Batch embedding for efficiency
    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embeddingProvider.embed(texts);

    for (let i = 0; i < chunks.length; i++) {
      this.denseIndexer.addEmbedding(chunks[i], embeddings[i]);
      this.sparseIndexer.addChunk(chunks[i]);
      this.chunkStore.set(chunks[i].id, chunks[i]);
    }
  }

  /**
   * Add multiple chunks with pre-computed embeddings (no embedding generation needed).
   * Use this when loading from a persisted index that already has embeddings.
   */
  addChunksWithEmbeddings(chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings must have the same length');
    }

    for (let i = 0; i < chunks.length; i++) {
      this.denseIndexer.addEmbedding(chunks[i], embeddings[i]);
      this.sparseIndexer.addChunk(chunks[i]);
      this.chunkStore.set(chunks[i].id, chunks[i]);
    }
  }

  /**
   * Remove a chunk from both indexes.
   */
  removeChunk(chunkId: string): boolean {
    const existed =
      this.denseIndexer.removeEmbedding(chunkId) ||
      this.sparseIndexer.removeChunk(chunkId);
    this.chunkStore.delete(chunkId);
    return existed;
  }

  /**
   * Execute hybrid search: parallel dense and sparse search with RRF fusion.
   */
  async search(
    query: string,
    topK: number = this.config.topKCandidates
  ): Promise<FusedResult[]> {
    const startTime = Date.now();

    // Get query embedding for dense search
    const queryEmbedding = await this.embeddingProvider.embedSingle(query);

    // Execute both searches in parallel
    const [denseResults, sparseResults] = await Promise.all([
      Promise.resolve(this.denseIndexer.search(queryEmbedding, topK)),
      Promise.resolve(this.sparseIndexer.search(query, topK)),
    ]);

    console.log(`[HybridSearch] Dense results: ${denseResults.length}, Sparse results: ${sparseResults.length}`);

    // Combine using RRF fusion
    const fusedResults = reciprocalRankFusion(denseResults, sparseResults, {
      k: this.config.rrfK,
      topK,
    });

    console.log(`[HybridSearch] Fused results: ${fusedResults.length} (${Date.now() - startTime}ms)`);

    return fusedResults;
  }

  /**
   * Execute hybrid search with multiple sub-queries (for subagent use).
   * 
   * Uses proper multi-list RRF: each query produces a dense and sparse ranked list,
   * and RRF is applied across ALL lists (2 * numQueries total lists).
   * This avoids over-weighting chunks that appear in multiple sub-query results.
   */
  async searchMultiQuery(
    queries: string[],
    topK: number = this.config.topKCandidates
  ): Promise<FusedResult[]> {
    // Collect all raw ranked lists from each query's dense and sparse search
    const allDenseLists: DenseSearchResult[][] = [];
    const allSparseLists: SparseSearchResult[][] = [];

    for (const q of queries) {
      const queryEmbedding = await this.embeddingProvider.embedSingle(q);
      const denseResults = this.denseIndexer.search(queryEmbedding, topK);
      const sparseResults = this.sparseIndexer.search(q, topK);
      allDenseLists.push(denseResults);
      allSparseLists.push(sparseResults);
    }

    // Apply proper multi-list RRF across ALL ranked lists (dense + sparse for each query)
    const rrfScores = new Map<string, { rrfScore: number; text: string; metadata: any; denseRank?: number; sparseRank?: number }>();

    for (const resultList of [...allDenseLists, ...allSparseLists]) {
      for (let rank = 0; rank < resultList.length; rank++) {
        const result = resultList[rank];
        const existing = rrfScores.get(result.chunkId);
        if (existing) {
          existing.rrfScore += 1 / (this.config.rrfK + rank + 1);
        } else {
          rrfScores.set(result.chunkId, {
            rrfScore: 1 / (this.config.rrfK + rank + 1),
            text: result.text,
            metadata: result.metadata,
          });
        }
      }
    }

    // Sort by RRF score
    return Array.from(rrfScores.entries())
      .map(([chunkId, data]) => ({
        chunkId,
        score: data.rrfScore,
        text: data.text,
        metadata: data.metadata,
        denseRank: data.denseRank,
        sparseRank: data.sparseRank,
        rrfScore: data.rrfScore,
      }))
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK);
  }

  /**
   * Get a chunk by ID.
   */
  getChunk(chunkId: string): Chunk | undefined {
    return this.chunkStore.get(chunkId);
  }

  /**
   * Get multiple chunks by IDs.
   */
  getChunks(chunkIds: string[]): Chunk[] {
    return chunkIds
      .map((id) => this.chunkStore.get(id))
      .filter((c): c is Chunk => c !== undefined);
  }

  /**
   * Get all chunks.
   */
  getAllChunks(): Chunk[] {
    return Array.from(this.chunkStore.values());
  }

  /**
   * Get index statistics.
   */
  getStats(): {
    totalChunks: number;
    dense: { totalVectors: number; dimensions: number; model: string };
    sparse: { totalDocuments: number; avgDocumentLength: number; vocabularySize: number };
  } {
    return {
      totalChunks: this.chunkStore.size,
      dense: this.denseIndexer.getStats(),
      sparse: this.sparseIndexer.getStats(),
    };
  }

  /**
   * Clear all indexes.
   */
  clear(): void {
    this.denseIndexer.clear();
    this.sparseIndexer.clear();
    this.chunkStore.clear();
  }

}

/**
 * Create a hybrid indexer.
 */
export function createHybridIndexer(
  config?: Partial<HybridSearchConfig>,
  embeddingProvider?: EmbeddingProvider
): HybridIndexer {
  return new HybridIndexer(config, embeddingProvider);
}