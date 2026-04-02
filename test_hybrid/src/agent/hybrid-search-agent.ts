import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import type {
  QueryRequest,
  QueryResponse,
  QueryMetadata,
  SourceReference,
  SubagentResult,
  MasterRankedChunk,
  RerankedResult,
  HybridSearchConfig,
} from '../types/index.js';
import { DEFAULT_HYBRID_SEARCH_CONFIG } from '../types/index.js';
import { HybridIndexer, createHybridIndexer, masterRRFFusion } from '../indexing/hybrid-index.js';
import { createReranker, Reranker } from '../search/reranker.js';
import { RetrievalSubagent, createRetrievalSubagent } from './retrieval-subagent.js';
import { SessionLogger, createSessionLogger, type SessionLog } from '../logger/index.js';

// Initialize model registry
const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

/**
 * Get the grid model from models.json
 */
function getGridModel(): Model<'openai-completions'> {
  const model = modelRegistry.find('grid', 'glm-latest');
  if (!model) {
    throw new Error('Grid model "glm-latest" not found in ~/.pi/agent/models.json');
  }
  return model as Model<'openai-completions'>;
}

/**
 * Hybrid Search Agent - The main orchestrator for the multi-hop hybrid search system.
 * 
 * Architecture:
 * 1. Document Ingestion & Indexing (512-token chunks, dual dense/sparse indexing)
 * 2. Query Reception & Parallel Subagent Spawning (4 subagents)
 * 3. Observe-Reason-Act Loop (per subagent, with RRF fusion and reranking)
 * 4. Master RRF Fusion (aggregates all subagent results)
 * 5. Main Agent Synthesis (generates final answer)
 */
export class HybridSearchAgent {
  private indexer: HybridIndexer;
  private reranker: Reranker;
  private config: HybridSearchConfig;
  private synthesisAgent: Agent;
  private logger: SessionLogger | null = null;
  private logDir: string;

