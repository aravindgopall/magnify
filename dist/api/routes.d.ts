import { type Router } from 'express';
import type { LLMClient } from '../llm/client.js';
import { DocumentStore } from '../store/index.js';
import { QueryOrchestrator } from '../orchestrator/index.js';
import { PiMonoQueryAgent } from '../query/index.js';
export interface APIContext {
    documentStore: DocumentStore;
    queryOrchestrator: QueryOrchestrator;
    piMonoQueryAgent: PiMonoQueryAgent;
    llmClient: LLMClient;
}
export interface APIConfig {
    maxFileSize: number;
}
export declare function createRouter(context: APIContext): Router;
export declare function createAPIContext(llmClient: LLMClient): APIContext;
/**
 * Initialize the API context by loading persisted documents
 */
export declare function initializeAPIContext(context: APIContext): Promise<void>;
//# sourceMappingURL=routes.d.ts.map