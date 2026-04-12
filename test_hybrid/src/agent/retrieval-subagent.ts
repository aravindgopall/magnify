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
import type { SessionLogger } from '../logger/index.js';
import { extractTextFromMessage } from '../utils/index.js';

// Initialize model registry
const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

// Get model names from environment variables
const SUBAGENT_MODEL = process.env.SUBAGENT_MODEL || 'glm-latest';
const SUBAGENT_PROVIDER = process.env.SUBAGENT_PROVIDER || 'grid';

/**
 * Get the subagent model from models.json
 */
function getGridModel(): Model<'openai-completions'> {
  const model = modelRegistry.find(SUBAGENT_PROVIDER as any, SUBAGENT_MODEL);
  if (!model) {
    throw new Error(`${SUBAGENT_PROVIDER} model "${SUBAGENT_MODEL}" not found in ~/.pi/agent/models.json`);
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
1. Break down the query into its key concepts
2. Plan several distinct, non-overlapping search strategies that approach the question from different angles
3. Execute searches and evaluate retrieved chunks
4. Determine if more information is needed (multi-hop)
5. Curate a list of the most relevant chunks

IMPORTANT: Your search strategies should be diverse and explore different facets of the query.
- Focus on different aspects, entities, or relationships in the query
- Use different search terms and approaches
- Avoid redundant searches that would find the same documents

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
   * Decompose a complex query into simpler sub-queries using LLM.
   * Falls back to rule-based decomposition if LLM is unavailable.
   * 
   * Note: The main query decomposition happens in HybridSearchAgent.decomposeQuery()
   * which creates diverse subqueries for each subagent. This method provides
   * additional per-subagent decomposition for complex queries.
   */
  private async decomposeQuery(query: string): Promise<string[]> {
    // Try LLM-based decomposition first
    try {
      this.agent.reset();
      const prompt = `Break down this search query into 2-3 simpler sub-queries for document retrieval.
Each sub-query should focus on a different aspect of the original query.
If the query is simple, just return the original query.

Query: "${query}"

Respond with ONLY a JSON array of strings, no other text.
Example: ["aspect one", "aspect two", "aspect three"]`;

      await this.agent.prompt(prompt);
      await this.agent.waitForIdle();

      const messages = this.agent.state.messages;
      const lastMessage = messages[messages.length - 1];
      const response = extractTextFromMessage(lastMessage);

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const subqueries = JSON.parse(jsonMatch[0]);
        if (Array.isArray(subqueries) && subqueries.length > 0) {
          // Always include original query as the primary
          const result = [query, ...subqueries.filter((sq: string) => sq !== query)];
          console.log(`[Subagent ${this.id}] LLM decomposed: ${result.join(', ')}`);
          return [...new Set(result)];
        }
      }
    } catch (error) {
      console.warn(`[Subagent ${this.id}] LLM decomposition failed, using rule-based fallback:`, error);
    }

    // Fallback: rule-based decomposition
    return this.decomposeQueryRuleBased(query);
  }

  /**
   * Rule-based query decomposition (fallback when LLM is unavailable).
   * Splits by conjunctions and detects compound questions.
   */
  private decomposeQueryRuleBased(query: string): string[] {
    const subQueries: string[] = [query];

    // Split by conjunctions
    const conjunctions = [' and ', ' or ', ' also ', ' as well as '];
    for (const conj of conjunctions) {
      if (query.toLowerCase().includes(conj)) {
        const parts = query.split(new RegExp(conj, 'i'));
        if (parts.length > 1) {
          subQueries.push(...parts.map((p) => p.trim()).filter((p) => p.length > 0));
        }
      }
    }

    return [...new Set(subQueries)];
  }

  /**
   * Execute hybrid search and reranking.
   * Merges new results with existing chunks from previous hops, keeping the best score per chunk.
   */
  private async executeSearch(): Promise<void> {
    // Search with original query and sub-queries
    const allQueries = [this.state.query, ...this.state.subQueries];
    const fusedResults = await this.indexer.searchMultiQuery(
      allQueries,
      this.config.topKCandidates
    );

    // Rerank results
    const newChunks = await this.reranker.rerank(
      this.state.query,
      fusedResults,
      this.config.rerankTopK
    );

    // Merge with existing chunks: keep best score per chunkId
    const existingMap = new Map<string, RerankedResult>(
      this.state.retrievedChunks.map(c => [c.chunkId, c])
    );

    for (const chunk of newChunks) {
      const existing = existingMap.get(chunk.chunkId);
      if (!existing || chunk.rerankScore > existing.rerankScore) {
        existingMap.set(chunk.chunkId, chunk);
      }
    }

    // Re-sort by rerank score and store
    this.state.retrievedChunks = Array.from(existingMap.values())
      .sort((a, b) => b.rerankScore - a.rerankScore);

    console.log(`[Subagent ${this.id}] Retrieved ${newChunks.length} new chunks, total ${this.state.retrievedChunks.length} accumulated`);
  }

  /**
   * Observe the current state and gather information.
   * Prepares context for LLM reasoning - does NOT make decisions.
   * Decision-making is handled by reason() via LLM.
   * Threshold-based heuristics are only used as fallback if LLM fails.
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

    // Note: Chunk quality classification and hop/terminate decisions
    // are made by the LLM in reason(). Threshold-based heuristics
    // below are ONLY used as fallback when LLM is unavailable.
    this.computeHeuristicFallback(observation);

    return observation;
  }

  /**
   * Compute threshold-based heuristic decisions.
   * Used ONLY as fallback when LLM reasoning is unavailable.
   */
  private computeHeuristicFallback(observation: AgentObservation): void {
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

    const relevantCount = Array.from(observation.chunkQuality.values())
      .filter((q) => isBM25Only ? (q === 'relevant' || q === 'partial') : q === 'relevant').length;
    
    observation.shouldHop = relevantCount < 3 && this.state.hopCount < this.state.maxHops;
    observation.shouldTerminate = relevantCount >= 3 || this.state.hopCount >= this.state.maxHops;
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
   * Reason about the observation and decide on an action using LLM.
   */
  private async reason(observation: AgentObservation): Promise<AgentAction> {
    // Build context for LLM decision
    const topChunks = this.state.retrievedChunks
      .slice(0, 10)
      .map((c, i) => `[${i + 1}] Score: ${c.rerankScore.toFixed(3)}\n${c.text.slice(0, 300)}...`)
      .join('\n\n');

    const prompt = `Analyze the retrieved chunks and decide whether to CONTINUE searching or TERMINATE.

ORIGINAL QUERY: "${this.state.query}"

HOP COUNT: ${this.state.hopCount}/${this.state.maxHops}

RETRIEVED CHUNKS (${this.state.retrievedChunks.length} total):
${topChunks}

TASK:
1. Evaluate if the chunks fully answer the query
2. Identify what information is still missing (if any)
3. Decide: TERMINATE if query is answered, CONTINUE if critical info is missing

Respond in this EXACT format:
DECISION: TERMINATE or CONTINUE
REASON: <brief explanation>
MISSING: <what's missing, if CONTINUE>
FOLLOWUP_QUERY: <suggested search query, if CONTINUE>

Examples:
- Simple "What is X?" answered by 1 chunk → TERMINATE
- Complex comparison needing more details → CONTINUE with targeted followup
- Already searched 3 times → TERMINATE (max hops reached)`;

    try {
      this.agent.reset();
      await this.agent.prompt(prompt);
      await this.agent.waitForIdle();

      const messages = this.agent.state.messages;
      const lastMessage = messages[messages.length - 1];
      const response = extractTextFromMessage(lastMessage);

      console.log(`[Subagent ${this.id}] LLM decision: ${response.slice(0, 200)}...`);

      // Parse the response
      const decisionMatch = response.match(/DECISION:\s*(TERMINATE|CONTINUE)/i);
      const reasonMatch = response.match(/REASON:\s*(.+?)(?=\nMISSING:|FOLLOWUP_QUERY:|$)/is);
      const followupMatch = response.match(/FOLLOWUP_QUERY:\s*(.+?)(?=\n|$)/is);

      const decision = decisionMatch ? decisionMatch[1].toUpperCase() : 'TERMINATE';
      const reason = reasonMatch ? reasonMatch[1].trim() : 'LLM evaluation completed';

      if (decision === 'TERMINATE') {
        return {
          type: 'terminate',
          reason,
        };
      }

      // CONTINUE - generate follow-up query
      const followupQuery = followupMatch
        ? followupMatch[1].trim()
        : this.generateFollowUpQuery(observation);

      return {
        type: 'hop',
        newQuery: followupQuery,
      };
    } catch (error) {
      console.error(`[Subagent ${this.id}] LLM reasoning failed, using heuristic:`, error);
      
      // Fallback to heuristic
      if (observation.shouldTerminate) {
        return {
          type: 'terminate',
          reason: 'Found sufficient relevant information or reached max hops',
        };
      }

      if (observation.shouldHop) {
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