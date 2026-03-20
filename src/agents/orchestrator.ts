import PQueue from 'p-queue';
import pRetry from 'p-retry';
import type {
  Subagent,
  SubagentConfig,
  SubagentResult,
  DocumentGroup,
  ExecutionConfig,
  PipelineError,
} from '../types/index.js';

export interface OrchestratorConfig {
  execution: ExecutionConfig;
  agentFactory?: AgentFactory;
}

export interface AgentFactory {
  createAgent(group: DocumentGroup, config?: SubagentConfig): Subagent;
}

export class DefaultAgentFactory implements AgentFactory {
  private createAgentFn: (group: DocumentGroup, config?: SubagentConfig) => Subagent;

  constructor(createAgentFn: (group: DocumentGroup, config?: SubagentConfig) => Subagent) {
    this.createAgentFn = createAgentFn;
  }

  createAgent(group: DocumentGroup, config?: SubagentConfig): Subagent {
    return this.createAgentFn(group, config);
  }
}

export interface OrchestratorResult {
  results: SubagentResult[];
  errors: PipelineError[];
  duration: number;
}

export class AgentOrchestrator {
  private config: OrchestratorConfig;
  private agentFactory?: AgentFactory;
  private queue: PQueue;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.agentFactory = config.agentFactory;
    this.queue = new PQueue({
      concurrency: config.execution.maxConcurrency,
    });
  }

  setAgentFactory(factory: AgentFactory): void {
    this.agentFactory = factory;
  }

  async executeGroups(
    groups: DocumentGroup[],
    agentConfigs?: Map<string, SubagentConfig>
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const results: SubagentResult[] = [];
    const errors: PipelineError[] = [];

    const tasks = groups.map(group => 
      this.queue.add(() => this.executeGroup(group, agentConfigs?.get(group.id)))
    );

    const settled = await Promise.allSettled(tasks);

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const group = groups[i];

      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
        if (!result.value.success) {
          errors.push({
            groupId: group.id,
            stage: 'extraction',
            message: result.value.error || 'Unknown error',
          });
        }
      } else if (result.status === 'rejected') {
        errors.push({
          groupId: group.id,
          stage: 'extraction',
          message: result.reason?.message || 'Unknown rejection',
          details: result.reason,
        });
      }
    }

    return {
      results,
      errors,
      duration: Date.now() - startTime,
    };
  }

  private async executeGroup(
    group: DocumentGroup,
    agentConfig?: SubagentConfig
  ): Promise<SubagentResult> {
    if (!this.agentFactory) {
      throw new Error('Agent factory not configured');
    }

    const config: SubagentConfig = agentConfig || {
      id: `agent-${group.id}`,
      name: `Agent for ${group.title || group.id}`,
      maxRetries: this.config.execution.retryAttempts,
      timeout: this.config.execution.timeout,
    };

    const agent = this.agentFactory.createAgent(group, config);

    return pRetry(
      async () => {
        const result = await this.executeWithTimeout(agent, group, config.timeout || 60000);
        
        if (!result.success && !this.config.execution.continueOnError) {
          throw new Error(result.error || 'Agent execution failed');
        }
        
        return result;
      },
      {
        retries: config.maxRetries || this.config.execution.retryAttempts,
        minTimeout: this.config.execution.retryDelay,
        onFailedAttempt: (error) => {
          console.warn(`Attempt ${error.attemptNumber} failed for group ${group.id}: ${error.message}`);
        },
      }
    );
  }

  private async executeWithTimeout(
    agent: Subagent,
    group: DocumentGroup,
    timeout: number
  ): Promise<SubagentResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent execution timed out after ${timeout}ms`));
      }, timeout);

      agent.execute(group)
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  async executeSingle(group: DocumentGroup, agentConfig?: SubagentConfig): Promise<SubagentResult> {
    if (!this.agentFactory) {
      throw new Error('Agent factory not configured');
    }

    const config: SubagentConfig = agentConfig || {
      id: `agent-${group.id}`,
      name: `Agent for ${group.title || group.id}`,
      maxRetries: this.config.execution.retryAttempts,
      timeout: this.config.execution.timeout,
    };

    const agent = this.agentFactory.createAgent(group, config);
    return agent.execute(group);
  }

  getQueueStats(): { pending: number; active: number; size: number } {
    return {
      pending: this.queue.pending,
      active: this.queue.size,
      size: this.queue.size + this.queue.pending,
    };
  }

  async drain(): Promise<void> {
    await this.queue.onIdle();
  }

  clear(): void {
    this.queue.clear();
  }
}

export function createOrchestrator(config: OrchestratorConfig): AgentOrchestrator {
  return new AgentOrchestrator(config);
}