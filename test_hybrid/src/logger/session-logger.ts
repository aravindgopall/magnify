/**
 * Session Logger for Hybrid Search Agent
 * 
 * Captures complete session data including:
 * - User queries
 * - LLM prompts and responses
 * - Retrieval operations (dense, sparse, RRF)
 * - Subagent activities
 * - Final answers
 * - Timing information
 */

import fs from 'fs';
import path from 'path';

/**
 * A single search operation log entry
 */
export interface SearchLogEntry {
  timestamp: string;
  type: 'dense' | 'sparse' | 'hybrid' | 'rrf_fusion';
  query: string;
  results: Array<{
    chunkId: string;
    score: number;
    text?: string;
  }>;
  durationMs: number;
}

/**
 * LLM interaction log entry
 */
export interface LLMLogEntry {
  timestamp: string;
  phase: 'synthesis' | 'subagent_reasoning' | 'reranking';
  model: string;
  provider: string;
  prompt: {
    system?: string;
    user: string;
    context?: string;
  };
  response: {
    content: string;
    finishReason?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  durationMs: number;
}

/**
 * Subagent activity log
 */
export interface SubagentLogEntry {
  subagentId: string;
  startTime: string;
  endTime: string;
  status: 'running' | 'success' | 'failed';
  hops: Array<{
    hopNumber: number;
    query: string;
    decomposedQuery?: string;
    searchResults: SearchLogEntry[];
    chunksRetrieved: number;
    decision: 'continue' | 'terminate';
    reasoning?: string;
  }>;
  curatedChunks: Array<{
    chunkId: string;
    text: string;
    score: number;
  }>;
  totalDurationMs: number;
}

/**
 * Master fusion log entry
 */
export interface MasterFusionLogEntry {
  timestamp: string;
  inputLists: number;
  totalChunks: number;
  outputChunks: number;
  rrfK: number;
  topK: number;
  chunkScores: Array<{
    chunkId: string;
    rrfScore: number;
    agreementCount: number;
    sourceAgents: string[];
  }>;
  durationMs: number;
}

/**
 * Complete session log
 */
export interface SessionLog {
  sessionId: string;
  startTime: string;
  endTime: string;
  status: 'in_progress' | 'completed' | 'failed';
  
  // User input
  query: {
    text: string;
    options: Record<string, unknown>;
  };
  
  // Retrieval phase
  retrieval: {
    subagents: SubagentLogEntry[];
    masterFusion: MasterFusionLogEntry | null;
    totalDurationMs: number;
  };
  
  // LLM interactions
  llmInteractions: LLMLogEntry[];
  
  // Final output
  output: {
    answer: string;
    sources: Array<{
      chunkId: string;
      documentId: string;
      text: string;
      relevanceScore: number;
    }>;
    confidence: number;
  };
  
  // Metadata
  metadata: {
    totalChunks: number;
    relevantChunks: number;
    subagentCount: number;
    totalHops: number;
    totalProcessingTimeMs: number;
    embeddingModel: string;
    embeddingDimensions: number;
  };
  
  // Error if failed
  error?: {
    message: string;
    stack?: string;
    phase: string;
  };
}

/**
 * Session Logger Class
 */
export class SessionLogger {
  private sessionLog: SessionLog;
  private logDir: string;
  private currentSubagents: Map<string, SubagentLogEntry> = new Map();
  private llmInteractionStartTime: number | null = null;

