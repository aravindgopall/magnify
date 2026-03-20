import type { SubagentResult, MergedOutput, GroupResult, OutputConfig } from '../types/index.js';
export interface MergerOptions {
    deduplicateEntities?: boolean;
    mergeSections?: boolean;
    maxSummaryLength?: number;
    sortEntitiesByConfidence?: boolean;
}
export declare class OutputMerger {
    private options;
    constructor(options?: MergerOptions);
    merge(results: SubagentResult[]): MergedOutput;
    toGroupResults(results: SubagentResult[]): GroupResult[];
    private mergeAllSections;
    private mergeContent;
    private sortSections;
    private mergeAllEntities;
    private deduplicateEntities;
    private mergeAllTables;
    private generateCombinedSummary;
    private truncateSummary;
    private extractTitle;
    private buildMetadata;
    private buildFullContent;
}
export declare class OutputFormatter {
    format(output: MergedOutput, config: OutputConfig): string;
    private toJSON;
    private toMarkdown;
    private toSummary;
    private toSearchIndex;
    private groupEntitiesByType;
}
export declare function createMerger(options?: MergerOptions): OutputMerger;
export declare function createFormatter(): OutputFormatter;
//# sourceMappingURL=merger.d.ts.map