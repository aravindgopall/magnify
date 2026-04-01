"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPiMonoRoutes = createPiMonoRoutes;
const express_1 = require("express");
const child_process_1 = require("child_process");
const pi_session_logger_js_1 = require("./pi-session-logger.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Save query answer to file
 */
async function saveAnswer(answer) {
    // Get the magnify root directory (parent of dist folder)
    const MAGNIFY_ROOT = path_1.default.resolve(__dirname, '../..');
    const answersDir = path_1.default.join(MAGNIFY_ROOT, 'logs', 'pi-logs', 'answers');
    // Ensure directory exists
    if (!fs_1.default.existsSync(answersDir)) {
        fs_1.default.mkdirSync(answersDir, { recursive: true });
    }
    const filename = `${answer.sessionId}.json`;
    const filepath = path_1.default.join(answersDir, filename);
    await fs_1.default.promises.writeFile(filepath, JSON.stringify(answer, null, 2), 'utf-8');
    console.log(`[Answer Storage] Saved to: ${filepath}`);
    return filepath;
}
/**
 * Spawn a pi-mono agent and return its result with comprehensivelogging
 * @param sessionPath - Optional path to a persistent session file for multi-agent continuity
 */
async function spawnAgent(agentName, task, magnifyUrl, context, sessionPath) {
    const startTime = Date.now();
    // Add magnifyUrl to context if not present
    const fullContext = {
        ...context,
        magnifyUrl,
    };
    const fullTask = `${task}\n\nContext:\n${JSON.stringify(fullContext, null, 2)}`;
    console.log(`\n[Pi-Mono] >>> Starting agent: ${agentName}`);
    console.log(`[Pi-Mono] Task: ${task}`);
    console.log(`[Pi-Mono] Context:`, JSON.stringify(fullContext, null, 2));
    if (sessionPath) {
        console.log(`[Pi-Mono] Using persistent session: ${sessionPath}`);
    }
    return new Promise((resolve, reject) => {
        // Build pi command arguments
        const args = [
            '--mode', 'json',
            '-p',
            '--model', 'grid/glm-latest', // Explicitly use allowed model
            '--agent', agentName,
        ];
        // If sessionPath provided, use it for persistent session across agents
        // Otherwise use --no-session for isolated execution
        if (sessionPath) {
            args.push('--session', sessionPath);
        }
        else {
            args.push('--no-session');
        }
        args.push(fullTask);
        const piProcess = (0, child_process_1.spawn)('pi', args, {
            env: { ...process.env, MAGNIFY_URL: magnifyUrl },
            stdio: ['inherit', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const messages = [];
        const toolCalls = [];
        let finalMessageText = ''; // Store the final text output
        piProcess.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            // Log raw output
            console.log(`[Pi-Mono] ${agentName} stdout:`, text.trim());
            // Try to parse JSON output
            const lines = text.split('\n').filter((l) => l.trim());
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    // Track different message types
                    if (parsed.type === 'message' && parsed.content) {
                        messages.push(parsed.content);
                    }
                    // Extract final text output from message_end event
                    if (parsed.type === 'message_end' && parsed.message) {
                        const content = parsed.message.content;
                        if (Array.isArray(content)) {
                            // Extract text from content array
                            for (const item of content) {
                                if (item.type === 'text' && item.text) {
                                    finalMessageText += item.text;
                                }
                            }
                        }
                        console.log(`[Pi-Mono] ${agentName} final text length:`, finalMessageText.length);
                    }
                    if (parsed.type === 'tool_call') {
                        toolCalls.push(parsed);
                        console.log(`[Pi-Mono] ${agentName} tool call:`, JSON.stringify(parsed, null, 2));
                    }
                    if (parsed.type === 'tool_result') {
                        console.log(`[Pi-Mono] ${agentName} tool result:`, JSON.stringify(parsed, null, 2));
                    }
                }
                catch {
                    // Not JSON, ignore
                }
            }
        });
        piProcess.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            console.error(`[Pi-Mono] ${agentName} stderr:`, text.trim());
        });
        // Timeout after 15 minutes (increased for large documents)
        const timeoutMinutes = 15;
        const timeout = setTimeout(() => {
            console.error(`[Pi-Mono] ${agentName} timed out after ${timeoutMinutes} minutes`);
            console.error(`[Pi-Mono] ${agentName} task was: ${task.substring(0, 200)}...`);
            console.error(`[Pi-Mono] ${agentName} stdout so far: ${stdout.substring(0, 500)}...`);
            console.error(`[Pi-Mono] ${agentName} stderr so far: ${stderr.substring(0, 500)}...`);
            piProcess.kill('SIGTERM');
            reject(new Error(`Agent ${agentName} timed out after ${timeoutMinutes} minutes`));
        }, timeoutMinutes * 60 * 1000);
        piProcess.on('close', (code) => {
            clearTimeout(timeout);
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.log(`[Pi-Mono] <<< Agent ${agentName} completed in ${duration}ms with exit code ${code}`);
            if (code !== 0) {
                const errorMsg = `Agent exited with code ${code}: ${stderr}`;
                console.error(`[Pi-Mono] ${agentName} error:`, errorMsg);
                // Log to session logger
                const agentLog = {
                    agentName,
                    startTime,
                    endTime,
                    duration,
                    task,
                    context: fullContext,
                    llmCalls: [],
                    stdout,
                    stderr,
                    exitCode: code,
                    result: null,
                    error: errorMsg,
                };
                pi_session_logger_js_1.piSessionLogger.logAgent(agentLog);
                resolve({
                    result: null,
                    messages,
                    output: stdout,
                    stderr,
                    exitCode: code,
                    error: errorMsg,
                    startTime,
                    endTime,
                    duration,
                });
                return;
            }
            // Try to parse JSON from the final message text
            // Handle both raw JSON and JSON wrapped in markdown code blocks
            let result = null;
            // Use finalMessageText if available, otherwise fall back to stdout
            const textToParse = finalMessageText || stdout;
            console.log(`[Pi-Mono] ${agentName} parsing text (length: ${textToParse.length}), finalMessageText length: ${finalMessageText.length}`);
            // Strategy 1: Try to extract JSON from markdown code blocks (use LAST match)
            const jsonBlockMatches = textToParse.matchAll(/```json\s*([\s\S]*?)\s*```/g);
            const allMatches = Array.from(jsonBlockMatches);
            if (allMatches.length > 0) {
                // Use the LAST match (most recent output from agent)
                const lastMatch = allMatches[allMatches.length - 1];
                try {
                    result = JSON.parse(lastMatch[1].trim());
                    console.log(`[Pi-Mono] ${agentName} result (from markdown block ${allMatches.length}):`, JSON.stringify(result, null, 2));
                }
                catch (e) {
                    console.error(`[Pi-Mono] ${agentName} failed to parse JSON from markdown block:`, e);
                }
            }
            // Strategy 2: Try parsing each line from the end (for raw JSON output)
            if (!result) {
                const lines = textToParse.trim().split('\n').filter((l) => l.trim());
                for (let i = lines.length - 1; i >= 0; i--) {
                    try {
                        result = JSON.parse(lines[i]);
                        if (result && typeof result === 'object') {
                            console.log(`[Pi-Mono] ${agentName} result (from line ${i}):`, JSON.stringify(result, null, 2));
                            break;
                        }
                    }
                    catch {
                        continue;
                    }
                }
            }
            // Strategy 3: Try to find any JSON object in the text using regex
            if (!result) {
                const jsonObjectRegex = /\{[\s\S]*?"answer"[\s\S]*?\}/g;
                const jsonMatches = Array.from(textToParse.matchAll(jsonObjectRegex));
                for (let i = jsonMatches.length - 1; i >= 0; i--) {
                    try {
                        // Try to extract the full JSON object by finding matching braces
                        const startIdx = jsonMatches[i].index;
                        let braceCount = 0;
                        let endIdx = startIdx;
                        for (let j = startIdx; j < textToParse.length; j++) {
                            if (textToParse[j] === '{')
                                braceCount++;
                            if (textToParse[j] === '}')
                                braceCount--;
                            if (braceCount === 0 && j > startIdx) {
                                endIdx = j + 1;
                                break;
                            }
                        }
                        const jsonStr = textToParse.substring(startIdx, endIdx);
                        result = JSON.parse(jsonStr);
                        console.log(`[Pi-Mono] ${agentName} result (from JSON extraction):`, JSON.stringify(result, null, 2));
                        break;
                    }
                    catch {
                        continue;
                    }
                }
            }
            if (!result) {
                console.warn(`[Pi-Mono] ${agentName} failed to parse JSON from output. Raw output length: ${textToParse.length}`);
                console.warn(`[Pi-Mono] ${agentName} first 500 chars:`, textToParse.substring(0, 500));
            }
            // Log to session logger
            const agentLog = {
                agentName,
                startTime,
                endTime,
                duration,
                task,
                context: fullContext,
                llmCalls: [], // TODO: Parse from output
                stdout,
                stderr,
                exitCode: code,
                result,
            };
            pi_session_logger_js_1.piSessionLogger.logAgent(agentLog);
            resolve({
                result,
                messages,
                output: stdout,
                stderr,
                exitCode: code,
                startTime,
                endTime,
                duration,
            });
        });
        piProcess.on('error', (error) => {
            clearTimeout(timeout);
            const endTime = Date.now();
            console.error(`[Pi-Mono] ${agentName} process error:`, error);
            // Log error
            const agentLog = {
                agentName,
                startTime,
                endTime,
                duration: endTime - startTime,
                task,
                context: fullContext,
                llmCalls: [],
                stdout,
                stderr,
                exitCode: null,
                result: null,
                error: error.message,
            };
            pi_session_logger_js_1.piSessionLogger.logAgent(agentLog);
            reject(error);
        });
    });
}
/**
 * Infer extraction type from query using LLM
 */
