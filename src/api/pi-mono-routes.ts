import { Router, type Request, type Response } from 'express';
import { spawn } from 'child_process';
import type { APIContext } from './routes.js';
import { piSessionLogger, type AgentLog } from './pi-session-logger.js';

interface AgentResult {
  result: any;
  messages: string[];
  output: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Spawn a pi-mono agent and return its result with comprehensive logging
 */
async function spawnAgent(
  agentName: string,
  task: string,
  magnifyUrl: string,
  context?: Record<string, any>
): Promise<AgentResult> {
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

  return new Promise((resolve, reject) => {
    const piProcess = spawn('pi', [
      '--mode', 'json',
      '-p',
      '--no-session',
      '--model', 'grid/glm-latest',  // Explicitly use allowed model
      '--agent', agentName,
      fullTask
    ], {
      env: { ...process.env, MAGNIFY_URL: magnifyUrl },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const messages: string[] = [];
    const toolCalls: any[] = [];
    let finalMessageText = '';  // Store the final text output

    piProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Log raw output
      console.log(`[Pi-Mono] ${agentName} stdout:`, text.trim());

      // Try to parse JSON output
      const lines = text.split('\n').filter((l: string) => l.trim());
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
        } catch {
          // Not JSON, ignore
        }
      }
    });

    piProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[Pi-Mono] ${agentName} stderr:`, text.trim());
    });

    // Timeout after 10 minutes
    const timeout = setTimeout(() => {
      piProcess.kill('SIGTERM');
      reject(new Error(`Agent ${agentName} timed out after 10 minutes`));
    }, 10 * 60 * 1000);

    piProcess.on('close', (code) => {
      clearTimeout(timeout);
      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`[Pi-Mono] <<< Agent ${agentName} completed in ${duration}ms with exit code ${code}`);

      if (code !== 0) {
        const errorMsg = `Agent exited with code ${code}: ${stderr}`;
        console.error(`[Pi-Mono] ${agentName} error:`, errorMsg);
        
        // Log to session logger
        const agentLog: AgentLog = {
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
        piSessionLogger.logAgent(agentLog);
        
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

      // First, try to extract JSON from markdown code blocks (use LAST match, not first)
      const jsonBlockMatches = textToParse.matchAll(/```json\s*([\s\S]*?)\s*```/g);
      const allMatches = Array.from(jsonBlockMatches);
      if (allMatches.length > 0) {
        // Use the LAST match (most recent output from agent)
        const lastMatch = allMatches[allMatches.length - 1];
        try {
          result = JSON.parse(lastMatch[1].trim());
          console.log(`[Pi-Mono] ${agentName} result (from markdown, match ${allMatches.length}/${allMatches.length}):`, JSON.stringify(result, null, 2));
        } catch (e) {
          console.error(`[Pi-Mono] ${agentName} failed to parse last JSON block:`, e);
        }
      }

      // If not found in markdown, try parsing each line from the end
      if (!result) {
        const lines = textToParse.trim().split('\n').filter((l: string) => l.trim());
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            result = JSON.parse(lines[i]);
            if (result && typeof result === 'object') {
              console.log(`[Pi-Mono] ${agentName} result (from line):`, JSON.stringify(result, null, 2));
              break;
            }
          } catch {
            continue;
          }
        }
      }

      // Log to session logger
      const agentLog: AgentLog = {
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
      piSessionLogger.logAgent(agentLog);

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
      const agentLog: AgentLog = {
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
      piSessionLogger.logAgent(agentLog);
      
      reject(error);
    });
  });
}

/**
 * Infer extraction type from query
 */
function inferExtractionType(query: string): 'summary' | 'entities' | 'full' | 'custom' {
  const q = query.toLowerCase();
  
  if (q.match(/^(what is|what are|who is|who are|when is|when was|where is|how is)/)) {
    return 'summary';
  }
  
  if (q.match(/(list|enumerate|identify|extract|find all|name all|show all)/)) {
    return 'entities';
  }
  
  if (q.match(/(explain|describe|detail|elaborate|how does|why does)/)) {
    return 'full';
  }
  
  return 'summary';
}

/**
 * Execute multi-agent query using pi-mono agents
 * Uses original query with appended context instead of rewriting
 */
async function executeMultiAgentQuery(
  documentId: string,
  query: string,
  magnifyUrl: string,
  extractionType?: 'summary' | 'entities' | 'full' | 'custom'
): Promise<any> {
  const startTime = Date.now();
  const inferredType = extractionType || inferExtractionType(query);

  // Start session logging
  const sessionId = piSessionLogger.startSession(documentId, query, inferredType);
  console.log(`[Pi-Mono] =================================`);
  console.log(`[Pi-Mono] Session: ${sessionId}`);
  console.log(`[Pi-Mono] Document: ${documentId}`);
  console.log(`[Pi-Mono] Query: ${query}`);
  console.log(`[Pi-Mono] Extraction Type: ${inferredType}`);
  console.log(`[Pi-Mono] Magnify URL: ${magnifyUrl}`);
  console.log(`[Pi-Mono] =================================\n`);

  try {
    // Step 1: Explorer - Find relevant sections
    // Append explorer-specific context to the original query
    console.log('[Pi-Mono] Step 1: Explorer agent...');
    const explorerTask = `${query}

Your task: Find the document sections most relevant to answering this question.
- Use the bash tool to call: curl -s "${magnifyUrl}/api/documents/${documentId}/groups"
- Match the query against group titles
- Return JSON with matchedGroups array`;
    
    const explorerResult = await spawnAgent('explorer', explorerTask, magnifyUrl, {
      documentId,
      query,
      magnifyUrl,
    });

    if (!explorerResult.result || !explorerResult.result.matchedGroups) {
      const errorMsg = `Explorer failed: ${explorerResult.error || 'No groups found'}\n` +
                      `Explorer stdout: ${explorerResult.output}\n` +
                      `Explorer stderr: ${explorerResult.stderr}`;
      throw new Error(errorMsg);
    }

    const matchedGroups = explorerResult.result.matchedGroups;
    console.log(`[Pi-Mono] Explorer found ${matchedGroups.length} groups`);

    // Step 2: Reader - Extract content from groups
    // Append reader-specific context to the original query
    console.log('[Pi-Mono] Step 2: Reader agent...');
    const readerTask = `${query}

Your task: Extract detailed information from the matched document sections to answer this question.
- Use the magnify API to query the matched groups
- Extraction type: ${inferredType}
- Return structured answer with sources`;
    
    const readerResult = await spawnAgent('reader', readerTask, magnifyUrl, {
      documentId,
      query,
      groups: matchedGroups,
      extractionType: inferredType,
      magnifyUrl,
    });

    if (!readerResult.result) {
      throw new Error(`Reader failed: ${readerResult.error || 'No content extracted'}`);
    }

    const endTime = Date.now();

    const result = {
      success: true,
      sessionId,
      documentId,
      query,
      extractionType: inferredType,
      answer: readerResult.result.answer || readerResult.result,
      sources: matchedGroups.map((g: any) => ({
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

    // End session logging
    piSessionLogger.endSession(result);

    console.log(`\n[Pi-Mono] =================================`);
    console.log(`[Pi-Mono] Session completed: ${sessionId}`);
    console.log(`[Pi-Mono] Total duration: ${result.duration}ms`);
    console.log(`[Pi-Mono] Logs saved to: logs/pi-sessions/${sessionId}.json`);
    console.log(`[Pi-Mono] =================================\n`);

    return result;
  } catch (error: any) {
    // End session with error
    piSessionLogger.endSession(null, error.message);
    throw error;
  }
}

/**
 * Create pi-mono agent routes
 */
export function createPiMonoRoutes(context: APIContext): Router {
  const router = Router();

  /**
   * POST /api/query-agents
   * Query document using pi-mono multi-agent pipeline
   */
  router.post('/query-agents', async (req: Request, res: Response) => {
    try {
      const { documentId, query, extractionType } = req.body;

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
      } catch {
        return res.status(503).json({
          error: 'Pi-mono not available',
          message: 'The "pi" command is not found in PATH. Install pi-mono first.',
          fallback: 'Use POST /api/query for native Magnify query (no multi-agent)',
        });
      }

      console.log(`[Pi-Mono] Starting multi-agent query for document ${documentId}`);
      const result = await executeMultiAgentQuery(
        documentId,
        query,
        magnifyUrl,
        extractionType
      );

      res.json(result);
    } catch (error: any) {
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
  router.post('/documents/:id/query-agents', async (req: Request, res: Response) => {
    try {
      const { id: documentId } = req.params;
      const { query, extractionType } = req.body;

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
      } catch {
        return res.status(503).json({
          error: 'Pi-mono not available',
          message: 'The "pi" command is not found in PATH. Install pi-mono first.',
          fallback: 'Use POST /api/documents/:id/query for native Magnify query',
        });
      }

      console.log(`[Pi-Mono] Starting multi-agent query for document ${documentId}`);
      const result = await executeMultiAgentQuery(
        documentId,
        query,
        magnifyUrl,
        extractionType
      );

      res.json(result);
    } catch (error: any) {
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
  router.get('/pi-sessions', async (req: Request, res: Response) => {
    try {
      const sessions = piSessionLogger.getAllSessions();
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
    } catch (error: any) {
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
  router.get('/pi-sessions/:id', async (req: Request, res: Response) => {
    try {
      const { id: sessionId } = req.params;
      const session = piSessionLogger.getSession(sessionId);
      
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          sessionId,
        });
      }

      res.json(session);
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to retrieve session',
        message: error.message,
      });
    }
  });

  return router;
}
