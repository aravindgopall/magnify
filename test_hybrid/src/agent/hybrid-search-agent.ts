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
import { extractTextFromMessage } from '../utils/index.js';

// Initialize model registry
const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

// Get model names from environment variables
const SYNTHESIS_MODEL = process.env.SYNTHESIS_MODEL || 'glm-latest';
const SYNTHESIS_PROVIDER = process.env.SYNTHESIS_PROVIDER || 'grid';
const FLASH_MODEL = process.env.FLASH_MODEL || 'glm-flash-experimental';
const FLASH_PROVIDER = process.env.FLASH_PROVIDER || 'grid';

/**
 * Get the synthesis model from models.json
 */
function getGridModel(): Model<'openai-completions'> {
  const model = modelRegistry.find(SYNTHESIS_PROVIDER as any, SYNTHESIS_MODEL);
  if (!model) {
    throw new Error(`${SYNTHESIS_PROVIDER} model "${SYNTHESIS_MODEL}" not found in ~/.pi/agent/models.json`);
  }
  return model as Model<'openai-completions'>;
}

/**
 * Get the fast flash model from models.json for decomposition.
 */
function getFlashModel(): Model<'openai-completions'> {
  const model = modelRegistry.find(FLASH_PROVIDER as any, FLASH_MODEL);
  if (!model) {
    console.warn(`[HybridSearchAgent] ${FLASH_PROVIDER} model "${FLASH_MODEL}" not found, falling back to synthesis model`);
    return getGridModel();
  }
  return model as Model<'openai-completions'>;
}

/**
 * Hybrid Search Agent - The main orchestrator for the multi-hop hybrid search system.
 * 
 * Architecture:
 * 1. Document Ingestion & Indexing (512-token chunks, dual dense/sparse indexing)
 * 2. LLM Query Decomposition (generates diverse subqueries)
 * 3. Parallel Subagent Spawning (4 subagents with different queries)
 * 4. Observe-Reason-Act Loop (per subagent, with RRF fusion and reranking)
 * 5. Master RRF Fusion (aggregates all subagent results)
 * 6. Main Agent Synthesis (generates final answer with section-grouped context)
 */
export class HybridSearchAgent {
  private indexer: HybridIndexer;
  private reranker: Reranker;
  private config: HybridSearchConfig;
  private synthesisAgent: Agent;
  private queryDecompositionAgent: Agent;
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
    this.reranker = reranker || createReranker();
    this.logDir = logDir || './logs/sessions';

