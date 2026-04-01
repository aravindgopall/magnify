/**
 * Represents an LLM message for logging
 */
export interface LLMMessageLog {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/**
 * Represents an LLM call log
 */
export interface LLMCallLog {
    agentType: 'router' | 'extraction' | 'synthesis';
    groupId?: string;
    messages: LLMMessageLog[];
    timestamp: string;
    durationMs?: number;
    response?: unknown;
    error?: string;
}
/**
 * Represents a single query execution log
 */
export interface QueryLog {
    queryId: string;
    documentId: string;
    timestamp: Date;
    query: string;
    extractionType: 'summary' | 'entities' | 'full' | 'custom' | undefined;
    customPrompt?: string;
    documentContext: {
        title?: string;
        documentType?: string;
        totalGroups: number;
        totalPageCount: number;
    };
    routing: {
        requestedGroupIds?: string[];
        selectedGroupIds: string[];
        selectedGroups: Array<{
            id: string;
            title?: string;
            startPage: number;
            endPage: number;
        }>;
        reasoning: string;
        durationMs: number;
        llmCall?: LLMCallLog;
    };
    subagentResults: Array<{
        groupId: string;
        groupTitle?: string;
        startPage: number;
        endPage: number;
        answer: string;
        entities: Array<{
            type: string;
            name: string;
            value?: string;
            confidence: number;
        }>;
        relevantExcerpt: string;
        tokensUsed: number;
        durationMs: number;
        llmCall?: LLMCallLog;
    }>;
    mergeResult: {
        type: 'single' | 'synthesis' | 'none';
        reasoning?: string;
        durationMs: number;
        llmCall?: LLMCallLog;
    };
    finalResult: {
        answer: string;
        sources: Array<{
            groupId: string;
            groupTitle?: string;
            startPage: number;
            endPage: number;
            relevantExcerpt?: string;
        }>;
        entities: Array<{
            type: string;
            name: string;
            value?: string;
            confidence: number;
        }>;
        confidence: number;
    };
    performance: {
        totalDurationMs: number;
        routingDurationMs: number;
        subagentDurationMs: number;
        mergeDurationMs: number;
        totalTokensUsed: number;
    };
    llmCalls: LLMCallLog[];
}
/**
 * File-based persistence for query logs
 */
export declare class QueryLogPersistence {
    private logsDir;
    constructor(logsDir?: string);
    /**
     * Ensure the logs directory exists
     */
    private ensureLogsDirectory;
    /**
     * Get the file path for a query log
     * Note: queryId now includes query slug, so filename is descriptive
     */
    private getLogPath;
    /**
     * Save a query log to disk
     */
    saveLog(log: QueryLog): Promise<void>;
    /**
     * Load a query log from disk
     */
    loadLog(queryId: string): Promise<QueryLog | null>;
    /**
     * List all query log IDs
     */
    listLogIds(): Promise<string[]>;
    /**
     * Load all query logs
     */
    loadAllLogs(): Promise<QueryLog[]>;
    /**
     * Load recent logs (limited count)
     */
    loadRecentLogs(limit?: number): Promise<QueryLog[]>;
    /**
     * Load logs for a specific document
     */
    loadLogsForDocument(documentId: string): Promise<QueryLog[]>;
    /**
     * Delete a query log
     */
    deleteLog(queryId: string): Promise<boolean>;
    /**
     * Delete all logs for a document
     */
    deleteLogsForDocument(documentId: string): Promise<number>;
    /**
     * Get logs directory stats
     */
    getStats(): Promise<{
        totalLogs: number;
        totalSizeBytes: number;
        logsDirectory: string;
    }>;
}
/**
 * Create a query log persistence instance
 */
export declare function createQueryLogPersistence(logsDir?: string): QueryLogPersistence;
//# sourceMappingURL=query-log.d.ts.map