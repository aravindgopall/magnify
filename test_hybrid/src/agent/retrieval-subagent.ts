import { v4 as uuidv4 } from 'uuid';
import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import type {
  SubagentState,
  SubagentMemory,
  SubagentResult,
  RerankedResult,
  AgentAction,
  AgentObservation,
  HybridSearchConfig,
} from '../types/index.js';
import { DEFAULT_HYBRID_SEARCH_CONFIG } from '../types/index.js';
import type { HybridIndexer } from '../indexing/hybrid-index.js';
import type { Reranker } from '../search/reranker.js';
import type { SessionLogger, SearchLogEntry } from '../logger/index.js';

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
 * Retrieval Subagent that implements the Observe-Reason-Act loop.
 * 
 * Each subagent:
 * 1. Decomposes the query into sub-queries
 * 2. Executes hybrid search (dense + sparse + RRF fusion)
 * 3. Reranks results
 * 4. Reads and evaluates chunks
 * 5. Decides whether to hop (search again) or terminate
 */
export class RetrievalSubagent {
  private id: string;
  private state: SubagentState;
  private indexer: HybridIndexer;
  private reranker: Reranker;
  private agent: Agent;
  private config: HybridSearchConfig;
  private logger: SessionLogger | null;
  private subagentIndex: number;