    // Initialize synthesis agent with glm-latest (quality matters for final answer)
    const synthesisModel = getGridModel();
    this.synthesisAgent = new Agent({
      initialState: {
        model: synthesisModel,
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

    // Initialize query decomposition agent with glm-flash-experimental (fast decomposition)
    const flashModel = getFlashModel();
    this.queryDecompositionAgent = new Agent({
      initialState: {
        model: flashModel,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: this.buildQueryDecompositionSystemPrompt(),
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

  private buildQueryDecompositionSystemPrompt(): string {
    return `You are a query decomposition expert. Your task is to break down a user's query into diverse subqueries for parallel document retrieval.

Given a query, generate exactly 4 different search perspectives:

1. **Main query**: The original query (possibly simplified)
2. **Specific focus**: A more specific aspect or entity from the query
3. **Broad context**: A broader, related search that provides context
4. **Alternative angle**: A different perspective or related concept

Rules:
- Each subquery should search for different but relevant information
- Keep subqueries concise (under 10 words when possible)
- Preserve key technical terms and named entities
- Ensure diversity in search angles
- If the query is simple, create variations that explore related aspects

Respond with ONLY a JSON array of 4 strings, no other text.
Example: ["main query", "specific focus", "broad context", "alternative angle"]`;
  }

  /**
   * Decompose a query into diverse subqueries using LLM.
   */
  private async decomposeQuery(query: string, subagentCount: number): Promise<string[]> {
    console.log(`[HybridSearchAgent] Decomposing query into ${subagentCount} subqueries...`);
    
    this.queryDecompositionAgent.reset();
    
    const prompt = `Decompose this query into ${subagentCount} diverse search perspectives:

Query: "${query}"

Provide ${subagentCount} different subqueries that will help find comprehensive information. Respond with ONLY a JSON array.`;

    try {
      await this.queryDecompositionAgent.prompt(prompt);
      await this.queryDecompositionAgent.waitForIdle();
      
      const messages = this.queryDecompositionAgent.state.messages;
      const lastMessage = messages[messages.length - 1];
      const response = extractTextFromMessage(lastMessage);
      
      // Parse JSON array from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const subqueries = JSON.parse(jsonMatch[0]);
        if (Array.isArray(subqueries) && subqueries.length > 0) {
          console.log(`[HybridSearchAgent] Decomposed into: ${subqueries.join(', ')}`);
          return subqueries.slice(0, subagentCount);
        }
      }
      
      // Fallback to original query
      console.log('[HybridSearchAgent] Could not parse subqueries, using original query');
      return Array(subagentCount).fill(query);
    } catch (error) {
      console.error('[HybridSearchAgent] Query decomposition failed:', error);
      return Array(subagentCount).fill(query);
    }
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

    // Step 1: Decompose query into diverse subqueries using LLM
    // Each subagent gets a DIFFERENT subquery for intentional diversity
    const subagentCount = options.subagentCount || this.config.subagentCount;
    const subqueries = await this.decomposeQuery(query, subagentCount);
    console.log(`[HybridSearchAgent] Spawning ${subagentCount} parallel subagents with diverse subqueries...`);

    const subagentPromises = Array.from({ length: subagentCount }, (_, i) => {
      const subagent = createRetrievalSubagent(this.indexer, this.reranker, {
        ...this.config,
        maxHops: options.maxHops ?? this.config.maxHops,
      }, this.logger, i);
      // Each subagent gets a DIFFERENT subquery for diverse search coverage
      return subagent.execute(subqueries[i] || query);
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
    const rerankTimeMs = synthesisResult.rerankTimeMs;
    
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
        rerankTimeMs,
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
   * 
   * CRITICAL: Cross-encoder reranks against the ORIGINAL query before synthesis.
   * This prevents the "high agreement but wrong answer" problem where chunks
   * found by multiple subagents score highly by agreement but aren't relevant
   * to the actual query.
   * 
   * Pipeline: Master RRF (top 50) → Cross-encoder rerank (top 15-20) → Synthesis
   */
  private async synthesizeAnswer(
    query: string,
    masterRankedChunks: Array<RerankedResult & { agreementCount: number; sourceAgents: string[] }>,
    options?: { extractionType?: 'summary' | 'entities' | 'full' | 'custom'; customPrompt?: string }
  ): Promise<{ answer: string; rerankTimeMs: number }> {
    if (masterRankedChunks.length === 0) {
      return { answer: 'No relevant information found.', rerankTimeMs: 0 };
    }

    // Step 1: Take top 50 from master RRF
    const candidatesForRerank = masterRankedChunks.slice(0, 50);
    console.log(`[HybridSearchAgent] Cross-encoder reranking ${candidatesForRerank.length} chunks against original query...`);

    // Step 2: Cross-encoder rerank against ORIGINAL query
    const rerankStartTime = Date.now();
    const rerankedChunks = await this.reranker.rerank(query, candidatesForRerank, 20);
    const rerankTimeMs = Date.now() - rerankStartTime;
    console.log(`[HybridSearchAgent] Cross-encoder rerank completed (${rerankTimeMs}ms), top ${rerankedChunks.length} chunks selected`);

    // Merge rerank scores back with agreement data from original chunks
    const chunkAgreementMap = new Map(masterRankedChunks.map(c => [c.chunkId, { agreementCount: c.agreementCount, sourceAgents: c.sourceAgents }]));
    const rerankedWithAgreement: Array<RerankedResult & { agreementCount: number; sourceAgents: string[] }> = rerankedChunks.map(c => ({
      ...c,
      agreementCount: chunkAgreementMap.get(c.chunkId)?.agreementCount ?? 1,
      sourceAgents: chunkAgreementMap.get(c.chunkId)?.sourceAgents ?? [],
    }));

    // Step 3: Group chunks by section/heading for structured context
    const contextSections = this.buildStructuredContext(rerankedWithAgreement.slice(0, 20));

    const extractionType = options?.extractionType || 'full';
    const formatInstructions = this.getFormatInstructions(extractionType);

    const synthesisPrompt = `Based on the following document sections, synthesize an answer to the user's query.

User Query: ${query}

${formatInstructions}

Document Context (organized by section):
${contextSections}

Synthesize your answer based on the evidence above. Cite sources using the section names and chunk numbers (e.g., [Introduction, Chunk 1]).`;

    // Log LLM interaction start
    const llmStartTime = Date.now();
    
    // Reset and prompt the synthesis agent
    this.synthesisAgent.reset();
    
    try {
      await this.synthesisAgent.prompt(synthesisPrompt);
      await this.synthesisAgent.waitForIdle();
    } catch (error) {
      console.error('[HybridSearchAgent] Synthesis error:', error);
      return { answer: `Error generating answer: ${error instanceof Error ? error.message : String(error)}`, rerankTimeMs };
    }

    // Extract the answer
    const messages = this.synthesisAgent.state.messages;
    console.log(`[HybridSearchAgent] Synthesis messages: ${messages.length}`);
    
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      console.error('[HybridSearchAgent] No messages in response');
      return { answer: 'Failed to generate an answer - no response from model.', rerankTimeMs };
    }

    const answer = extractTextFromMessage(lastMessage);
    
    if (!answer || answer.trim().length === 0) {
      console.error('[HybridSearchAgent] Empty answer extracted');
      console.log('[HybridSearchAgent] Last message:', JSON.stringify(lastMessage, null, 2));
      return { answer: 'The model returned an empty response. The relevant chunks were found but no answer was generated.', rerankTimeMs };
    }
    
    // Log LLM interaction
    if (this.logger) {
      this.logger.startLLMInteraction();
      this.logger.logLLMInteraction({
        phase: 'synthesis',
        model: SYNTHESIS_MODEL,
        provider: SYNTHESIS_PROVIDER,
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
    
    return { answer, rerankTimeMs };
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

  /**
   * Build structured context by grouping chunks by section/heading.
   * This preserves document structure for better synthesis.
   */
  private buildStructuredContext(
    chunks: Array<RerankedResult & { agreementCount: number; sourceAgents: string[] }>
  ): string {
    // Group chunks by heading/section
    const sectionGroups = new Map<string, typeof chunks>();

    for (const chunk of chunks) {
      const heading = chunk.metadata.heading || 'General';
      const existing = sectionGroups.get(heading) || [];
      existing.push(chunk);
      sectionGroups.set(heading, existing);
    }

    // Build structured output
    const sections: string[] = [];
    let chunkIndex = 0;

    for (const [heading, sectionChunks] of sectionGroups) {
      const pageNumbers = new Set(
        sectionChunks
          .map(c => c.metadata.pageNumber)
          .filter((p): p is number => p !== undefined)
      );
      const pageStr = pageNumbers.size > 0 ? ` (Page ${Array.from(pageNumbers).join(', ')})` : '';

      const chunkTexts = sectionChunks
        .map((c) => {
          chunkIndex++;
          return `[Chunk ${chunkIndex}] (score: ${c.rerankScore.toFixed(3)}, agreement: ${c.agreementCount})\n${c.text}`;
        })
        .join('\n\n');

      sections.push(`## ${heading}${pageStr}\n\n${chunkTexts}`);
    }

    return sections.join('\n\n---\n\n');
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