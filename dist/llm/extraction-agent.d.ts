import type { LLMClient } from './client.js';
import type { DocumentGroup, SubagentResult } from '../types/index.js';
export interface ExtractionPrompt {
    systemPrompt: string;
    extractionSchema?: Record<string, unknown>;
}
export declare class LLMExtractionAgent {
    private llmClient;
    private agentId;
    private customPrompt?;
    private extractionSchema?;
    constructor(llmClient: LLMClient, options?: {
        agentId?: string;
        customPrompt?: string;
        extractionSchema?: Record<string, unknown>;
    });
    execute(group: DocumentGroup): Promise<SubagentResult>;
    private prepareContent;
    private buildMessages;
    private getDefaultSystemPrompt;
}
export declare function createLLMExtractionAgent(llmClient: LLMClient, options?: {
    agentId?: string;
    customPrompt?: string;
    extractionSchema?: Record<string, unknown>;
}): LLMExtractionAgent;
//# sourceMappingURL=extraction-agent.d.ts.map