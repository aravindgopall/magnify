import { type LLMClient } from '../llm/index.js';
import type { PipelineResult, PDFDocument, DocumentGroup, SubagentResult, MergedOutput, PipelineError, GroupingStrategy } from '../types/index.js';
export interface LLMPipelineConfig {
    llmClient: LLMClient;
    groupingStrategy?: GroupingStrategy;
    extractionPrompt?: string;
    extractionSchema?: Record<string, unknown>;
    execution?: {
        maxConcurrency?: number;
        retryAttempts?: number;
        retryDelay?: number;
        timeout?: number;
        continueOnError?: boolean;
    };
    output?: {
        format?: 'json' | 'markdown' | 'summary' | 'search-index';
        includeMetadata?: boolean;
        includeSourcePages?: boolean;
        prettyPrint?: boolean;
    };
}
export interface LLMPipelineHooks {
    onParseStart?: (source: string | Buffer) => void | Promise<void>;
    onParseComplete?: (document: PDFDocument) => void | Promise<void>;
    onAnalysisStart?: (document: PDFDocument) => void | Promise<void>;
    onAnalysisComplete?: (groups: DocumentGroup[], documentType: string) => void | Promise<void>;
    onExtractionStart?: (groups: DocumentGroup[]) => void | Promise<void>;
    onExtractionProgress?: (completed: number, total: number, groupId: string) => void | Promise<void>;
    onExtractionComplete?: (results: SubagentResult[]) => void | Promise<void>;
    onMergeStart?: (results: SubagentResult[]) => void | Promise<void>;
    onMergeComplete?: (output: MergedOutput) => void | Promise<void>;
    onError?: (error: PipelineError) => void | Promise<void>;
}
export declare class LLMPipeline {
    private config;
    private parser;
    private mainAgent;
    private llmClient;
    private merger;
    private formatter;
    private hooks;
    private queue;
    constructor(config: LLMPipelineConfig, hooks?: LLMPipelineHooks);
    execute(source: string | Buffer): Promise<PipelineResult>;
    private createFixedGroups;
    private executeExtraction;
    private executeWithTimeout;
    private calculateStatistics;
    private determineStatus;
    private createFailedResult;
    formatOutput(result: PipelineResult): string;
}
export declare function createLLMPipeline(config: LLMPipelineConfig, hooks?: LLMPipelineHooks): LLMPipeline;
//# sourceMappingURL=llm-pipeline.d.ts.map