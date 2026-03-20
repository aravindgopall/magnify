import type { Subagent, SubagentConfig, SubagentResult, DocumentGroup, ExtractedData } from '../types/index.js';
export declare abstract class BaseSubagent implements Subagent {
    id: string;
    config: SubagentConfig;
    constructor(config: SubagentConfig);
    abstract execute(group: DocumentGroup): Promise<SubagentResult>;
    protected createSuccessResult(groupId: string, data: ExtractedData, duration: number): SubagentResult;
    protected createErrorResult(groupId: string, error: string, duration: number): SubagentResult;
    protected buildExtractionPrompt(group: DocumentGroup): string;
    protected getDefaultPrompt(): string;
}
//# sourceMappingURL=base-agent.d.ts.map