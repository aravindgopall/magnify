import type { PipelineResult, OutputFormat, GroupingStrategy } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
export interface FlowConfig {
    name: string;
    description?: string;
    groupingStrategy?: GroupingStrategy;
    extractionPrompt?: string;
}
export interface FlowExecution {
    id: string;
    flowName: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startTime: Date;
    endTime?: Date;
    result?: PipelineResult;
    error?: string;
}
export interface BatchJob {
    id: string;
    sources: Array<string | Buffer>;
    config: FlowConfig;
    executions: FlowExecution[];
    status: 'pending' | 'running' | 'completed' | 'partial' | 'failed';
    startTime?: Date;
    endTime?: Date;
}
export type FlowPreset = 'document' | 'report' | 'invoice' | 'research' | 'book' | 'manual';
export declare class BusinessFlow {
    private llmClient;
    private executions;
    private batchJobs;
    constructor(llmClient: LLMClient);
    createFlow(name: string, config?: Partial<FlowConfig>): FlowConfig;
    createFlowFromPreset(preset: FlowPreset, overrides?: Partial<FlowConfig>): FlowConfig;
    execute(source: string | Buffer, flow: FlowConfig): Promise<FlowExecution>;
    executeBatch(sources: Array<string | Buffer>, flow: FlowConfig, options?: BatchOptions): Promise<BatchJob>;
    private processQueue;
    private determineBatchStatus;
    getExecution(id: string): FlowExecution | undefined;
    getBatchJob(id: string): BatchJob | undefined;
    listExecutions(): FlowExecution[];
    listBatchJobs(): BatchJob[];
    exportResult(result: PipelineResult, format: OutputFormat): Promise<string>;
    exportBatchResults(jobId: string, format: OutputFormat): Promise<Array<{
        executionId: string;
        output: string;
    }>>;
}
export interface BatchOptions {
    concurrency?: number;
}
export declare function createBusinessFlow(llmClient: LLMClient): BusinessFlow;
//# sourceMappingURL=business-flow.d.ts.map