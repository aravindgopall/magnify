import { type Router } from 'express';
import type { LLMClient } from '../llm/client.js';
import { DocumentStore } from '../store/index.js';
import { QueryOrchestrator } from '../orchestrator/index.js';
export interface APIContext {
    documentStore: DocumentStore;
    queryOrchestrator: QueryOrchestrator;
    llmClient: LLMClient;
}
export interface APIConfig {
    maxFileSize: number;
}
export declare function createRouter(context: APIContext): Router;
export declare function createAPIContext(llmClient: LLMClient): APIContext;
//# sourceMappingURL=routes.d.ts.map