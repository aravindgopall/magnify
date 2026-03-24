import type { LLMClient } from '../llm/client.js';
import type { DocumentStore } from '../store/index.js';
import { QueryLogPersistence } from '../store/query-log.js';
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
export declare class QueryOrchestrator {
    private llmClient;
    private documentStore;
    private maxConcurrentRequests;
    private queryLogPersistence;
    constructor(llmClient: LLMClient, documentStore: DocumentStore);
    /**
     * Process items in batches to avoid rate limiting
     */
    private processInBatches;
    /**
     * Log LLM call before making it
     */
    private logLLMCall;
    /**
     * Complete LLM call log after response
     */
    private completeLLMCall;
    execute(request: QueryRequest): Promise<QueryResponse>;
    private identifyRelevantGroups;
    private executeSubagent;
    private getSystemPrompt;
    private mergeResults;
    /**
     * Get the query log persistence instance
     */
    getQueryLogPersistence(): QueryLogPersistence;
}
export declare function createQueryOrchestrator(llmClient: LLMClient, documentStore: DocumentStore): QueryOrchestrator;
//# sourceMappingURL=query-orchestrator.d.ts.map