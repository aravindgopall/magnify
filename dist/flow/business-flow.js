"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessFlow = void 0;
exports.createBusinessFlow = createBusinessFlow;
const uuid_1 = require("uuid");
const llm_pipeline_js_1 = require("../pipeline/llm-pipeline.js");
const index_js_1 = require("../output/index.js");
const PRESET_CONFIGS = {
    document: {
        name: 'document',
        groupingStrategy: 'hybrid',
    },
    report: {
        name: 'report',
        groupingStrategy: 'heading',
        extractionPrompt: 'Extract key findings, metrics, and recommendations from this report section.',
    },
    invoice: {
        name: 'invoice',
        groupingStrategy: 'fixed',
        extractionPrompt: 'Extract invoice details: vendor, amounts, line items, dates, and payment terms.',
    },
    research: {
        name: 'research',
        groupingStrategy: 'heading',
        extractionPrompt: 'Extract research methodology, findings, data points, and citations.',
    },
    book: {
        name: 'book',
        groupingStrategy: 'toc',
        extractionPrompt: 'Extract chapter content, key concepts, and important passages.',
    },
    manual: {
        name: 'manual',
        groupingStrategy: 'heading',
        extractionPrompt: 'Extract procedures, steps, warnings, and technical specifications.',
    },
};
class BusinessFlow {
    llmClient;
    executions = new Map();
    batchJobs = new Map();
    constructor(llmClient) {
        this.llmClient = llmClient;
    }
    createFlow(name, config) {
        return {
            name,
            groupingStrategy: 'hybrid',
            ...config,
        };
    }
    createFlowFromPreset(preset, overrides) {
        const presetConfig = PRESET_CONFIGS[preset];
        return {
            ...presetConfig,
            ...overrides,
        };
    }
    async execute(source, flow) {
        const execution = {
            id: (0, uuid_1.v4)(),
            flowName: flow.name,
            status: 'running',
            startTime: new Date(),
        };
        this.executions.set(execution.id, execution);
        try {
            const pipeline = new llm_pipeline_js_1.LLMPipeline({
                llmClient: this.llmClient,
                groupingStrategy: flow.groupingStrategy,
                extractionPrompt: flow.extractionPrompt,
            });
            const result = await pipeline.execute(source);
            execution.status = result.status === 'failed' ? 'failed' : 'completed';
            execution.endTime = new Date();
            execution.result = result;
            return execution;
        }
        catch (error) {
            execution.status = 'failed';
            execution.endTime = new Date();
            execution.error = error instanceof Error ? error.message : 'Unknown error';
            return execution;
        }
    }
    async executeBatch(sources, flow, options) {
        const job = {
            id: (0, uuid_1.v4)(),
            sources,
            config: flow,
            executions: [],
            status: 'pending',
        };
        this.batchJobs.set(job.id, job);
        job.status = 'running';
        job.startTime = new Date();
        const concurrency = options?.concurrency || 2;
        const queue = [];
        for (const source of sources) {
            queue.push(async () => {
                const execution = await this.execute(source, flow);
                job.executions.push(execution);
            });
        }
        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(this.processQueue(queue));
        }
        await Promise.all(workers);
        job.endTime = new Date();
        job.status = this.determineBatchStatus(job.executions);
        return job;
    }
    async processQueue(queue) {
        while (queue.length > 0) {
            const task = queue.shift();
            if (task) {
                await task();
            }
        }
    }
    determineBatchStatus(executions) {
        const completed = executions.filter(e => e.status === 'completed').length;
        const failed = executions.filter(e => e.status === 'failed').length;
        if (failed === 0)
            return 'completed';
        if (completed === 0)
            return 'failed';
        return 'partial';
    }
    getExecution(id) {
        return this.executions.get(id);
    }
    getBatchJob(id) {
        return this.batchJobs.get(id);
    }
    listExecutions() {
        return Array.from(this.executions.values());
    }
    listBatchJobs() {
        return Array.from(this.batchJobs.values());
    }
    async exportResult(result, format) {
        const formatter = new index_js_1.OutputFormatter();
        return formatter.format(result.mergedOutput, {
            format,
            includeMetadata: true,
            includeSourcePages: false,
            prettyPrint: true,
        });
    }
    async exportBatchResults(jobId, format) {
        const job = this.batchJobs.get(jobId);
        if (!job) {
            throw new Error(`Batch job ${jobId} not found`);
        }
        const formatter = new index_js_1.OutputFormatter();
        return job.executions
            .filter(e => e.result)
            .map(e => ({
            executionId: e.id,
            output: formatter.format(e.result.mergedOutput, {
                format,
                includeMetadata: true,
                includeSourcePages: false,
                prettyPrint: true,
            }),
        }));
    }
}
exports.BusinessFlow = BusinessFlow;
function createBusinessFlow(llmClient) {
    return new BusinessFlow(llmClient);
}
//# sourceMappingURL=business-flow.js.map