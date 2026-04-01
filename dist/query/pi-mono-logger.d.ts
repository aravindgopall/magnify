import type { QueryAgentConfig, QueryAgentResult } from './types.js';
/**
 * Simplified LLM call log - just the conversation
 */
export interface LLMCallLog {
    callId: string;
    timestamp: string;
    agentType: 'sub-agent' | 'main-agent';
    groupId?: string;
    groupTitle?: string;
    systemPrompt: string;
    userPrompt: string;
    response: string;
}
/**
 * Simplified answer log - just the essentials
 */
export interface QueryAnswerLog {
    query: string;
    documentId: string;
    extractionType?: string;
    answer: string;
}
/**
 * Logger for pi-mono query agents
 * Stores LLM calls, final answers, and session data separately
 */
export declare class PiMonoLogger {
    private llmCallsDir;
    private answersDir;
    private piMonoSessionsDir;
    private currentSessionId;
    constructor();
    /**
     * Ensure all log directories exist
     */
    private ensureDirectories;
    /**
     * Start a new query session
     */
    startSession(query: string, documentId: string): string;
    /**
     * Log an LLM call (request + response)
     */
    logLLMCall(agentType: 'sub-agent' | 'main-agent', systemPrompt: string, userPrompt: string, agentState: any, durationMs: number, groupId?: string, groupTitle?: string): Promise<string>;
    /**
     * Save the final query answer (simplified)
     */
    saveQueryAnswer(config: QueryAgentConfig, result: QueryAgentResult, totalDurationMs: number, mainAgentLLMCallId?: string, mainAgentDurationMs?: number): Promise<void>;
    /**
     * Extract text content from a message
     */
    private extractMessageContent;
    /**
     * Save pi-mono Agent state as a separate session log
     */
    private savePiMonoAgentState;
    /**
     * Filter out streaming/token-wise logs from pi-mono
     * Pi-mono streams events as JSONL with:
     * - turn_start/turn_end
     * - message_start/message_update/message_end
     * - tool_execution_start/tool_execution_update/tool_execution_end
     * We only keep complete messages (message_end, turn_end)
     */
    private filterStreamingLogs;
    /**
     * Remove streaming metadata from message
     */
    private cleanMessage;
    /**
     * Generate a short random ID
     */
    private generateId;
    /**
     * Load a query answer by session ID
     */
    loadQueryAnswer(sessionId: string): Promise<QueryAnswerLog | null>;
    /**
     * Load an LLM call log
     */
    loadLLMCall(callId: string): Promise<LLMCallLog | null>;
    /**
     * List recent query answers
     */
    listRecentAnswers(limit?: number): Promise<string[]>;
}
export declare function getPiMonoLogger(): PiMonoLogger;
//# sourceMappingURL=pi-mono-logger.d.ts.map