async function inferExtractionType(query, llmClient) {
    try {
        const messages = [
            {
                role: 'system',
                content: `You are an expert at analyzing user queries and determining the appropriate extraction type.

Extraction Types:
- **summary**: User wants a brief explanation, overview, or quick answer. Keywords: "summarize", "what is", "briefly explain", "give me an overview", "in short".
- **entities**: User wants specific concepts, terms, items, or named entities extracted. Keywords: "list", "identify", "extract", "find all", "what are the key concepts", "name the components".
- **full**: User wants comprehensive details, comparisons, or in-depth analysis. Keywords: "explain in detail", "compare", "difference between", "how does it work", "elaborate", "comprehensive".

Return ONLY a JSON object with this structure:
{
  "extractionType": "summary" | "entities" | "full",
  "reasoning": "brief explanation of why this type was chosen"
}`,
            },
            {
                role: 'user',
                content: `Analyze this query and determine the appropriate extraction type:

Query: "${query}"

What extraction type should be used?`,
            },
        ];
        const result = await llmClient.completeWithJSON(messages);
        console.log(`[Extraction Type Inference] Query: "${query}"`);
        console.log(`[Extraction Type Inference] Type: ${result.extractionType}`);
        console.log(`[Extraction Type Inference] Reasoning: ${result.reasoning}`);
        return result.extractionType;
    }
    catch (error) {
        console.error('[Extraction Type Inference] Failed, defaulting to summary:', error);
        return 'summary';
    }
}
/**
 * Execute multi-agent query using pi-mono agents
 * Uses original query with appended context instead of rewriting
 * @param usePersistentSession - If true, uses a single pi-mono session for all agents (rewriter, explorer, reader)
 */