  constructor(
    indexer?: HybridIndexer,
    reranker?: Reranker,
    config?: Partial<HybridSearchConfig>,
    logDir?: string
  ) {
    this.config = { ...DEFAULT_HYBRID_SEARCH_CONFIG, ...config };
    this.indexer = indexer || createHybridIndexer(this.config);
    this.reranker = reranker || createReranker({ type: 'simple' });
    this.logDir = logDir || './logs/sessions';

    // Initialize synthesis agent
    const model = getGridModel();
    this.synthesisAgent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: this.buildSynthesisSystemPrompt(),
      },
      getApiKey: async () => {
        const apiKey = await authStorage.getApiKey('grid');
        if (!apiKey) {
          throw new Error('Grid API key not found');
        }
        return apiKey;
      },
    });
  }

  private buildSynthesisSystemPrompt(): string {
    return `You are an expert document analysis and synthesis agent.

Your role is to synthesize information from multiple document chunks to provide accurate, well-formatted answers to user queries.

IMPORTANT: The context provided to you is extracted from document chunks that have been identified as relevant through a sophisticated multi-hop retrieval process. You must:
1. Read and understand the provided context
2. Synthesize a comprehensive answer based on the evidence
3. Cite specific chunks when referencing information
4. If information is incomplete, acknowledge this

Guidelines:
- Base your answer ONLY on the provided context
- Synthesize information from multiple chunks when appropriate
- Cite chunks using [Chunk X] notation
- If the context contains no relevant information, state this clearly
- Preserve exact technical terms, codes, and specifications
- Organize complex answers with clear structure`;
  }

  /**
   * Index a document for search.
   */
  async indexDocument(text: string, options?: {
    id?: string;
    fileName?: string;
    pageTexts?: string[];
  }): Promise<{
    documentId: string;
    chunkCount: number;
    totalTokens: number;
  }> {
    const { createDocument } = await import('../indexing/chunker.js');
    
    const document = createDocument(text, {
      id: options?.id,
      fileName: options?.fileName,
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
      pageTexts: options?.pageTexts,
    });

    await this.indexer.addChunks(document.chunks);

    return {
      documentId: document.id,
      chunkCount: document.chunks.length,
      totalTokens: document.metadata.totalTokens || 0,
    };
  }

  /**
   * Execute a query using the full multi-hop hybrid search pipeline.
   * @param request The query request
   * @param enableLogging Whether to enable session logging (default: true)
   */
  async query(request: QueryRequest, enableLogging: boolean = true): Promise<QueryResponse & { sessionLog?: SessionLog; logPath?: string }> {
    const startTime = Date.now();
    const { query, options = {} } = request;

    // Initialize session logger
    if (enableLogging) {
      this.logger = createSessionLogger(undefined, this.logDir);
      this.logger.logQuery(query, { ...options } as Record<string, unknown>);
      
      const stats = this.indexer.getStats();
      this.logger.logMetadata({
        totalChunks: stats.dense.totalVectors,
        embeddingModel: stats.dense.model,
        embeddingDimensions: stats.dense.dimensions,
      });
    }

    console.log(`[HybridSearchAgent] Processing query: "${query}"`);

    // Step 1: Spawn parallel subagents
    const subagentCount = options.subagentCount || this.config.subagentCount;
    console.log(`[HybridSearchAgent] Spawning ${subagentCount} parallel subagents...`);

    const subagentPromises = Array.from({ length: subagentCount }, (_, i) => {
      const subagent = createRetrievalSubagent(this.indexer, this.reranker, {
        ...this.config,
        maxHops: options.maxHops ?? this.config.maxHops,
      }, this.logger, i);
      return subagent.execute(query);
    });

    // Wait for all subagents to complete (embarrassingly parallel)
    const subagentResults = await Promise.all(subagentPromises);
    console.log(`[HybridSearchAgent] All ${subagentCount} subagents completed`);

    // Step 2: Master RRF Fusion
    const fusionStartTime = Date.now();
    const successfulResults = subagentResults.filter((r) => r.status === 'success');
    
    if (successfulResults.length === 0) {
      const emptyResponse = {
        answer: 'Unable to find relevant information for this query.',
        sources: [],
        confidence: 0,
        metadata: {
          totalChunks: this.indexer.getAllChunks().length,
          relevantChunks: 0,
          subagentCount,
          totalHops: 0,
          processingTimeMs: Date.now() - startTime,
          denseSearchTimeMs: 0,
          sparseSearchTimeMs: 0,
          rerankTimeMs: 0,
          fusionTimeMs: Date.now() - fusionStartTime,
        },
      };
      
      if (this.logger) {
        this.logger.logOutput(emptyResponse.answer, [], 0);
        const logPath = await this.logger.save();
        return { ...emptyResponse, sessionLog: this.logger.getSessionLog(), logPath };
      }
      
      return emptyResponse;
    }

    // Collect all curated chunks from subagents
    const allCuratedChunks = successfulResults.map((r) => r.curatedChunks);
    
    // Apply Master RRF Fusion
    const masterRankedChunks = masterRRFFusion(allCuratedChunks, {
      k: this.config.rrfK,
      topK: options.topK ?? this.config.topKCandidates,
    });

    const fusionTimeMs = Date.now() - fusionStartTime;
    console.log(`[HybridSearchAgent] Master RRF Fusion produced ${masterRankedChunks.length} chunks (${fusionTimeMs}ms)`);

    // Log master fusion
    if (this.logger) {
      this.logger.logMasterFusion({
        timestamp: new Date().toISOString(),
        inputLists: allCuratedChunks.length,
        totalChunks: allCuratedChunks.flat().length,
        outputChunks: masterRankedChunks.length,
        rrfK: this.config.rrfK,
        topK: options.topK ?? this.config.topKCandidates,
        chunkScores: masterRankedChunks.slice(0, 20).map(c => ({
          chunkId: c.chunkId,
          rrfScore: c.masterRrfScore,
          agreementCount: c.agreementCount,
          sourceAgents: c.sourceAgents,
        })),
        durationMs: fusionTimeMs,
      });
    }

    // Step 3: Main Agent Synthesis
    const synthesisResult = await this.synthesizeAnswer(query, masterRankedChunks, options);
    
    // Build response
    const sources: SourceReference[] = masterRankedChunks
      .slice(0, 10)
      .map((chunk, index) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.metadata.source || 'unknown',
        text: chunk.text.slice(0, 500),
        pageNumber: chunk.metadata.pageNumber as number | undefined,
        relevanceScore: chunk.masterRrfScore,
      }));

    // Calculate total hops
    const totalHops = successfulResults.reduce((sum, r) => sum + r.hopCount, 0);

    // Calculate confidence based on agreement and relevance
    const avgAgreement = masterRankedChunks.length > 0
      ? masterRankedChunks.reduce((sum, c) => sum + c.agreementCount, 0) / masterRankedChunks.length
      : 0;
    const confidence = Math.min(
      (avgAgreement / subagentCount) * 0.5 + 
      (successfulResults.length / subagentCount) * 0.5,
      1.0
    );

    const processingTimeMs = Date.now() - startTime;

    const response: QueryResponse = {
      answer: synthesisResult.answer,
      sources,
      confidence,
      metadata: {
        totalChunks: this.indexer.getAllChunks().length,
        relevantChunks: masterRankedChunks.length,
        subagentCount,
        totalHops,
        processingTimeMs,
        denseSearchTimeMs: 0, // Tracked internally
        sparseSearchTimeMs: 0, // Tracked internally
        rerankTimeMs: 0, // Tracked internally
        fusionTimeMs,
      },
    };

    // Log output and save session
    if (this.logger) {
      this.logger.logMetadata({
        relevantChunks: masterRankedChunks.length,
        subagentCount,
        totalHops,
        totalProcessingTimeMs: processingTimeMs,
      });
      
      this.logger.logOutput(
        synthesisResult.answer,
        sources.map(s => ({
          chunkId: s.chunkId,
          documentId: s.documentId,
          text: s.text,
          relevanceScore: s.relevanceScore,
        })),
        confidence
      );
      
      const logPath = await this.logger.save();
      console.log(`[HybridSearchAgent] Session log saved: ${logPath}`);
      
      return { ...response, sessionLog: this.logger.getSessionLog(), logPath };
    }

    return response;
  }

  /**
   * Synthesize the final answer from the master ranked chunks.
   */
  private async synthesizeAnswer(
    query: string,
    masterRankedChunks: Array<RerankedResult & { agreementCount: number; sourceAgents: string[] }>,
    options?: { extractionType?: 'summary' | 'entities' | 'full' | 'custom'; customPrompt?: string }
  ): Promise<{ answer: string }> {
    if (masterRankedChunks.length === 0) {
      return { answer: 'No relevant information found.' };
    }

    // Build context from master ranked chunks
    const contextSections = masterRankedChunks
      .slice(0, 15) // Use top 15 chunks
      .map((chunk, idx) => `[Chunk ${idx + 1}] (agreement: ${chunk.agreementCount})\n${chunk.text}`)
      .join('\n\n---\n\n');

    const extractionType = options?.extractionType || 'full';
    const formatInstructions = this.getFormatInstructions(extractionType);

    const synthesisPrompt = `Based on the following document chunks, synthesize an answer to the user's query.

User Query: ${query}

${formatInstructions}

Relevant Document Chunks (ranked by multi-source agreement):
${contextSections}

Synthesize your answer based on the evidence above. Cite chunks using [Chunk X] notation.`;

    // Log LLM interaction start
    const llmStartTime = Date.now();
    
    // Reset and prompt the synthesis agent
    this.synthesisAgent.reset();
    
    try {
      await this.synthesisAgent.prompt(synthesisPrompt);
      await this.synthesisAgent.waitForIdle();
    } catch (error) {
      console.error('[HybridSearchAgent] Synthesis error:', error);
      return { answer: `Error generating answer: ${error instanceof Error ? error.message : String(error)}` };
    }

    // Extract the answer
    const messages = this.synthesisAgent.state.messages;
    console.log(`[HybridSearchAgent] Synthesis messages: ${messages.length}`);
    
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      console.error('[HybridSearchAgent] No messages in response');
      return { answer: 'Failed to generate an answer - no response from model.' };
    }

    const answer = this.extractTextFromMessage(lastMessage);
    
    if (!answer || answer.trim().length === 0) {
      console.error('[HybridSearchAgent] Empty answer extracted');
      console.log('[HybridSearchAgent] Last message:', JSON.stringify(lastMessage, null, 2));
      return { answer: 'The model returned an empty response. The relevant chunks were found but no answer was generated.' };
    }
    
    // Log LLM interaction
    if (this.logger) {
      this.logger.startLLMInteraction();
      this.logger.logLLMInteraction({
        phase: 'synthesis',
        model: 'glm-latest',
        provider: 'grid',
        prompt: {
          system: this.buildSynthesisSystemPrompt(),
          user: synthesisPrompt,
          context: contextSections,
        },
        response: {
          content: answer,
          finishReason: 'stop',
        },
      });
    }
    
    return { answer };
  }

  private getFormatInstructions(extractionType: string): string {
    switch (extractionType) {
      case 'summary':
        return `FORMAT: Provide a concise summary (2-5 bullet points). Highlight key points only. Cite chunks.`;
      case 'entities':
        return `FORMAT: Extract key entities (names, codes, values) with context. Use structured format. Cite chunks.`;
      case 'full':
        return `FORMAT: Provide comprehensive explanation with complete details. Organize into clear sections. Cite chunks.`;
      default:
        return `FORMAT: Provide a clear, well-organized answer with appropriate detail. Cite chunks.`;
    }
  }

  private extractTextFromMessage(message: any): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }

  /**
   * Get index statistics.
   */
  getStats(): {
    totalChunks: number;
    dense: { totalVectors: number; dimensions: number; model: string };
    sparse: { totalDocuments: number; avgDocumentLength: number; vocabularySize: number };
  } {
    return this.indexer.getStats();
  }

  /**
   * Clear all indexed data.
   */
  clear(): void {
    this.indexer.clear();
  }
}

/**
 * Create a hybrid search agent.
 */
export function createHybridSearchAgent(
  indexer?: HybridIndexer,
  reranker?: Reranker,
  config?: Partial<HybridSearchConfig>
): HybridSearchAgent {
  return new HybridSearchAgent(indexer, reranker, config);
}