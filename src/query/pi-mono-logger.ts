import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { QueryAgentConfig, QueryAgentResult, SubAgentResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the magnify root directory
const MAGNIFY_ROOT = path.resolve(__dirname, '../..');

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
export class PiMonoLogger {
  private llmCallsDir: string;
  private answersDir: string;
  private piMonoSessionsDir: string;
  private currentSessionId: string | null = null;

  constructor() {
    this.llmCallsDir = path.join(MAGNIFY_ROOT, 'logs', 'pi-llm-calls');
    this.answersDir = path.join(MAGNIFY_ROOT, 'logs', 'pi-answers');
    this.piMonoSessionsDir = path.join(MAGNIFY_ROOT, 'logs', 'pi-mono-sessions');
    
    this.ensureDirectories();
  }

  /**
   * Ensure all log directories exist
   */
  private ensureDirectories(): void {
    for (const dir of [this.llmCallsDir, this.answersDir, this.piMonoSessionsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[PiMonoLogger] Created directory: ${dir}`);
      }
    }
  }

  /**
   * Start a new query session
   */
  startSession(query: string, documentId: string): string {
    this.currentSessionId = `${Date.now()}-${this.generateId()}`;
    console.log(`[PiMonoLogger] Started session: ${this.currentSessionId}`);
    return this.currentSessionId;
  }

  /**
   * Log an LLM call (request + response)
   */
  async logLLMCall(
    agentType: 'sub-agent' | 'main-agent',
    systemPrompt: string,
    userPrompt: string,
    agentState: any,
    durationMs: number,
    groupId?: string,
    groupTitle?: string
  ): Promise<string> {
    const callId = `${Date.now()}-${this.generateId()}`;
    
    // Ensure directory exists before writing (handles race conditions)
    await fs.promises.mkdir(this.llmCallsDir, { recursive: true });
    
    // Extract response content from agent state
    const messages = agentState.messages || [];
    const lastMessage = messages[messages.length - 1];
    const responseContent = this.extractMessageContent(lastMessage);
    
    // Simplified LLM call log - just the conversation
    const llmLog: LLMCallLog = {
      callId,
      timestamp: new Date().toISOString(),
      agentType,
      groupId,
      groupTitle,
      systemPrompt,
      userPrompt,
      response: responseContent,
    };

    const llmPath = path.join(this.llmCallsDir, `${callId}.json`);
    await fs.promises.writeFile(llmPath, JSON.stringify(llmLog, null, 2), 'utf-8');
    
    // Save full pi-mono agent state separately
    await this.savePiMonoAgentState(callId, agentType, agentState, groupId, groupTitle);
    
    console.log(`[PiMonoLogger] Logged LLM call: ${callId} (${agentType})`);
    return callId;
  }



  /**
   * Save the final query answer (simplified)
   */
  async saveQueryAnswer(
    config: QueryAgentConfig,
    result: QueryAgentResult,
    totalDurationMs: number,
    mainAgentLLMCallId?: string,
    mainAgentDurationMs?: number
  ): Promise<void> {
    if (!this.currentSessionId) {
      console.error('[PiMonoLogger] No active session to save');
      return;
    }

    const sessionId = this.currentSessionId;
    
    // Ensure directory exists before writing (handles race conditions)
    await fs.promises.mkdir(this.answersDir, { recursive: true });
    
    // Simplified answer log - just the essentials
    const answerLog: QueryAnswerLog = {
      query: config.query,
      documentId: config.documentId,
      extractionType: config.extractionType,
      answer: result.answer,
    };

    const answerPath = path.join(this.answersDir, `${sessionId}.json`);
    await fs.promises.writeFile(answerPath, JSON.stringify(answerLog, null, 2), 'utf-8');

    console.log(`[PiMonoLogger] Saved query answer: ${sessionId}`);
    console.log(`[PiMonoLogger]   Answer: ${answerPath}`);

    // Reset session
    this.currentSessionId = null;
  }

  /**
   * Extract text content from a message
   */
  private extractMessageContent(message: any): string {
    if (!message) return '';
    
    if (typeof message.content === 'string') {
      return message.content;
    }
    
    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text' || c.type === 'thinking')
        .map((c: any) => c.text || c.thinking || '')
        .filter(Boolean)
        .join('\n');
    }
    
    if (typeof message.content === 'object' && message.content !== null) {
      return message.content.text || message.content.thinking || '';
    }
    
    return '';
  }

  /**
   * Save pi-mono Agent state as a separate session log
   */
  private async savePiMonoAgentState(
    callId: string,
    agentType: string,
    agentState: any,
    groupId?: string,
    groupTitle?: string
  ): Promise<void> {
    // Ensure directory exists before writing (handles race conditions)
    await fs.promises.mkdir(this.piMonoSessionsDir, { recursive: true });
    
    // Filter streaming data and store clean agent state
    const cleanState = {
      callId,
      agentType,
      groupId,
      groupTitle,
      timestamp: new Date().toISOString(),
      state: {
        systemPrompt: agentState.systemPrompt,
        model: agentState.model,
        messages: this.filterStreamingLogs(agentState.messages || []),
        thinkingLevel: agentState.thinkingLevel,
        tools: agentState.tools || [],
        history: agentState.history || [],
      },
    };

    const filePath = path.join(this.piMonoSessionsDir, `${callId}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(cleanState, null, 2), 'utf-8');
  }

  /**
   * Filter out streaming/token-wise logs from pi-mono
   * Pi-mono streams events as JSONL with:
   * - turn_start/turn_end
   * - message_start/message_update/message_end
   * - tool_execution_start/tool_execution_update/tool_execution_end
   * We only keep complete messages (message_end, turn_end)
   */
  private filterStreamingLogs(messages: any[]): any[] {
    if (!Array.isArray(messages)) return [];
    
    //Track final complete messages only
    const finalMessages: any[] = [];
    
    for (const msg of messages) {
      if (!msg || !msg.role) continue;
      
      // For assistant messages, only keep if they're complete (not partial/streaming)
      if (msg.role === 'assistant') {
        // Skip streaming indicators
        if (msg.streaming === true || msg.partial === true) {
          continue;
        }
        
        // Skip delta updates
        if ('delta' in msg || 'contentDelta' in msg) {
          continue;
        }
        
        // For content arrays, check for partial toolCall indicators
        if (Array.isArray(msg.content)) {
          const hasPartialToolCall = msg.content.some((c: any) => 
            c.type === 'toolCall' && c.partialArgs
          );
          if (hasPartialToolCall) {
            continue;
          }
        }
        
        // Keep complete assistant messages
        finalMessages.push(this.cleanMessage(msg));
      } else {
        // Keep user, system, and toolResult messages
        finalMessages.push(this.cleanMessage(msg));
      }
    }
    
    return finalMessages;
  }
  
  /**
   * Remove streaming metadata from message
   */
  private cleanMessage(msg: any): any {
    const { streaming, partial, delta, contentDelta, partialArgs, ...cleanMsg } = msg as any;
    
    // Clean content array if present
    if (Array.isArray(cleanMsg.content)) {
      cleanMsg.content = cleanMsg.content.map((c: any) => {
        const { partialArgs, ...cleanContent } = c;
        return cleanContent;
      });
    }
    
    return cleanMsg;
  }

  /**
   * Generate a short random ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 11);
  }

  /**
   * Load a query answer by session ID
   */
  async loadQueryAnswer(sessionId: string): Promise<QueryAnswerLog | null> {
    const filePath = path.join(this.answersDir, `${sessionId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as QueryAnswerLog;
    } catch (error) {
      console.error(`[PiMonoLogger] Error loading answer ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Load an LLM call log
   */
  async loadLLMCall(callId: string): Promise<LLMCallLog | null> {
    const filePath = path.join(this.llmCallsDir, `${callId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as LLMCallLog;
    } catch (error) {
      console.error(`[PiMonoLogger] Error loading LLM call ${callId}:`, error);
      return null;
    }
  }

  /**
   * List recent query answers
   */
  async listRecentAnswers(limit: number = 20): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.answersDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.basename(file, '.json'))
        .sort((a, b) => b.localeCompare(a))
        .slice(0, limit);
    } catch (error) {
      console.error('[PiMonoLogger] Error listing answers:', error);
      return [];
    }
  }
}

// Singleton instance
let loggerInstance: PiMonoLogger | null = null;

export function getPiMonoLogger(): PiMonoLogger {
  if (!loggerInstance) {
    loggerInstance = new PiMonoLogger();
  }
  return loggerInstance;
}
