export interface AgentLog {
    agentName: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    task: string;
    context?: Record<string, any>;
    llmCalls: LLMCall[];
    stdout: string;
    stderr: string;
    exitCode: number | null;
    result: any;
    error?: string;
}
export interface LLMCall {
    timestamp: number;
    model: string;
    request: {
        prompt?: string;
        messages?: any[];
        temperature?: number;
        maxTokens?: number;
    };
    response: {
        content?: string;
        toolCalls?: any[];
        usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
    };
    duration: number;
    cost?: number;
}
export interface PiSession {
    sessionId: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    documentId: string;
    query: string;
    extractionType: string;
    agents: AgentLog[];
    result: any;
    error?: string;
}
export declare class PiSessionLogger {
    private logsDir;
    private piLogsDir;
    private currentSession;
    constructor();
    /**
     * Generate a filename-safe slug from query text
     * Extracts key words and formats for use in filenames
     */
    private generateQuerySlug;
    /**
     * Start a new pi-mono session
     */
    startSession(documentId: string, query: string, extractionType: string): string;
    /**
     * Log an agent execution
     */
    logAgent(log: AgentLog): void;
    /**
     * Filter streaming logs to keep only important events
     */
    private filterStreamingLogs;
    /**
     * Save raw agent logs (stdout/stderr) to pi-logs folder
     * Now filters out token streaming to keep logs small
     */
    private saveAgentLogs;
    /**
     * End the current session
     */
    endSession(result: any, error?: string): void;
    /**
     * Save the current session to disk
     * Note: stdout/stderr are excluded from session metadata - they're saved separately in pi-logs
     */
    private saveSession;
    /**
     * Get all sessions
     */
    getAllSessions(): PiSession[];
    /**
     * Get a specific session
     */
    getSession(sessionId: string): PiSession | null;
    /**
     * Get current session ID
     */
    getCurrentSessionId(): string | null;
}
export declare const piSessionLogger: PiSessionLogger;
//# sourceMappingURL=pi-session-logger.d.ts.map