  constructor(
    indexer: HybridIndexer,
    reranker: Reranker,
    config: Partial<HybridSearchConfig> = {},
    logger?: SessionLogger | null,
    subagentIndex?: number
  ) {
    this.id = uuidv4();
    this.indexer = indexer;
    this.reranker = reranker;
    this.config = { ...DEFAULT_HYBRID_SEARCH_CONFIG, ...config };
    this.logger = logger || null;
    this.subagentIndex = subagentIndex ?? 0;

    // Initialize state (no pruning, no token budget)
    this.state = {
      id: this.id,
      status: 'idle',
      query: '',
      subQueries: [],
      retrievedChunks: [],
      curatedChunks: [],
      hopCount: 0,
      maxHops: this.config.maxHops,
      memory: {
        contextChunks: new Map(),
        relevantFindings: [],
      },
    };

    // Initialize pi-mono agent for reasoning
    const model = getGridModel();
    this.agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: this.buildSystemPrompt(),
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

  private buildSystemPrompt(): string {
    return `You are a retrieval subagent that helps find relevant information in documents.

Your role is to:
1. Analyze the user's query and identify key concepts
2. Evaluate retrieved document chunks for relevance
3. Determine if more information is needed (multi-hop)
4. Curate a list of the most relevant chunks

When evaluating chunks:
- Consider both semantic relevance and keyword matches
- Prioritize chunks that directly answer the query
- Consider whether you have enough information to answer the query

Response format:
- First, briefly analyze what information you have and what's missing
- Then provide your decision: CONTINUE (need more info) or TERMINATE (have enough info)
- If CONTINUE, suggest a follow-up search query`;
  }

  /**
   * Execute the subagent's observe-reason-act loop.
   */
  async execute(query: string): Promise<SubagentResult> {
    const startTime = Date.now();
    this.state.query = query;
    this.state.status = 'searching';

    try {
      // Step 1: Decompose query
      this.state.subQueries = await this.decomposeQuery(query);
      console.log(`[Subagent ${this.id}] Decomposed into: ${this.state.subQueries.join(', ')}`);

      // Step 2: Execute hybrid search
      await this.executeSearch();

      // Step 3: Observe-Reason-Act loop
      let shouldContinue = true;
      while (shouldContinue && this.state.hopCount < this.state.maxHops) {
        this.state.status = 'evaluating';
        
        // Observe current state
        const observation = await this.observe();
        
        // Reason and decide action
        const action = await this.reason(observation);
        
        // Execute action
        shouldContinue = await this.act(action);
        
        if (shouldContinue) {
          this.state.hopCount++;
          this.state.status = 'searching';
          console.log(`[Subagent ${this.id}] Hopping (${this.state.hopCount}/${this.state.maxHops})`);
        }
      }

      this.state.status = 'completed';
      
      // Finalize curated chunks (all retrieved chunks, no pruning)
      this.state.curatedChunks = this.state.retrievedChunks;
      
      return {
        agentId: this.id,
        status: 'success',
        curatedChunks: this.state.curatedChunks,
        relevantFindings: this.state.memory.relevantFindings,
        hopCount: this.state.hopCount,
        tokensUsed: 0, // No token tracking
        duration: Date.now() - startTime,
      };
    } catch (error) {
      this.state.status = 'failed';
      this.state.error = error instanceof Error ? error.message : String(error);
      
      return {
        agentId: this.id,
        status: 'failed',
        curatedChunks: this.state.retrievedChunks, // Return whatever we have
        relevantFindings: [],
        hopCount: this.state.hopCount,
        tokensUsed: 0,
        duration: Date.now() - startTime,
        error: this.state.error,
      };
    }
  }

  /**
   * Decompose a complex query into simpler sub-queries.
   */
  private async decomposeQuery(query: string): Promise<string[]> {
    // Simple decomposition: split by question words and conjunctions
    const subQueries: string[] = [query];

    // Check for compound questions
    const conjunctions = [' and ', ' or ', ' also ', ' as well as '];
    for (const conj of conjunctions) {
      if (query.toLowerCase().includes(conj)) {
        const parts = query.split(new RegExp(conj, 'i'));
        if (parts.length > 1) {
          subQueries.push(...parts.map((p) => p.trim()).filter((p) => p.length > 0));
        }
      }
    }

    // Check for question words that might indicate multiple questions
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which'];
    for (const word of questionWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = query.match(regex);
      if (matches && matches.length > 1) {
        // Multiple question words - decomposition is valid
        break;
      }
    }

    // Deduplicate
    return [...new Set(subQueries)];
  }

  /**
   * Execute hybrid search and reranking.
   */
  private async executeSearch(): Promise<void> {
    // Search with original query and sub-queries
    const allQueries = [this.state.query, ...this.state.subQueries];
    const fusedResults = await this.indexer.searchMultiQuery(
      allQueries,
      this.config.topKCandidates
    );

    // Rerank results
    this.state.retrievedChunks = await this.reranker.rerank(
      this.state.query,
      fusedResults,
      this.config.rerankTopK
    );

    console.log(`[Subagent ${this.id}] Retrieved ${this.state.retrievedChunks.length} chunks`);
  }

  /**
   * Observe the current state and gather information.
   */
  private async observe(): Promise<AgentObservation> {
    const observation: AgentObservation = {
      currentKnowledge: '',
      missingInformation: [],
      chunkQuality: new Map(),
      shouldHop: false,
      shouldTerminate: false,
    };

    // Read top chunks into memory (no budget limit)
    this.readChunksIntoMemory();

    // Assess what we know and what's missing
    observation.currentKnowledge = this.assessCurrentKnowledge();
    
    // Evaluate chunk quality (for information only, no pruning)
    const isBM25Only = this.state.retrievedChunks.some(c => c.rerankScore < 0.1);
    const relevantThreshold = isBM25Only ? 0.3 : 0.7;
    const partialThreshold = isBM25Only ? 0.1 : 0.4;
    
    for (const chunk of this.state.retrievedChunks) {
      if (chunk.rerankScore > relevantThreshold) {
        observation.chunkQuality.set(chunk.chunkId, 'relevant');
      } else if (chunk.rerankScore > partialThreshold) {
        observation.chunkQuality.set(chunk.chunkId, 'partial');
      } else {
        observation.chunkQuality.set(chunk.chunkId, isBM25Only ? 'partial' : 'irrelevant');
      }
    }

    // Determine if we need to hop
    const relevantCount = Array.from(observation.chunkQuality.values())
      .filter((q) => isBM25Only ? (q === 'relevant' || q === 'partial') : q === 'relevant').length;
    
    observation.shouldHop = relevantCount < 3 && this.state.hopCount < this.state.maxHops;
    observation.shouldTerminate = relevantCount >= 3 || this.state.hopCount >= this.state.maxHops;

    return observation;
  }

  /**
   * Read chunks into memory (context window) - no token budget.
   */
  private readChunksIntoMemory(): void {
    for (const chunk of this.state.retrievedChunks) {
      this.state.memory.contextChunks.set(chunk.chunkId, chunk.text);
    }
  }

  /**
   * Assess what information we currently have.
   */
  private assessCurrentKnowledge(): string {
    const relevantChunks = this.state.retrievedChunks
      .filter((c) => c.rerankScore > 0.5)
      .slice(0, 5);

    if (relevantChunks.length === 0) {
      return 'No highly relevant information found yet.';
    }

    return relevantChunks
      .map((c, i) => `[${i + 1}] ${c.text.slice(0, 200)}...`)
      .join('\n');
  }

  /**
   * Reason about the observation and decide on an action.
   */
  private async reason(observation: AgentObservation): Promise<AgentAction> {
    // Simple heuristic-based reasoning
    // In production, this would use the LLM agent for more sophisticated reasoning

    // Check if we should terminate
    if (observation.shouldTerminate) {
      return {
        type: 'terminate',
        reason: 'Found sufficient relevant information or reached max hops',
      };
    }

    // Check if we should hop
    if (observation.shouldHop) {
      // Generate a follow-up query based on missing information
      const newQuery = this.generateFollowUpQuery(observation);
      return {
        type: 'hop',
        newQuery,
      };
    }

    return {
      type: 'terminate',
      reason: 'Completed evaluation',
    };
  }

  /**
   * Generate a follow-up query for multi-hop retrieval.
   */
  private generateFollowUpQuery(observation: AgentObservation): string {
    // Extract key terms from the original query that weren't well-matched
    const queryTerms = this.state.query.toLowerCase().split(/\s+/);
    
    // Find terms that didn't match well
    const matchedTerms = new Set<string>();
    for (const chunk of this.state.retrievedChunks) {
      const chunkLower = chunk.text.toLowerCase();
      for (const term of queryTerms) {
        if (chunkLower.includes(term)) {
          matchedTerms.add(term);
        }
      }
    }

    const unmatchedTerms = queryTerms.filter((t) => !matchedTerms.has(t) && t.length > 3);
    
    if (unmatchedTerms.length > 0) {
      return `${unmatchedTerms.join(' ')} ${this.state.query}`;
    }

    // If all terms matched but still not relevant, try a broader query
    return `${this.state.query} details explanation`;
  }

  /**
   * Execute the decided action.
   * Returns true if the loop should continue, false if it should terminate.
   */
  private async act(action: AgentAction): Promise<boolean> {
    switch (action.type) {
      case 'search':
        await this.executeSearch();
        return true;

      case 'hop':
        console.log(`[Subagent ${this.id}] New query: ${action.newQuery}`);
        this.state.subQueries.push(action.newQuery);
        await this.executeSearch();
        return true;

      case 'terminate':
        // Finalize curated chunks (all retrieved, no pruning)
        this.state.curatedChunks = this.state.retrievedChunks;
        
        // Extract relevant findings
        this.state.memory.relevantFindings = this.state.curatedChunks
          .slice(0, 3)
          .map((c) => c.text.slice(0, 300));
        
        console.log(`[Subagent ${this.id}] Terminating: ${action.reason}`);
        return false;

      default:
        return false;
    }
  }

  /**
   * Get current state.
   */
  getState(): SubagentState {
    return { ...this.state };
  }
}

/**
 * Create a retrieval subagent.
 */
export function createRetrievalSubagent(
  indexer: HybridIndexer,
  reranker: Reranker,
  config?: Partial<HybridSearchConfig>,
  logger?: SessionLogger | null,
  subagentIndex?: number
): RetrievalSubagent {
  return new RetrievalSubagent(indexer, reranker, config, logger, subagentIndex);
}