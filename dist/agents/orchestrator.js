"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOrchestrator = exports.DefaultAgentFactory = void 0;
exports.createOrchestrator = createOrchestrator;
const p_queue_1 = __importDefault(require("p-queue"));
const p_retry_1 = __importDefault(require("p-retry"));
class DefaultAgentFactory {
    createAgentFn;
    constructor(createAgentFn) {
        this.createAgentFn = createAgentFn;
    }
    createAgent(group, config) {
        return this.createAgentFn(group, config);
    }
}
exports.DefaultAgentFactory = DefaultAgentFactory;
class AgentOrchestrator {
    config;
    agentFactory;
    queue;
    constructor(config) {
        this.config = config;
        this.agentFactory = config.agentFactory;
        this.queue = new p_queue_1.default({
            concurrency: config.execution.maxConcurrency,
        });
    }
    setAgentFactory(factory) {
        this.agentFactory = factory;
    }
    async executeGroups(groups, agentConfigs) {
        const startTime = Date.now();
        const results = [];
        const errors = [];
        const tasks = groups.map(group => this.queue.add(() => this.executeGroup(group, agentConfigs?.get(group.id))));
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
            }
            else if (result.status === 'rejected') {
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
    async executeGroup(group, agentConfig) {
        if (!this.agentFactory) {
            throw new Error('Agent factory not configured');
        }
        const config = agentConfig || {
            id: `agent-${group.id}`,
            name: `Agent for ${group.title || group.id}`,
            maxRetries: this.config.execution.retryAttempts,
            timeout: this.config.execution.timeout,
        };
        const agent = this.agentFactory.createAgent(group, config);
        return (0, p_retry_1.default)(async () => {
            const result = await this.executeWithTimeout(agent, group, config.timeout || 60000);
            if (!result.success && !this.config.execution.continueOnError) {
                throw new Error(result.error || 'Agent execution failed');
            }
            return result;
        }, {
            retries: config.maxRetries || this.config.execution.retryAttempts,
            minTimeout: this.config.execution.retryDelay,
            onFailedAttempt: (error) => {
                console.warn(`Attempt ${error.attemptNumber} failed for group ${group.id}: ${error.message}`);
            },
        });
    }
    async executeWithTimeout(agent, group, timeout) {
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
    async executeSingle(group, agentConfig) {
        if (!this.agentFactory) {
            throw new Error('Agent factory not configured');
        }
        const config = agentConfig || {
            id: `agent-${group.id}`,
            name: `Agent for ${group.title || group.id}`,
            maxRetries: this.config.execution.retryAttempts,
            timeout: this.config.execution.timeout,
        };
        const agent = this.agentFactory.createAgent(group, config);
        return agent.execute(group);
    }
    getQueueStats() {
        return {
            pending: this.queue.pending,
            active: this.queue.size,
            size: this.queue.size + this.queue.pending,
        };
    }
    async drain() {
        await this.queue.onIdle();
    }
    clear() {
        this.queue.clear();
    }
}
exports.AgentOrchestrator = AgentOrchestrator;
function createOrchestrator(config) {
    return new AgentOrchestrator(config);
}
//# sourceMappingURL=orchestrator.js.map