  constructor(sessionId?: string, logDir?: string) {
    this.sessionLog = {
      sessionId: sessionId || this.generateSessionId(),
      startTime: new Date().toISOString(),
      endTime: '',
      status: 'in_progress',
      query: { text: '', options: {} },
      retrieval: {
        subagents: [],
        masterFusion: null,
        totalDurationMs: 0,
      },
      llmInteractions: [],
      output: {
        answer: '',
        sources: [],
        confidence: 0,
      },
      metadata: {
        totalChunks: 0,
        relevantChunks: 0,
        subagentCount: 0,
        totalHops: 0,
        totalProcessingTimeMs: 0,
        embeddingModel: '',
        embeddingDimensions: 0,
      },
    };
    this.logDir = logDir || './logs/sessions';
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log the user query
   */
  logQuery(query: string, options: Record<string, unknown>): void {
    this.sessionLog.query.text = query;
    this.sessionLog.query.options = options;
  }

  /**
   * Start a subagent execution
   */
  startSubagent(subagentId: string): void {
    const entry: SubagentLogEntry = {
      subagentId,
      startTime: new Date().toISOString(),
      endTime: '',
      status: 'running',
      hops: [],
      curatedChunks: [],
      totalDurationMs: 0,
    };
    this.currentSubagents.set(subagentId, entry);
  }

  /**
   * Log a subagent hop
   */
  logSubagentHop(
    subagentId: string,
    hop: {
      hopNumber: number;
      query: string;
      decomposedQuery?: string;
      searchResults: SearchLogEntry[];
      chunksRetrieved: number;
      decision: 'continue' | 'terminate';
      reasoning?: string;
    }
  ): void {
    const subagent = this.currentSubagents.get(subagentId);
    if (subagent) {
      subagent.hops.push(hop);
    }
  }

  /**
   * End a subagent execution
   */
  endSubagent(
    subagentId: string,
    status: 'success' | 'failed',
    curatedChunks: Array<{ chunkId: string; text: string; score: number }>
  ): void {
    const subagent = this.currentSubagents.get(subagentId);
    if (subagent) {
      subagent.endTime = new Date().toISOString();
      subagent.status = status;
      subagent.curatedChunks = curatedChunks;
      subagent.totalDurationMs = Date.now() - new Date(subagent.startTime).getTime();
      this.sessionLog.retrieval.subagents.push(subagent);
      this.currentSubagents.delete(subagentId);
    }
  }

  /**
   * Log master RRF fusion
   */
  logMasterFusion(entry: MasterFusionLogEntry): void {
    this.sessionLog.retrieval.masterFusion = entry;
    this.sessionLog.retrieval.totalDurationMs = entry.durationMs;
  }

  /**
   * Start an LLM interaction
   */
  startLLMInteraction(): void {
    this.llmInteractionStartTime = Date.now();
  }

  /**
   * Log an LLM interaction
   */
  logLLMInteraction(entry: Omit<LLMLogEntry, 'timestamp' | 'durationMs'>): void {
    this.sessionLog.llmInteractions.push({
      ...entry,
      timestamp: new Date().toISOString(),
      durationMs: this.llmInteractionStartTime ? Date.now() - this.llmInteractionStartTime : 0,
    });
    this.llmInteractionStartTime = null;
  }

  /**
   * Log the final answer
   */
  logOutput(
    answer: string,
    sources: Array<{ chunkId: string; documentId: string; text: string; relevanceScore: number }>,
    confidence: number
  ): void {
    this.sessionLog.output.answer = answer;
    this.sessionLog.output.sources = sources;
    this.sessionLog.output.confidence = confidence;
  }

  /**
   * Log metadata
   */
  logMetadata(metadata: Partial<SessionLog['metadata']>): void {
    Object.assign(this.sessionLog.metadata, metadata);
  }

  /**
   * Log an error
   */
  logError(error: Error, phase: string): void {
    this.sessionLog.status = 'failed';
    this.sessionLog.error = {
      message: error.message,
      stack: error.stack,
      phase,
    };
  }

  /**
   * Finalize and save the session log
   */
  finalize(): SessionLog {
    this.sessionLog.endTime = new Date().toISOString();
    this.sessionLog.status = this.sessionLog.status === 'failed' ? 'failed' : 'completed';
    return this.sessionLog;
  }

  /**
   * Save the session log to disk
   */
  async save(): Promise<string> {
    this.finalize();

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Write log file
    const filename = `session-${this.sessionLog.sessionId}.json`;
    const filepath = path.join(this.logDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(this.sessionLog, null, 2));
    
    return filepath;
  }

  /**
   * Get the current session log
   */
  getSessionLog(): SessionLog {
    return this.sessionLog;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionLog.sessionId;
  }
}

/**
 * Create a session logger
 */
export function createSessionLogger(sessionId?: string, logDir?: string): SessionLogger {
  return new SessionLogger(sessionId, logDir);
}