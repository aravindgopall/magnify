import type { PDFDocument, DocumentGroup, GroupingConfig, GroupingStrategy } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
export interface GroupingStrategyHandler {
    group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
}
export declare class FixedPageGrouper implements GroupingStrategyHandler {
    group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
}
export declare class LLMGrouper implements GroupingStrategyHandler {
    private llmClient;
    constructor(llmClient: LLMClient);
    group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
}
export declare class HeadingGrouper implements GroupingStrategyHandler {
    group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
    private extractHeadings;
    private mergeSmallGroups;
}
export declare class TOCGrouper implements GroupingStrategyHandler {
    group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
    private flattenTOC;
}
export declare class GroupingStrategyFactory {
    private llmClient?;
    setLLMClient(client: LLMClient): void;
    getHandler(strategy: GroupingStrategy): GroupingStrategyHandler;
    group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
}
export declare const groupingFactory: GroupingStrategyFactory;
//# sourceMappingURL=strategies.d.ts.map