async function executeMultiAgentQuery(documentId, query, magnifyUrl, llmClient, extractionType, usePersistentSession = false // Default to FALSE - separate sessions per agent
) {
    const startTime = Date.now();
    const inferredType = extractionType || (await inferExtractionType(query, llmClient));
    // Start session logging
    const sessionId = pi_session_logger_js_1.piSessionLogger.startSession(documentId, query, inferredType);
    // If using persistent session, create a session file path
    // NOTE: Persistent sessions across different agents cause message format issues
    const sessionPath = usePersistentSession ? `/tmp/pi-mono-${sessionId}` : undefined;
    console.log(`[Pi-Mono] =================================`);
    console.log(`[Pi-Mono] Session: ${sessionId}`);
    console.log(`[Pi-Mono] Document: ${documentId}`);
    console.log(`[Pi-Mono] Query: ${query}`);
    console.log(`[Pi-Mono] Extraction Type: ${inferredType}`);
    console.log(`[Pi-Mono] Magnify URL: ${magnifyUrl}`);
    console.log(`[Pi-Mono] Persistent Session: ${usePersistentSession ? 'ENABLED (Shared session - may cause issues)' : 'DISABLED (Separate sessions per agent)'}`);
    if (usePersistentSession) {
        console.log(`[Pi-Mono] Session file: ${sessionPath}`);
    }
    console.log(`[Pi-Mono] =================================\n`);
    // If using persistent session, create a session file path (REMOVED - already declared earlier)
    try {
        // Step 0: Rewriter - Transform query into instructions
        // Agent definition in rewriter.md handles HOW to transform
        console.log('[Pi-Mono] Step 0: Rewriter agent...');
        console.log(`[Pi-Mono] Rewriter session path: ${sessionPath || 'NONE (separate session)'}`);
        const rewriterTask = query; // Simple: just pass the query, rewriter.md has the instructions
        const rewriterResult = await spawnAgent('rewriter', rewriterTask, magnifyUrl, {
            documentId,
            magnifyUrl,
        }, sessionPath);
        let explorerInstruction = query;
        let readerInstruction = query;
        if (rewriterResult.result && rewriterResult.result.explorer_instruction) {
            explorerInstruction = rewriterResult.result.explorer_instruction;
            readerInstruction = rewriterResult.result.reader_instruction;
            console.log(`[Pi-Mono] Rewriter transformed query:`);
            console.log(`  Explorer: ${explorerInstruction.substring(0, 100)}...`);
            console.log(`  Reader: ${readerInstruction.substring(0, 100)}...`);
        }
        else {
            console.log(`[Pi-Mono] Rewriter failed, using original query`);
        }
        // Step 1: Explorer - Find relevant sections
        // Agent definition in explorer.md handles HOW to match groups
        console.log('[Pi-Mono] Step 1: Explorer agent...');
        const explorerTask = `${explorerInstruction}

API Endpoint: ${magnifyUrl}/api/documents/${documentId}/groups`;
        const explorerResult = await spawnAgent('explorer', explorerTask, magnifyUrl, {
            documentId,
            magnifyUrl,
        }, sessionPath);
        if (!explorerResult.result || !explorerResult.result.matchedGroups) {
            const errorMsg = `Explorer failed: ${explorerResult.error || 'No groups found'}\n` +
                `Explorer stdout: ${explorerResult.output}\n` +
                `Explorer stderr: ${explorerResult.stderr}`;
            throw new Error(errorMsg);
        }
        const matchedGroups = explorerResult.result.matchedGroups;
        console.log(`[Pi-Mono] Explorer found ${matchedGroups.length} groups`);
        // Step 2: Reader - Extract content from groups
        // Agent definition in reader.md handles HOW to call API and format response
        console.log('[Pi-Mono] Step 2: Reader agent...');
        const readerTask = `${readerInstruction}

API Details:
- Endpoint: POST ${magnifyUrl}/api/query
- Document ID: ${documentId}
- Group IDs: ${JSON.stringify(matchedGroups.map((g) => g.groupId))}
- Extraction Type: ${inferredType}

Matched Groups:
${JSON.stringify(matchedGroups, null, 2)}`;
        const readerResult = await spawnAgent('reader', readerTask, magnifyUrl, {
            documentId,
            groupIds: matchedGroups.map((g) => g.groupId),
            extractionType: inferredType,
            magnifyUrl,
        }, sessionPath);
        if (!readerResult.result) {
            // Try to salvage output if agent produced text but not in proper JSON format
            console.warn(`[Pi-Mono] Reader produced output but not in expected JSON format. Attempting to salvage...`);
            const salvaged = {
                answer: readerResult.output || readerResult.messages.join('\n') || 'No content extracted',
                sources: matchedGroups.map((g) => ({
                    groupId: g.groupId,
                    title: g.title || g.groupTitle,
                })),
                warning: 'Output was not in expected JSON format and was salvaged from raw text',
            };
            if (salvaged.answer.length < 50) {
                throw new Error(`Reader failed: ${readerResult.error || 'No content extracted'}`);
            }
            readerResult.result = salvaged;
            console.log(`[Pi-Mono] Salvaged reader output (${salvaged.answer.length} chars)`);
        }
        const endTime = Date.now();
        const result = {
            success: true,
            sessionId,
            documentId,
            query,
            extractionType: inferredType,
            answer: readerResult.result.answer || readerResult.result,
            sources: matchedGroups.map((g) => ({
                groupId: g.groupId,
                groupTitle: g.title,
                startPage: g.startPage,
                endPage: g.endPage,
            })),
            pipeline: {
                explorer: {
                    groupsFound: matchedGroups.length,
                    messages: explorerResult.messages,
                    duration: explorerResult.duration,
                },
                reader: {
                    extractionType: inferredType,
                    messages: readerResult.messages,
                    duration: readerResult.duration,
                },
            },
            duration: endTime - startTime,
        };
        // Save answer to file
        let answerFilePath;
        try {
            const storedAnswer = {
                sessionId,
                documentId,
                query,
                extractionType: inferredType,
                timestamp: new Date().toISOString(),
                answer: result.answer.result?.answer || result.answer,
                sources: result.sources,
                stats: {
                    explorerGroupsFound: matchedGroups.length,
                    readerDuration: readerResult.duration,
                    totalDuration: endTime - startTime,
                },
            };
            answerFilePath = await saveAnswer(storedAnswer);
        }
        catch (saveError) {
            console.error('[Pi-Mono] Failed to save answer:', saveError);
            // Don't fail the request if answer storage fails
        }
        // Add answer file path to result
        if (answerFilePath) {
            result.answerFilePath = answerFilePath;
        }
        // End session logging
        pi_session_logger_js_1.piSessionLogger.endSession(result);
        console.log(`\n[Pi-Mono] =================================`);
        console.log(`[Pi-Mono] Session completed: ${sessionId}`);
        console.log(`[Pi-Mono] Total duration: ${result.duration}ms`);
        console.log(`[Pi-Mono] Session metadata: logs/pi-logs/pi-sessions/${sessionId}.json`);
        console.log(`[Pi-Mono] Agent logs: logs/pi-logs/${sessionId}_*.log`);
        if (answerFilePath) {
            console.log(`[Pi-Mono] Answer saved: ${answerFilePath}`);
        }
        console.log(`[Pi-Mono] =================================\n`);
        return result;
    }
    catch (error) {
        // End session with error
        pi_session_logger_js_1.piSessionLogger.endSession(null, error.message);
        throw error;
    }
}
/**
 * Create pi-mono agent routes
 */
