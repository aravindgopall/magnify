import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import type { DocumentStore } from '../store/index.js';
import type { QueryAgentConfig, QueryAgentResult, SubAgentResult } from './types.js';
import { GroupContextAgent } from './sub-agent.js';
import { getPiMonoLogger } from './pi-mono-logger.js';

// Initialize model registry to load from ~/.pi/agent/models.json
const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

// Get the grid model from models.json
function getGridModel(): Model<'openai-completions'> {
  const model = modelRegistry.find('grid', 'glm-latest');
  if (!model) {
    throw new Error('Grid model "glm-latest" not found in ~/.pi/agent/models.json. Please configure it.');
  }
  return model as Model<'openai-completions'>;
}

/**
 * Main query agent that orchestrates sub-agents to answer questions about documents.
 * Uses pi-mono Agent for both sub-agents (context extraction) and final synthesis.
 */
export class PiMonoQueryAgent {
  private store: DocumentStore;
  private mainAgent: Agent;

  constructor(store: DocumentStore) {
    this.store = store;
    
    // Load grid model from ~/.pi/agent/models.json
    const model = getGridModel();
    
    this.mainAgent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: this.buildMainSystemPrompt(),
      },
      getApiKey: async () => {
        const apiKey = await authStorage.getApiKey('grid');
        if (!apiKey) {
          throw new Error('Grid API key not found. Please configure it in ~/.pi/agent/auth.json');
        }
        return apiKey;
      },
    });
  }

  private buildMainSystemPrompt(): string {
    return `You are an expert document analysis agent.

Your role is to synthesize information from multiple document sections to provide accurate, comprehensive answers to user queries.

Guidelines:
- Base your answer ONLY on the provided context from document sections
- If information is incomplete or uncertain, acknowledge this
- Cite specific sections when referencing information
- Organize your response logically with clear structure
- If the provided context contains no relevant information, state this clearly
- Be concise but thorough
- Preserve technical accuracy - don't paraphrase numbers or technical terms`;
  }

  /**
   * Execute a query against a document using parallel sub-agents.
   */
  async execute(config: QueryAgentConfig): Promise<QueryAgentResult> {
    const startTime = Date.now();
    const logger = getPiMonoLogger();
    
    // Start logging session
    const sessionId = logger.startSession(config.query, config.documentId);

    // Load document
    const storedDoc = this.store.get(config.documentId);
    if (!storedDoc) {
      throw new Error(`Document not found: ${config.documentId}`);
    }

    // Get all groups
    const groups = storedDoc.groups;
    if (groups.length === 0) {
      return {
        answer: 'No document content available to answer the query.',
        sources: [],
        confidence: 0,
        metadata: {
          totalGroups: 0,
          relevantGroups: 0,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }

    console.log(`[PiMonoAgent] Processing ${groups.length} groups for query: "${config.query}"`);

    // Spawn sub-agents for each group in parallel (default 7 at a time)
    const maxParallel = config.maxParallelSubAgents || 7;
    console.log(`[PiMonoAgent] Using ${maxParallel} parallel sub-agents`);
    
    const subAgentResults = await this.processGroupsInParallel(
      groups,
      config.query,
      maxParallel,
      config.extractionType,
      config.customPrompt
    );

    console.log(`[PiMonoAgent] ✓ All ${subAgentResults.length} sub-agents completed`);

    // Filter relevant contexts
    const relevantResults = subAgentResults.filter(r => r.hasRelevantContext);
    
    console.log(`[PiMonoAgent] Found ${relevantResults.length} relevant groups out of ${groups.length}`);

    // If no relevant context found, return early
    if (relevantResults.length === 0) {
      return {
        answer: 'I could not find any relevant information in the document to answer this query.',
        sources: [],
        confidence: 0,
        metadata: {
          totalGroups: groups.length,
          relevantGroups: 0,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }

    // Synthesize final answer using ALL relevant contexts
    console.log(`[PiMonoAgent] Starting synthesis with ${relevantResults.length} relevant contexts...`);
    const synthesisResult = await this.synthesizeAnswer(config.query, relevantResults);
    const answer = synthesisResult.answer;
    console.log(`[PiMonoAgent] ✓ Synthesis completed (${synthesisResult.durationMs}ms, answer length: ${answer.length})`);

    // Build sources
    const sources = relevantResults.map(r => {
      const group = groups.find(g => g.id === r.groupId)!;
      return {
        groupId: r.groupId,
        groupTitle: r.groupTitle,
        startPage: group.startPage,
        endPage: group.endPage,
        relevantExcerpt: r.relevantExcerpt,
      };
    });

    // Calculate confidence based on number of relevant sources
    const confidence = Math.min(
      0.5 + (relevantResults.length / groups.length) * 0.5,
      1.0
    );

    const totalDurationMs = Date.now() - startTime;

    const result: QueryAgentResult = {
      answer,
      sources,
      confidence,
      metadata: {
        totalGroups: groups.length,
        relevantGroups: relevantResults.length,
        processingTimeMs: totalDurationMs,
      },
    };
    
    // Save query answer and session logs
    await logger.saveQueryAnswer(
      config,
      result,
      totalDurationMs,
      synthesisResult.llmCallId,
      synthesisResult.durationMs
    );

    return result;
  }

  /**
   * Process groups in parallel with concurrency limit.
   * Ensures ALL sub-agents complete before returning.
   */
  private async processGroupsInParallel(
    groups: any[],
    query: string,
    maxParallel: number,
    extractionType?: 'summary' | 'entities' | 'full' | 'custom',
    customPrompt?: string
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    const totalBatches = Math.ceil(groups.length / maxParallel);
    
    console.log(`[SubAgents] Starting processing: ${groups.length} groups in ${totalBatches} batches of ${maxParallel}`);
    
    // Process in batches - each batch must complete before the next starts
    for (let i = 0; i < groups.length; i += maxParallel) {
      const batch = groups.slice(i, i + maxParallel);
      const batchNum = Math.floor(i / maxParallel) + 1;
      
      console.log(`[SubAgents] Batch ${batchNum}/${totalBatches}: Spawning ${batch.length} sub-agents (groups ${i+1}-${Math.min(i+maxParallel, groups.length)})`);
      
      // Create promises for each sub-agent in this batch
      const batchPromises = batch.map(async (group, idx) => {
        const subAgent = new GroupContextAgent(extractionType, customPrompt);
        const groupNum = i + idx + 1;
        try {
          const result = await subAgent.analyze(group, query);
          console.log(`[SubAgent ${groupNum}] Completed: ${group.title || `Pages ${group.startPage}-${group.endPage}`} - ${result.hasRelevantContext ? 'RELEVANT' : 'not relevant'}`);
          return result;
        } catch (error) {
          console.error(`[SubAgent ${groupNum}] Error processing group ${group.id}:`, error);
          return {
            groupId: group.id,
            groupTitle: group.title || `Pages ${group.startPage}-${group.endPage}`,
            hasRelevantContext: false,
          };
        }
      });

      // Wait for ALL sub-agents in this batch to complete
      const batchResults = await Promise.all(batchPromises);
      console.log(`[SubAgents] Batch ${batchNum}/${totalBatches}: ✓ All ${batchResults.length} sub-agents completed`);
      
      results.push(...batchResults);
    }

    console.log(`[SubAgents] ✓ All ${totalBatches} batches completed. Total results: ${results.length}`);
    return results;
  }

  /**
   * Synthesize final answer from relevant contexts using the main agent.
   */
  private async synthesizeAnswer(
    query: string,
    relevantResults: SubAgentResult[]
  ): Promise<{ answer: string; llmCallId?: string; durationMs: number }> {
    const startTime = Date.now();
    const logger = getPiMonoLogger();
    
    // Build context from all relevant results
    const contextSections = relevantResults
      .map((result, idx) => {
        return `[Section ${idx + 1}: ${result.groupTitle}]\n${result.context}\n`;
      })
      .join('\n---\n\n');

    const synthesisPrompt = `Based on the following document sections, provide a comprehensive answer to the user's query.

User Query: ${query}

Relevant Document Sections:
${contextSections}

Provide a clear, well-structured answer. If you reference specific information, mention which section(s) it came from.`;

    // Reset and prompt the main agent
    this.mainAgent.reset();
    await this.mainAgent.prompt(synthesisPrompt);
    await this.mainAgent.waitForIdle();
    
    const durationMs = Date.now() - startTime;

    // Extract the answer
    const messages = this.mainAgent.state.messages;
    const lastMessage = messages[messages.length - 1];
    
    // Log the LLM call with full agent state
    const llmCallId = await logger.logLLMCall(
      'main-agent',
      this.buildMainSystemPrompt(),
      synthesisPrompt,
      this.mainAgent.state,
      durationMs
    );
    
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return { answer: 'Failed to generate an answer. Please try again.', llmCallId, durationMs };
    }

    const rawAnswer = this.extractTextFromMessage(lastMessage);
    const answer = this.cleanAnswer(rawAnswer);
    return { answer, llmCallId, durationMs };
  }

  private extractTextFromMessage(message: any): string {
    if (typeof message.content === 'string') {
      return message.content;
    }
    
    if (Array.isArray(message.content)) {
      // Only extract text content, skip thinking blocks
      return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .filter(Boolean)
        .join('\n');
    }
    
    // If content is an object, try to extract text from known fields
    if (typeof message.content === 'object' && message.content !== null) {
      return message.content.text || '';
    }
    
    return '';
  }

  /**
   * Remove reasoning/thinking patterns from the final answer
   */
  private cleanAnswer(response: string): string {
    if (!response) return response;

    // Patterns that indicate internal reasoning/thinking
    const reasoningPatterns = [
      /^The user is asking.*?(?:\n|\.)/gm,
      /^Let me (?:analyze|synthesize|examine|review|look at).*?(?:\n|\.)/gm,
      /^Looking through.*?(?:\n|\.)/gm,
      /^I (?:should|need to|can|will).*?(?:\n|\.)/gm,
      /^Based on (?:my analysis|the context),?/gm,
      /^From (?:my understanding|what I can see),?/gm,
    ];

    let cleaned = response;
    for (const pattern of reasoningPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove leading empty lines
    return cleaned.replace(/^\s*\n+/, '').trim();
  }
}

/**
 * Factory function to create a PiMonoQueryAgent.
 */
export function createPiMonoQueryAgent(store: DocumentStore): PiMonoQueryAgent {
  return new PiMonoQueryAgent(store);
}
