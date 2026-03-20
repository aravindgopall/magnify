import type { LLMClient } from '../llm/client.js';
import type { DocumentStore } from '../store/index.js';
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
    constructor(llmClient: LLMClient, documentStore: DocumentStore);
    execute(request: QueryRequest): Promise<QueryResponse>;
    private identifyRelevantGroups;
    private executeSubagent;
    private getSystemPrompt;
    private mergeResults;
}
export declare function createQueryOrchestrator(llmClient: LLMClient, documentStore: DocumentStore): QueryOrchestrator;
//# sourceMappingURL=query-orchestrator.d.ts.map