function createPiMonoRoutes(context) {
    const router = (0, express_1.Router)();
    /**
     * POST /api/query-agents
     * Query document using pi-mono multi-agent pipeline
     */
    router.post('/query-agents', async (req, res) => {
        try {
            const { documentId, query, extractionType, usePersistentSession } = req.body;
            if (!documentId) {
                return res.status(400).json({
                    error: 'Missing documentId',
                });
            }
            if (!query) {
                return res.status(400).json({
                    error: 'Missing query',
                });
            }
            // Check if document exists
            const store = context.documentStore;
            const doc = store.get(documentId);
            if (!doc) {
                return res.status(404).json({
                    error: 'Document not found',
                    documentId,
                });
            }
            // Get magnify URL from environment or construct it
            const magnifyUrl = process.env.MAGNIFY_URL || `http://localhost:${process.env.PORT || 3000}`;
            // Check if pi command exists
            try {
                const { execSync } = await import('child_process');
                execSync('which pi', { stdio: 'ignore' });
            }
            catch {
                return res.status(503).json({
                    error: 'Pi-mono not available',
                    message: 'The "pi" command is not found in PATH. Install pi-mono first.',
                    fallback: 'Use POST /api/query for native Magnify query (no multi-agent)',
                });
            }
            console.log(`[Pi-Mono] Starting multi-agent query for document ${documentId}`);
            const result = await executeMultiAgentQuery(documentId, query, magnifyUrl, context.llmClient, extractionType, usePersistentSession ?? true // Default to true for shared session across agents
            );
            res.json(result);
        }
        catch (error) {
            console.error('[Pi-Mono] Query failed:', error);
            res.status(500).json({
                error: 'Query failed',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/documents/:id/query-agents
     * Query specific document using pi-mono multi-agent pipeline
     */
    router.post('/documents/:id/query-agents', async (req, res) => {
        try {
            const { id: documentId } = req.params;
            const { query, extractionType, usePersistentSession } = req.body;
            if (!query) {
                return res.status(400).json({
                    error: 'Missing query',
                });
            }
            // Check if document exists
            const store = context.documentStore;
            const doc = store.get(documentId);
            if (!doc) {
                return res.status(404).json({
                    error: 'Document not found',
                    documentId,
                });
            }
            const magnifyUrl = process.env.MAGNIFY_URL || `http://localhost:${process.env.PORT || 3000}`;
            // Check if pi command exists
            try {
                const { execSync } = await import('child_process');
                execSync('which pi', { stdio: 'ignore' });
            }
            catch {
                return res.status(503).json({
                    error: 'Pi-mono not available',
                    message: 'The "pi" command is not found in PATH. Install pi-mono first.',
                    fallback: 'Use POST /api/documents/:id/query for native Magnify query',
                });
            }
            console.log(`[Pi-Mono] Starting multi-agent query for document ${documentId}`);
            const result = await executeMultiAgentQuery(documentId, query, magnifyUrl, context.llmClient, extractionType, usePersistentSession ?? true // Default to TRUE for shared session across all agents
            );
            res.json(result);
        }
        catch (error) {
            console.error('[Pi-Mono] Query failed:', error);
            res.status(500).json({
                error: 'Query failed',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/pi-sessions
     * Get all pi-mono session logs
     */
    router.get('/pi-sessions', async (req, res) => {
        try {
            const sessions = pi_session_logger_js_1.piSessionLogger.getAllSessions();
            res.json({
                total: sessions.length,
                sessions: sessions.map(s => ({
                    sessionId: s.sessionId,
                    documentId: s.documentId,
                    query: s.query,
                    extractionType: s.extractionType,
                    startTime: s.startTime,
                    duration: s.duration,
                    agents: s.agents.length,
                    success: !s.error,
                    error: s.error,
                })),
            });
        }
        catch (error) {
            res.status(500).json({
                error: 'Failed to retrieve sessions',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/pi-sessions/:id
     * Get detailed log for a specific session
     */
    router.get('/pi-sessions/:id', async (req, res) => {
        try {
            const { id: sessionId } = req.params;
            const session = pi_session_logger_js_1.piSessionLogger.getSession(sessionId);
            if (!session) {
                return res.status(404).json({
                    error: 'Session not found',
                    sessionId,
                });
            }
            res.json(session);
        }
        catch (error) {
            res.status(500).json({
                error: 'Failed to retrieve session',
                message: error.message,
            });
        }
    });
    return router;
}
//# sourceMappingURL=pi-mono-routes.js.map