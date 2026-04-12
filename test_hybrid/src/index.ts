/**
 * Hybrid Search System - Multi-hop Retrieval with Parallel Subagents
 * 
 * Architecture:
 * 1. Document Ingestion & Indexing (512-token chunks, dual dense/sparse indexing)
 * 2. Query Reception & Parallel Subagent Spawning (4 subagents by default)
 * 3. Observe-Reason-Act Loop (per subagent, with RRF fusion and reranking)
 * 4. Master RRF Fusion (aggregates all subagent results)
 * 5. Main Agent Synthesis (generates final answer)
 * 
 * Technical Stack:
 * - Dense Vector Search: Semantic similarity using embeddings
 * - Sparse BM25 Index: Keyword/exact matching (FlexSearch)
 * - RRF Fusion: Reciprocal Rank Fusion for combining search results
 * - Cross-Encoder Reranking: Precise relevance scoring
 * - Multi-hop Retrieval: Iterative query refinement
 */

// ============================================================================
// Types - explicit exports only (no unused Zod schemas)
// ============================================================================
export type {
  ChunkType,
  Chunk,
  ChunkMetadata,
  Document,
  DocumentMetadata,
  SearchResult,
  DenseSearchResult,
  SparseSearchResult,
  FusedResult,
  RerankedResult,
  RRFConfig,
  SubagentState,
  SubagentMemory,
  SubagentResult,
  AgentAction,
  AgentObservation,
  MasterRankedList,
  MasterRankedChunk,
  QueryRequest,
  QueryOptions,
  QueryResponse,
  SourceReference,
  QueryMetadata,
  DenseIndex,
  HybridSearchConfig,
} from './types/index.js';

export {
  DEFAULT_RRF_CONFIG,
  DEFAULT_HYBRID_SEARCH_CONFIG,
} from './types/index.js';

// ============================================================================
// Indexing
// ============================================================================
export {
  estimateTokenCount,
  chunkText,
  chunkDocument,
  createDocument,
  createChunksFromExtractedContent,
  BM25Indexer as FlexSearchBM25Indexer,
  createBM25Indexer,
  cosineSimilarity,
  DenseIndexer,
  createDenseIndexer,
  EmbeddingProvider,
  MockEmbeddingProvider,
  BGEM3EmbeddingProvider,
  LocalBGEM3Provider,
  createEmbeddingProvider,
  reciprocalRankFusion,
  masterRRFFusion,
  HybridIndexer,
  createHybridIndexer,
} from './indexing/index.js';

// ============================================================================
// Search
// ============================================================================
export {
  Reranker,
  LocalCrossEncoderReranker,
  CrossEncoderReranker,
  createReranker,
} from './search/index.js';

// ============================================================================
// Agents
// ============================================================================
export {
  RetrievalSubagent,
  createRetrievalSubagent,
  HybridSearchAgent,
  createHybridSearchAgent,
} from './agent/index.js';

// ============================================================================
// Convenience
// ============================================================================
import { HybridSearchAgent, createHybridSearchAgent } from './agent/hybrid-search-agent.js';
import { HybridIndexer, createHybridIndexer } from './indexing/hybrid-index.js';
import { createReranker } from './search/reranker.js';
import { createDocument } from './indexing/chunker.js';
import type { HybridSearchConfig, QueryRequest, QueryResponse } from './types/index.js';

/**
 * Quick start: Create a complete hybrid search system.
 */
export async function createSearchSystem(config?: Partial<HybridSearchConfig>): Promise<{
  agent: HybridSearchAgent;
  indexer: HybridIndexer;
  indexDocument: (text: string, options?: { id?: string; fileName?: string }) => Promise<{ documentId: string; chunkCount: number }>;
  query: (query: string) => Promise<QueryResponse>;
}> {
  const agent = createHybridSearchAgent(undefined, undefined, config);
  
  return {
    agent,
    indexer: agent.getStats() as any,
    indexDocument: async (text: string, options?: { id?: string; fileName?: string }) => {
      return agent.indexDocument(text, options);
    },
    query: async (query: string) => {
      return agent.query({ query });
    },
  };
}

// Default export
export default {
  createSearchSystem,
  createHybridSearchAgent,
  createHybridIndexer,
  createReranker,
  createDocument,
};