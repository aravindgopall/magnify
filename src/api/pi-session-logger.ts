import fs from 'fs';
import path from 'path';

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

export class PiSessionLogger {
  private logsDir: string;
  private currentSession: PiSession | null = null;

  constructor() {
    // Create logs/pi-sessions directory relative to current working directory
    this.logsDir = path.join(process.cwd(), 'logs', 'pi-sessions');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Start a new pi-mono session
   */
  startSession(documentId: string, query: string, extractionType: string): string {
    const sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.currentSession = {
      sessionId,
      startTime: Date.now(),
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
  logAgent(log: AgentLog): void {
    if (!this.currentSession) {
      console.warn('[PiSessionLogger] No active session to log agent to');
      return;
    }

    this.currentSession.agents.push(log);
    this.saveSession();
  }

  /**
   * End the current session
   */
  endSession(result: any, error?: string): void {
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
   */
  private saveSession(): void {
    if (!this.currentSession) return;

    const filename = `${this.currentSession.sessionId}.json`;
    const filepath = path.join(this.logsDir, filename);

    try {
      fs.writeFileSync(filepath, JSON.stringify(this.currentSession, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PiSessionLogger] Failed to save session:', err);
    }
  }

  /**
   * Get all sessions
   */
  getAllSessions(): PiSession[] {
    try {
      const files = fs.readdirSync(this.logsDir).filter(f => f.endsWith('.json'));
      return files.map(f => {
        const content = fs.readFileSync(path.join(this.logsDir, f), 'utf-8');
        return JSON.parse(content);
      }).sort((a, b) => b.startTime - a.startTime);
    } catch (err) {
      console.error('[PiSessionLogger] Failed to read sessions:', err);
      return [];
    }
  }

  /**
   * Get a specific session
   */
  getSession(sessionId: string): PiSession | null {
    try {
      const filepath = path.join(this.logsDir, `${sessionId}.json`);
      if (!fs.existsSync(filepath)) return null;

      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      console.error('[PiSessionLogger] Failed to read session:', err);
      return null;
    }
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSession?.sessionId || null;
  }
}

// Singleton instance
export const piSessionLogger = new PiSessionLogger();
