import type { DocumentStore } from '../store/index.js';
import type { QueryAgentConfig, QueryAgentResult } from './types.js';
/**
 * Main query agent that orchestrates sub-agents to answer questions about documents.
 * Uses pi-mono Agent for both sub-agents (context extraction) and final synthesis.
 */
export declare class PiMonoQueryAgent {
    private store;
    private mainAgent;
    constructor(store: DocumentStore);
    private buildMainSystemPrompt;
    /**
     * Get formatting instructions based on extraction type
     */
    private getFormatInstructions;
    /**
     * Execute a query against a document using parallel sub-agents.
     */
    execute(config: QueryAgentConfig): Promise<QueryAgentResult>;
    /**
     * Process groups in parallel with concurrency limit.
     * Ensures ALL sub-agents complete before returning.
     */
    private processGroupsInParallel;
    /**
     * Synthesize final answer from relevant contexts using the main agent.
     */
    private synthesizeAnswer;
    private extractTextFromMessage;
    /**
     * Remove reasoning/thinking patterns from the final answer
     */
    private cleanAnswer;
}
/**
 * Factory function to create a PiMonoQueryAgent.
 */
export declare function createPiMonoQueryAgent(store: DocumentStore): PiMonoQueryAgent;
//# sourceMappingURL=pi-mono-agent.d.ts.map