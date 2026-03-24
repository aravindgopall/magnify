import { v4 as uuidv4 } from 'uuid';
import type { LLMClient, LLMMessage } from '../llm/client.js';
import type { DocumentStore, StoredDocument } from '../store/index.js';
import type { DocumentGroup } from '../types/index.js';
import { QueryLogPersistence, createQueryLogPersistence, type QueryLog, type LLMCallLog, type LLMMessageLog } from '../store/query-log.js';

export interface QueryRequest {
  documentId: string;
  query: string;
  groupIds?: string[];
  extractionType?: 'summary' | 'entities' | 'full' | 'custom';
  customPrompt?: string;
}

export interface QueryResponse {
  queryId: string;
  documentId: string;
  result: QueryResult;
  groupsProcessed: string[];
  duration: number;
  tokensUsed: number;
}

export interface QueryResult {
  answer: string;
  sources: SourceReference[];
  entities?: ExtractedEntity[];
  confidence: number;
}

export interface SourceReference {
  groupId: string;
  groupTitle?: string;
  startPage: number;
  endPage: number;
  relevantExcerpt?: string;
}

export interface ExtractedEntity {
  type: string;
  name: string;
  value?: string;
  confidence: number;
}

/**
 * Internal structure for subagent result with timing
 */
interface SubagentResultWithTiming {
  groupId: string;
  groupTitle?: string;
  startPage: number;
  endPage: number;
  answer: string;
  entities: ExtractedEntity[];
  excerpt: string;
  tokensUsed: number;
  durationMs: number;
  llmCall?: LLMCallLog;
}

export class QueryOrchestrator {
  private llmClient: LLMClient;
  private documentStore: DocumentStore;
  private maxConcurrentRequests = 3; // Limit to avoid rate limiting
  private queryLogPersistence: QueryLogPersistence;

  constructor(llmClient: LLMClient, documentStore: DocumentStore) {
    this.llmClient = llmClient;
    this.documentStore = documentStore;
    this.queryLogPersistence = createQueryLogPersistence();
  }

