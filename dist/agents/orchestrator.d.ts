import type { Subagent, SubagentConfig, SubagentResult, DocumentGroup, ExecutionConfig, PipelineError } from '../types/index.js';
export interface OrchestratorConfig {
    execution: ExecutionConfig;
    agentFactory?: AgentFactory;
}
export interface AgentFactory {
    createAgent(group: DocumentGroup, config?: SubagentConfig): Subagent;
}
export declare class DefaultAgentFactory implements AgentFactory {
    private createAgentFn;
    constructor(createAgentFn: (group: DocumentGroup, config?: SubagentConfig) => Subagent);
    createAgent(group: DocumentGroup, config?: SubagentConfig): Subagent;
}
export interface OrchestratorResult {
    results: SubagentResult[];
    errors: PipelineError[];
    duration: number;
}
export declare class AgentOrchestrator {
    private config;
    private agentFactory?;
    private queue;
    constructor(config: OrchestratorConfig);
    setAgentFactory(factory: AgentFactory): void;
    executeGroups(groups: DocumentGroup[], agentConfigs?: Map<string, SubagentConfig>): Promise<OrchestratorResult>;
    private executeGroup;
    private executeWithTimeout;
    executeSingle(group: DocumentGroup, agentConfig?: SubagentConfig): Promise<SubagentResult>;
    getQueueStats(): {
        pending: number;
        active: number;
        size: number;
    };
    drain(): Promise<void>;
    clear(): void;
}
export declare function createOrchestrator(config: OrchestratorConfig): AgentOrchestrator;
//# sourceMappingURL=orchestrator.d.ts.map