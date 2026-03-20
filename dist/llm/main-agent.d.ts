import type { LLMClient } from './client.js';
import type { PDFDocument, DocumentGroup, GroupingStrategy } from '../types/index.js';
export interface IdentifiedGroup {
    id: string;
    title: string;
    startPage: number;
    endPage: number;
    reasoning: string;
    suggestedExtractionType?: string;
}
export interface PDFAnalysisResult {
    documentType: string;
    summary: string;
    groups: IdentifiedGroup[];
    recommendedStrategy: GroupingStrategy;
    metadata: {
        hasTOC: boolean;
        hasHeadings: boolean;
        estimatedComplexity: 'low' | 'medium' | 'high';
    };
}
export declare class MainAgent {
    private llmClient;
    constructor(llmClient: LLMClient);
    analyzeDocument(document: PDFDocument): Promise<PDFAnalysisResult>;
    identifyGroups(document: PDFDocument, strategy?: GroupingStrategy): Promise<DocumentGroup[]>;
    private extractSampleContent;
    private getPagesToSample;
    private formatTOC;
    private getSystemPrompt;
}
export declare function createMainAgent(llmClient: LLMClient): MainAgent;
//# sourceMappingURL=main-agent.d.ts.map