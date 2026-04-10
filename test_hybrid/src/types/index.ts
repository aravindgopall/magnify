// ============================================================================
// DOCUMENT & CHUNK TYPES
// ============================================================================

/**
 * Type of content in a chunk.
 */
export type ChunkType = 'text' | 'table' | 'image';

/**
 * A single chunk of text from a document.
 * Chunks are ~512 tokens to prevent vector dilution.
 */
export interface Chunk {
  id: string;
  documentId: string;
  text: string;
  tokenCount: number;
  pageNumber?: number;
  position: number; // Position in the original document
  chunkType: ChunkType; // Type of content: text, table, or image
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  source?: string;
  fileName?: string;
  heading?: string;
  pageNumber?: number;
  previousChunkId?: string;
  nextChunkId?: string;
  [key: string]: unknown;
}

/**
 * Document stored in the system.
 */
export interface Document {
  id: string;
  fileName: string;
  source: string | Buffer;
  metadata: DocumentMetadata;
  chunks: Chunk[];
  indexed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  pageCount?: number;
  totalTokens?: number;
  totalChunks?: number;
  [key: string]: unknown;
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search result from a single search method.
 */
export interface SearchResult {
  chunkId: string;
  score: number;
  text: string;
  metadata: ChunkMetadata;
}

/**
 * Dense vector search result.
 */
export interface DenseSearchResult extends SearchResult {
  embedding?: number[];
}

/**
 * Sparse BM25 search result.
 */
export interface SparseSearchResult extends SearchResult {
  bm25Score: number;
  matchedTerms: string[];
}

/**
 * Fused result after RRF combination.
 */
export interface FusedResult extends SearchResult {
  denseRank?: number;
  sparseRank?: number;
  rrfScore: number;
}

/**
 * Reranked result with cross-encoder score.
 */
export interface RerankedResult extends FusedResult {
  rerankScore: number;
  finalRank: number;
}

// ============================================================================
// RRF (RECIPROCAL RANK FUSION) TYPES
// ============================================================================

export interface RRFConfig {
  k: number; // RRF constant, typically 60
  topK: number; // Number of top candidates to return
}

export const DEFAULT_RRF_CONFIG: RRFConfig = {
  k: 60,
  topK: 50,
};

// ============================================================================
// SUBAGENT TYPES
// ============================================================================

/**
 * State of a retrieval subagent.
 */
export interface SubagentState {
  id: string;
  status: 'idle' | 'searching' | 'reading' | 'evaluating' | 'completed' | 'failed';
  query: string;
  subQueries: string[];
  retrievedChunks: RerankedResult[];
  curatedChunks: RerankedResult[];
  hopCount: number;
  maxHops: number;
  memory: SubagentMemory;
  error?: string;
}

/**
 * Memory/context window for a subagent.
 */
export interface SubagentMemory {
  contextChunks: Map<string, string>; // chunkId -> text
  relevantFindings: string[];
}

/**
 * Result from a single subagent.
 */
export interface SubagentResult {
  agentId: string;
  status: 'success' | 'failed';
  curatedChunks: RerankedResult[];
  relevantFindings: string[];
  hopCount: number;
  tokensUsed: number;
  duration: number;
  error?: string;
}

// ============================================================================
// OBSERVE-REASON-ACT LOOP TYPES
// ============================================================================

export type AgentAction =
  | { type: 'decompose'; query: string }
  | { type: 'search'; query: string; subQueries: string[] }
  | { type: 'read'; chunkIds: string[] }
  | { type: 'hop'; newQuery: string }
  | { type: 'terminate'; reason: string };

export interface AgentObservation {
  currentKnowledge: string;
  missingInformation: string[];
  chunkQuality: Map<string, 'relevant' | 'partial' | 'irrelevant'>;
  shouldHop: boolean;
  shouldTerminate: boolean;
}

// ============================================================================
// MASTER FUSION TYPES
// ============================================================================

/**
 * Master ranked list after aggregating all subagent results.
 */
export interface MasterRankedList {
  chunks: MasterRankedChunk[];
  totalSubagents: number;
  agreementScore: number; // How many subagents agreed on top chunks
}

export interface MasterRankedChunk {
  chunkId: string;
  text: string;
  metadata: ChunkMetadata;
  masterRank: number;
  masterRrfScore: number;
  sourceAgents: string[]; // Which subagents found this chunk
  agreementCount: number; // How many subagents found this chunk
}

// ============================================================================
// QUERY & RESPONSE TYPES
// ============================================================================

export interface QueryRequest {
  query: string;
  documentId?: string; // Optional: limit search to specific document
  options?: QueryOptions;
}

export interface QueryOptions {
  maxHops?: number;
  subagentCount?: number;
  topK?: number;
  rerankTopK?: number;
  extractionType?: 'summary' | 'entities' | 'full' | 'custom';
  customPrompt?: string;
}

export interface QueryResponse {
  answer: string;
  sources: SourceReference[];
  confidence: number;
  metadata: QueryMetadata;
}

export interface SourceReference {
  chunkId: string;
  documentId: string;
  text: string;
  pageNumber?: number;
  relevanceScore: number;
}

export interface QueryMetadata {
  totalChunks: number;
  relevantChunks: number;
  subagentCount: number;
  totalHops: number;
  processingTimeMs: number;
  rerankTimeMs: number;
  fusionTimeMs: number;
}

// ============================================================================
// EMBEDDING & INDEX TYPES
// ============================================================================

export interface DenseIndex {
  embeddings: Map<string, number[]>; // chunkId -> embedding
  model: string;
  dimensions: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface HybridSearchConfig {
  chunkSize: number; // Target tokens per chunk
  chunkOverlap: number; // Token overlap between chunks
  rrfK: number; // RRF constant
  topKCandidates: number; // Top K candidates for reranking
  rerankTopK: number; // Top K after reranking
  subagentCount: number; // Number of parallel subagents
  maxHops: number; // Maximum multi-hop iterations
  embeddingModel: string;
  embeddingDimensions: number;
  bm25K1: number;
  bm25B: number;
}

export const DEFAULT_HYBRID_SEARCH_CONFIG: HybridSearchConfig = {
  chunkSize: 512,
  chunkOverlap: 50,
  rrfK: 60,
  topKCandidates: 50,
  rerankTopK: 20,
  subagentCount: 4,
  maxHops: 3,
  embeddingModel: 'BAAI/bge-m3',
  embeddingDimensions: 1024,
  bm25K1: 1.5,
  bm25B: 0.75,
};
