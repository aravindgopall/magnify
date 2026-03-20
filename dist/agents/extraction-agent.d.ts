import { BaseSubagent } from './base-agent.js';
import type { SubagentConfig, SubagentResult, DocumentGroup } from '../types/index.js';
export interface ExtractionAgentConfig extends SubagentConfig {
    extractEntities?: boolean;
    extractSections?: boolean;
    extractTables?: boolean;
    extractSummary?: boolean;
    llmClient?: LLMClient;
}
export interface LLMClient {
    complete(prompt: string): Promise<string>;
}
export declare class ExtractionAgent extends BaseSubagent {
    private extractionConfig;
    constructor(config: ExtractionAgentConfig);
    execute(group: DocumentGroup): Promise<SubagentResult>;
    private extractContent;
    private extractEntitiesFromContent;
    private deduplicateEntities;
    private extractSectionsFromContent;
    private extractTablesFromContent;
    private detectTables;
    private parseTableRow;
    private generateSummary;
    private enhanceWithLLM;
    private parseLLMResponse;
}
export declare function createExtractionAgent(config: ExtractionAgentConfig): ExtractionAgent;
//# sourceMappingURL=extraction-agent.d.ts.map