  /**
   * Process items in batches to avoid rate limiting
   */
  private async processInBatches<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += this.maxConcurrentRequests) {
      const batch = items.slice(i, i + this.maxConcurrentRequests);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * Log LLM call before making it
   */
  private logLLMCall(
    agentType: 'router' | 'extraction' | 'synthesis',
    messages: LLMMessage[],
    groupId?: string
  ): { log: LLMCallLog; startTime: number } {
    const startTime = Date.now();
    const log: LLMCallLog = {
      agentType,
      groupId,
      messages: messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content
      })),
      timestamp: new Date().toISOString(),
    };
    
    console.log(`\n========== LLM CALL START [${agentType}${groupId ? ` | Group: ${groupId}` : ''}] ==========`);
    console.log(`Timestamp: ${log.timestamp}`);
    console.log('Messages:');
    messages.forEach((m, i) => {
      console.log(`  [${i}] ${m.role.toUpperCase()}: ${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}`);
    });
    console.log('============================================================\n');
    
    return { log, startTime };
  }

  /**
   * Complete LLM call log after response
   */
  private completeLLMCall(log: LLMCallLog, startTime: number, response?: unknown, error?: string): LLMCallLog {
    log.durationMs = Date.now() - startTime;
    log.response = response;
    log.error = error;
    
    console.log(`\n========== LLM CALL END [${log.agentType}${log.groupId ? ` | Group: ${log.groupId}` : ''}] ==========`);
    console.log(`Duration: ${log.durationMs}ms`);
    if (error) {
      console.log(`Error: ${error}`);
    } else {
      console.log(`Response: ${JSON.stringify(response).substring(0, 500)}...`);
    }
    console.log('============================================================\n');
    
    return log;
  }

  async execute(request: QueryRequest): Promise<QueryResponse> {
    const startTime = Date.now();
    const queryId = uuidv4();
    const llmCalls: LLMCallLog[] = [];

    const stored = this.documentStore.get(request.documentId);
    if (!stored) {
      throw new Error(`Document ${request.documentId} not found`);
    }

    // Build document context
    const documentContext = {
      title: stored.document.metadata.title,
      documentType: stored.metadata.documentType,
      totalGroups: stored.groups.length,
      totalPageCount: stored.document.pages.length,
    };

    // Track routing timing
    const routingStartTime = Date.now();
    const routingResult = await this.identifyRelevantGroups(
      stored,
      request.query,
      request.groupIds,
      llmCalls
    );
    const routingDurationMs = Date.now() - routingStartTime;

    // Track subagent timing
    const subagentStartTime = Date.now();
    const subagentResults = await this.processInBatches(
      routingResult.selectedGroups,
      group => this.executeSubagent(group, request.query, request.extractionType, request.customPrompt, llmCalls)
    );
    const subagentDurationMs = Date.now() - subagentStartTime;

    // Track merge timing
    const mergeStartTime = Date.now();
    const mergeResult = await this.mergeResults(request.query, subagentResults, stored, llmCalls);
    const mergeDurationMs = Date.now() - mergeStartTime;

    const totalTokens = subagentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
    const totalDurationMs = Date.now() - startTime;

    // Build and save query log
    const queryLog: QueryLog = {
      queryId,
      documentId: request.documentId,
      timestamp: new Date(),
      query: request.query,
      extractionType: request.extractionType,
      customPrompt: request.customPrompt,
      documentContext,
      routing: {
        requestedGroupIds: request.groupIds,
        selectedGroupIds: routingResult.selectedGroups.map((g: DocumentGroup) => g.id),
        selectedGroups: routingResult.selectedGroups.map((g: DocumentGroup) => ({
          id: g.id,
          title: g.title,
          startPage: g.startPage,
          endPage: g.endPage,
        })),
        reasoning: routingResult.reasoning,
        durationMs: routingDurationMs,
        llmCall: routingResult.llmCall,
      },
      subagentResults: subagentResults.map(r => ({
        groupId: r.groupId,
        groupTitle: r.groupTitle,
        startPage: r.startPage,
        endPage: r.endPage,
        answer: r.answer,
        entities: r.entities,
        relevantExcerpt: r.excerpt,
        tokensUsed: r.tokensUsed,
        durationMs: r.durationMs,
        llmCall: r.llmCall,
      })),
      mergeResult: {
        type: subagentResults.length === 0 ? 'none' : subagentResults.length === 1 ? 'single' : 'synthesis',
        reasoning: subagentResults.length > 1 ? 'Multiple sections synthesized into comprehensive answer' : undefined,
        durationMs: mergeDurationMs,
        llmCall: mergeResult.llmCall,
      },
      finalResult: {
        answer: mergeResult.result.answer,
        sources: mergeResult.result.sources,
        entities: mergeResult.result.entities || [],
        confidence: mergeResult.result.confidence,
      },
      performance: {
        totalDurationMs,
        routingDurationMs,
        subagentDurationMs,
        mergeDurationMs,
        totalTokensUsed: totalTokens,
      },
      llmCalls,
    };

    // Save log asynchronously (don't wait for it)
    this.queryLogPersistence.saveLog(queryLog).catch(err => {
      console.error(`Failed to save query log ${queryId}:`, err);
    });

    return {
      queryId,
      documentId: request.documentId,
      result: mergeResult.result,
      groupsProcessed: routingResult.selectedGroups.map((g: DocumentGroup) => g.id),
      duration: totalDurationMs,
      tokensUsed: totalTokens,
    };
  }

  private async identifyRelevantGroups(
    stored: StoredDocument,
    query: string,
    specificGroupIds?: string[],
    llmCalls?: LLMCallLog[]
  ): Promise<{ selectedGroups: DocumentGroup[]; reasoning: string; llmCall?: LLMCallLog }> {
    if (specificGroupIds && specificGroupIds.length > 0) {
      const selectedGroups = stored.groups.filter(g => specificGroupIds.includes(g.id));
      return {
        selectedGroups,
        reasoning: `User explicitly requested groups: ${specificGroupIds.join(', ')}`,
      };
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a document routing agent. Given a query and a list of document sections, identify which sections are most relevant to answer the query.

Respond with a JSON object containing:
{
  "relevantGroupIds": ["id1", "id2", ...],
  "reasoning": "Brief explanation of why these sections were selected"
}

Select only sections that contain information relevant to the query. If unsure, include the section.`,
      },
      {
        role: 'user',
        content: `Document: ${stored.document.metadata.title || 'Untitled'}
Document Type: ${stored.metadata.documentType || 'Unknown'}

Available Sections:
${stored.groups.map(g => `- ID: ${g.id}
  Title: ${g.title || `Pages ${g.startPage}-${g.endPage}`}
  Pages: ${g.startPage}-${g.endPage}`).join('\n')}

Query: ${query}

Which sections are relevant to this query?`,
      },
    ];

    // Log before LLM call
    const { log, startTime } = this.logLLMCall('router', messages);

    try {
      const response = await this.llmClient.completeWithJSON<{
        relevantGroupIds: string[];
        reasoning: string;
      }>(messages);

      // Complete the log
      this.completeLLMCall(log, startTime, response);
      llmCalls?.push(log);

      const relevantIds = new Set(response.relevantGroupIds);
      const selectedGroups = stored.groups.filter(g => relevantIds.has(g.id));
      
      return {
        selectedGroups,
        reasoning: response.reasoning,
        llmCall: log,
      };
    } catch (error) {
      this.completeLLMCall(log, startTime, undefined, error instanceof Error ? error.message : String(error));
      llmCalls?.push(log);
      throw error;
    }
  }

  private async executeSubagent(
    group: DocumentGroup,
    query: string,
    extractionType?: 'summary' | 'entities' | 'full' | 'custom',
    customPrompt?: string,
    llmCalls?: LLMCallLog[]
  ): Promise<SubagentResultWithTiming> {
    const startTime = Date.now();
    const content = group.pages.map(p => p.text).join('\n\n');

    const systemPrompt = this.getSystemPrompt(extractionType, customPrompt);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Section: ${group.title || `Pages ${group.startPage}-${group.endPage}`}
Pages: ${group.startPage} to ${group.endPage}

Content:
${content.substring(0, 8000)}${content.length > 8000 ? '...' : ''}

Query: ${query}`,
      },
    ];

    // Log before LLM call
    const { log, startTime: llmStartTime } = this.logLLMCall('extraction', messages, group.id);

    try {
      const response = await this.llmClient.completeWithJSON<{
        answer: string;
        entities: Array<{ type: string; name: string; value?: string; confidence: number }>;
        relevantExcerpt: string;
      }>(messages);

      const durationMs = Date.now() - startTime;

      // Complete the log
      this.completeLLMCall(log, llmStartTime, response);
      llmCalls?.push(log);

      return {
        groupId: group.id,
        groupTitle: group.title,
        startPage: group.startPage,
        endPage: group.endPage,
        answer: response.answer,
        entities: response.entities || [],
        excerpt: response.relevantExcerpt || '',
        tokensUsed: 0, // TODO: Get actual token count from LLM response
        durationMs,
        llmCall: log,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.completeLLMCall(log, llmStartTime, undefined, error instanceof Error ? error.message : String(error));
      llmCalls?.push(log);
      
      return {
        groupId: group.id,
        groupTitle: group.title,
        startPage: group.startPage,
        endPage: group.endPage,
        answer: `Error processing section: ${error instanceof Error ? error.message : String(error)}`,
        entities: [],
        excerpt: '',
        tokensUsed: 0,
        durationMs,
        llmCall: log,
      };
    }
  }

  private getSystemPrompt(
    extractionType?: 'summary' | 'entities' | 'full' | 'custom',
    customPrompt?: string
  ): string {
    if (customPrompt) {
      return customPrompt;
    }

    switch (extractionType) {
      case 'summary':
        return `You are a document analysis agent. Provide a concise summary relevant to the query.
Respond with JSON: { "answer": "summary text", "entities": [], "relevantExcerpt": "key quote" }`;

      case 'entities':
        return `You are an entity extraction agent. Extract all relevant entities mentioned in the context of the query.
Respond with JSON: { "answer": "brief context", "entities": [{"type": "person|org|date|money|etc", "name": "value", "confidence": 0.0-1.0}], "relevantExcerpt": "quote" }`;

      case 'full':
        return `You are a comprehensive document analysis agent. Provide detailed answers with all relevant information.
Respond with JSON: { "answer": "detailed answer", "entities": [...], "relevantExcerpt": "key quote" }`;

      default:
        return `You are a document query agent. Answer the query based on the provided document section.
Be accurate and only use information from the provided content.
Respond with JSON: { "answer": "your answer", "entities": [{"type": "type", "name": "value", "confidence": 0.0-1.0}], "relevantExcerpt": "relevant quote from content" }`;
    }
  }

  private async mergeResults(
    query: string,
    subagentResults: SubagentResultWithTiming[],
    stored: StoredDocument,
    llmCalls?: LLMCallLog[]
  ): Promise<{ result: QueryResult; llmCall?: LLMCallLog }> {
    if (subagentResults.length === 0) {
      return {
        result: {
          answer: 'No relevant information found in the document.',
          sources: [],
          confidence: 0,
        },
      };
    }

    if (subagentResults.length === 1) {
      const result = subagentResults[0];
      const group = stored.groups.find(g => g.id === result.groupId);
      return {
        result: {
          answer: result.answer,
          sources: [{
            groupId: result.groupId,
            groupTitle: group?.title,
            startPage: group?.startPage || 1,
            endPage: group?.endPage || 1,
            relevantExcerpt: result.excerpt,
          }],
          entities: result.entities,
          confidence: 0.8,
        },
        llmCall: result.llmCall,
      };
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a synthesis agent. Combine multiple partial answers into a coherent, comprehensive response.
Maintain accuracy and cite sources. Remove redundancy while preserving all unique information.
Respond with JSON: { "answer": "synthesized answer", "confidence": 0.0-1.0 }`,
      },
      {
        role: 'user',
        content: `Original Query: ${query}

Partial Answers from Document Sections:
${subagentResults.map((r, i) => `--- Section ${i + 1} (${r.groupId}) ---\n${r.answer}`).join('\n\n')}

Synthesize these into a comprehensive answer:`,
      },
    ];

    // Log before LLM call
    const { log, startTime } = this.logLLMCall('synthesis', messages);

    try {
      const merged = await this.llmClient.completeWithJSON<{
        answer: string;
        confidence: number;
      }>(messages);

      // Complete the log
      this.completeLLMCall(log, startTime, merged);
      llmCalls?.push(log);

      const allEntities: ExtractedEntity[] = [];
      const entityMap = new Map<string, ExtractedEntity>();
      for (const result of subagentResults) {
        for (const entity of result.entities) {
          const key = `${entity.type}:${entity.name}`;
          if (!entityMap.has(key) || entity.confidence > (entityMap.get(key)?.confidence || 0)) {
            entityMap.set(key, entity);
          }
        }
      }
      allEntities.push(...entityMap.values());

      const sources: SourceReference[] = subagentResults.map(r => {
        const group = stored.groups.find(g => g.id === r.groupId);
        return {
          groupId: r.groupId,
          groupTitle: group?.title,
          startPage: group?.startPage || 1,
          endPage: group?.endPage || 1,
          relevantExcerpt: r.excerpt,
        };
      });

      return {
        result: {
          answer: merged.answer,
          sources,
          entities: allEntities,
          confidence: merged.confidence,
        },
        llmCall: log,
      };
    } catch (error) {
      this.completeLLMCall(log, startTime, undefined, error instanceof Error ? error.message : String(error));
      llmCalls?.push(log);
      throw error;
    }
  }

  /**
   * Get the query log persistence instance
   */
  getQueryLogPersistence(): QueryLogPersistence {
    return this.queryLogPersistence;
  }
}

export function createQueryOrchestrator(
  llmClient: LLMClient,
  documentStore: DocumentStore
): QueryOrchestrator {
  return new QueryOrchestrator(llmClient, documentStore);
}