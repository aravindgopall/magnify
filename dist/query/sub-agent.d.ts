import type { DocumentGroup } from '../types/index.js';
import type { SubAgentResult } from './types.js';
/**
 * Sub-agent that analyzes a single document group to determine if it contains
 * relevant context for the user's query.
 */
export declare class GroupContextAgent {
    private agent;
    private extractionType?;
    private customPrompt?;
    constructor(extractionType?: 'summary' | 'entities' | 'full' | 'custom', customPrompt?: string);
    private buildSystemPrompt;
    private getExtractionInstructions;
    /**
     * Analyze a document group to extract relevant context for a query.
     * Returns false if the group contains no relevant information.
     */
    analyze(group: DocumentGroup, query: string, signal?: AbortSignal): Promise<SubAgentResult>;
    private extractGroupText;
    private buildAnalysisPrompt;
    private extractTextFromMessage;
    /**
     * Extract only the relevant content from the response, filtering out reasoning/thinking.
     * Skips lines that contain metacognitive phrases like "Let me", "Looking through", etc.
     */
    private extractRelevantContent;
    private extractExcerpt;
}
//# sourceMappingURL=sub-agent.d.ts.map