"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.piSessionLogger = exports.PiSessionLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Pi-Mono Session Logger
 *
 * Manages logging for pi-mono multi-agent sessions:
 *
 * logs/pi-sessions/  - Session metadata (structured JSON with results)
 * logs/pi-logs/      - Raw agent logs (stdout/stderr for debugging)
 * logs/queries/      - Regular magnify query logs (native magnify sessions)
 */
// Get the magnify root directory (parent of dist folder)
const MAGNIFY_ROOT = path_1.default.resolve(__dirname, '../..');
class PiSessionLogger {
    logsDir;
    piLogsDir;
    currentSession = null;
    constructor() {
        // Create logs/pi-logs/pi-sessions directory for pi-mono session logs
        this.logsDir = path_1.default.join(MAGNIFY_ROOT, 'logs', 'pi-sessions');
        if (!fs_1.default.existsSync(this.logsDir)) {
            fs_1.default.mkdirSync(this.logsDir, { recursive: true });
        }
        // Create logs/pi-logs directory for raw agent logs
        this.piLogsDir = path_1.default.join(MAGNIFY_ROOT, 'logs', 'pi-logs');
        if (!fs_1.default.existsSync(this.piLogsDir)) {
            fs_1.default.mkdirSync(this.piLogsDir, { recursive: true });
        }
    }
    /**
     * Generate a filename-safe slug from query text
     * Extracts key words and formats for use in filenames
     */
    generateQuerySlug(query) {
        // Remove special characters and convert to lowercase
        let slug = query
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .trim();
        // Extract meaningful words (skip common words)
        const stopWords = new Set([
            'what', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
            'to', 'for', 'of', 'with', 'by', 'from', 'as', 'can', 'you', 'me', 'i',
            'tell', 'show', 'explain', 'describe', 'how', 'does', 'do', 'will', 'would'
        ]);
        const words = slug
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 5); // Keep first 5 meaningful words
        // Join with underscores
        slug = words.join('_');
        // Fallback if slug is empty
        if (!slug || slug.length < 3) {
            slug = 'query';
        }
        // Limit length to 50 characters
        if (slug.length > 50) {
            slug = slug.substring(0, 50);
        }
        return slug;
    }
    /**
     * Start a new pi-mono session
     */
    startSession(documentId, query, extractionType) {
        const timestamp = Date.now();
        const querySlug = this.generateQuerySlug(query);
        const sessionId = `${querySlug}_${timestamp}`;
        this.currentSession = {
            sessionId,
            startTime: timestamp,
            documentId,
            query,
            extractionType,
            agents: [],
            result: null,
        };
        return sessionId;
    }
    /**
     * Log an agent execution
     */
    logAgent(log) {
        if (!this.currentSession) {
            console.warn('[PiSessionLogger] No active session to log agent to');
            return;
        }
        this.currentSession.agents.push(log);
        this.saveSession();
        // Also save raw agent logs to pi-logs folder
        this.saveAgentLogs(log);
    }
    /**
     * Filter streaming logs to keep only important events
     */
    filterStreamingLogs(stdout) {
        const lines = stdout.split('\n').filter(l => l.trim());
        const filteredLines = [];
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                const type = parsed.type;
                // Skip token-by-token streaming updates
                if (type === 'message_update' ||
                    type === 'thinking_delta' ||
                    type === 'text_delta') {
                    continue;
                }
                // Keep important structural events
                if (type === 'session' ||
                    type === 'agent_start' ||
                    type === 'turn_start' ||
                    type === 'turn_end' ||
                    type === 'message_start' ||
                    type === 'message_end' ||
                    type === 'tool_call' ||
                    type === 'tool_result' ||
                    type === 'thinking_start' ||
                    type === 'thinking_end' ||
                    type === 'error') {
                    filteredLines.push(line);
                }
            }
            catch {
                // Not JSON or failed to parse, keep as-is
                filteredLines.push(line);
            }
        }
        return filteredLines.join('\n');
    }
    /**
     * Save raw agent logs (stdout/stderr) to pi-logs folder
     * Now filters out token streaming to keep logs small
     */
    saveAgentLogs(log) {
        if (!this.currentSession)
            return;
        const sessionId = this.currentSession.sessionId;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${sessionId}_${log.agentName}_${timestamp}.log`;
        const filepath = path_1.default.join(this.piLogsDir, filename);
        try {
            // Filter stdout to remove token streaming events
            const filteredStdout = this.filterStreamingLogs(log.stdout || '');
            const logContent = [
                `=== Pi-Mono Agent Log ===`,
                `Session ID: ${sessionId}`,
                `Agent: ${log.agentName}`,
                `Start Time: ${new Date(log.startTime).toISOString()}`,
                `End Time: ${log.endTime ? new Date(log.endTime).toISOString() : 'N/A'}`,
                `Duration: ${log.duration ? `${log.duration}ms` : 'N/A'}`,
                `Exit Code: ${log.exitCode}`,
                ``,
                `=== Task ===`,
                log.task,
                ``,
                `=== Context ===`,
                JSON.stringify(log.context, null, 2),
                ``,
                `=== FILTERED STDOUT (streaming events removed) ===`,
                filteredStdout || '(empty)',
                ``,
                `=== STDERR ===`,
                log.stderr || '(empty)',
                ``,
                `=== Result ===`,
                JSON.stringify(log.result, null, 2),
                ``,
                `=== Error ===`,
                log.error || '(none)',
                ``,
                `=== Note ===`,
                `Log has been filtered to remove token-by-token streaming events (message_update, thinking_delta, text_delta).`,
                `This significantly reduces log size while preserving all important information.`,
                ``,
            ].join('\n');
            fs_1.default.writeFileSync(filepath, logContent, 'utf-8');
            console.log(`[PiSessionLogger] Saved filtered agent log: logs/pi-logs/${filename}`);
        }
        catch (err) {
            console.error('[PiSessionLogger] Failed to save agent log:', err);
        }
    }
    /**
     * End the current session
     */
    endSession(result, error) {
        if (!this.currentSession) {
            console.warn('[PiSessionLogger] No active session to end');
            return;
        }
        this.currentSession.endTime = Date.now();
        this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
        this.currentSession.result = result;
        this.currentSession.error = error;
        this.saveSession();
        this.currentSession = null;
    }
    /**
     * Save the current session to disk
     * Note: stdout/stderr are excluded from session metadata - they're saved separately in pi-logs
     */
    saveSession() {
        if (!this.currentSession)
            return;
        const filename = `${this.currentSession.sessionId}.json`;
        const filepath = path_1.default.join(this.logsDir, filename);
        try {
            // Create sanitized version without stdout/stderr in agent logs
            const sanitizedSession = {
                ...this.currentSession,
                agents: this.currentSession.agents.map(agent => {
                    const { stdout, stderr, ...agentWithoutLogs } = agent;
                    return agentWithoutLogs;
                })
            };
            fs_1.default.writeFileSync(filepath, JSON.stringify(sanitizedSession, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('[PiSessionLogger] Failed to save session:', err);
        }
    }
    /**
     * Get all sessions
     */
    getAllSessions() {
        try {
            const files = fs_1.default.readdirSync(this.logsDir).filter(f => f.endsWith('.json'));
            return files.map(f => {
                const content = fs_1.default.readFileSync(path_1.default.join(this.logsDir, f), 'utf-8');
                return JSON.parse(content);
            }).sort((a, b) => b.startTime - a.startTime);
        }
        catch (err) {
            console.error('[PiSessionLogger] Failed to read sessions:', err);
            return [];
        }
    }
    /**
     * Get a specific session
     */
    getSession(sessionId) {
        try {
            const filepath = path_1.default.join(this.logsDir, `${sessionId}.json`);
            if (!fs_1.default.existsSync(filepath))
                return null;
            const content = fs_1.default.readFileSync(filepath, 'utf-8');
            return JSON.parse(content);
        }
        catch (err) {
            console.error('[PiSessionLogger] Failed to read session:', err);
            return null;
        }
    }
    /**
     * Get current session ID
     */
    getCurrentSessionId() {
        return this.currentSession?.sessionId || null;
    }
}
exports.PiSessionLogger = PiSessionLogger;
// Singleton instance
exports.piSessionLogger = new PiSessionLogger();
//# sourceMappingURL=pi-session-logger.js.map