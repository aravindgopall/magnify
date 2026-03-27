import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { v4 as uuidv4 } from 'uuid';
import { createParser } from '../parser/index.js';
import { MainAgent, LLMExtractionAgent } from '../llm/index.js';
import { OutputMerger, OutputFormatter } from '../output/index.js';
export class LLMPipeline {
    config;
    parser;
    mainAgent;
    llmClient;
    merger;
    formatter;
    hooks;
    queue;
    constructor(config, hooks) {
        this.config = config;
        this.parser = createParser();
        this.llmClient = config.llmClient;
        this.mainAgent = new MainAgent(this.llmClient);
        this.merger = new OutputMerger();
        this.formatter = new OutputFormatter();
        this.hooks = hooks || {};
        this.queue = new PQueue({
            concurrency: config.execution?.maxConcurrency || 4,
        });
    }
    async execute(source) {
        const errors = [];
        const startTime = Date.now();
        let document;
        try {
            await this.hooks.onParseStart?.(source);
            document = await this.parser.parse(source);
            await this.hooks.onParseComplete?.(document);
        }
        catch (error) {
            errors.push({
                stage: 'parsing',
                message: error instanceof Error ? error.message : 'Unknown parsing error',
            });
            return this.createFailedResult(errors, startTime);
        }
        let groups;
        let documentType = 'unknown';
        try {
            await this.hooks.onAnalysisStart?.(document);
            if (this.config.groupingStrategy === 'fixed') {
                groups = this.createFixedGroups(document);
            }
            else {
                groups = await this.mainAgent.identifyGroups(document, this.config.groupingStrategy);
            }
            documentType = groups[0]?.metadata?.documentType || 'unknown';
            await this.hooks.onAnalysisComplete?.(groups, documentType);
        }
        catch (error) {
            errors.push({
                stage: 'grouping',
                message: error instanceof Error ? error.message : 'Unknown grouping error',
            });
            return this.createFailedResult(errors, startTime, document);
        }
        let results;
        try {
            await this.hooks.onExtractionStart?.(groups);
            results = await this.executeExtraction(groups);
            await this.hooks.onExtractionComplete?.(results);
        }
        catch (error) {
            errors.push({
                stage: 'extraction',
                message: error instanceof Error ? error.message : 'Unknown extraction error',
            });
            return this.createFailedResult(errors, startTime, document, groups);
        }
        let mergedOutput;
        try {
            await this.hooks.onMergeStart?.(results);
            mergedOutput = this.merger.merge(results);
            await this.hooks.onMergeComplete?.(mergedOutput);
        }
        catch (error) {
            errors.push({
                stage: 'merging',
                message: error instanceof Error ? error.message : 'Unknown merging error',
            });
            return this.createFailedResult(errors, startTime, document, groups, results);
        }
        const groupResults = this.merger.toGroupResults(results);
        const statistics = this.calculateStatistics(document, groups, results, startTime);
        const extractionErrors = results
            .filter(r => !r.success)
            .map(r => ({
            groupId: r.groupId,
            stage: 'extraction',
            message: r.error || 'Unknown error',
        }));
        errors.push(...extractionErrors);
        for (const error of errors) {
            await this.hooks.onError?.(error);
        }
        return {
            documentId: document.id,
            status: this.determineStatus(results, errors),
            groups: groupResults,
            mergedOutput,
            statistics,
            errors,
        };
    }
    createFixedGroups(document) {
        const pagesPerGroup = 10;
        const groups = [];
        const pages = document.pages;
        for (let i = 0; i < pages.length; i += pagesPerGroup) {
            const groupPages = pages.slice(i, Math.min(i + pagesPerGroup, pages.length));
            const startPage = i + 1;
            const endPage = Math.min(i + pagesPerGroup, pages.length);
            groups.push({
                id: uuidv4(),
                type: 'fixed',
                title: `Pages ${startPage}-${endPage}`,
                startPage,
                endPage,
                pages: groupPages,
                metadata: {
                    groupIndex: Math.floor(i / pagesPerGroup),
                },
            });
        }
        return groups;
    }
    async executeExtraction(groups) {
        const results = [];
        let completed = 0;
        const maxRetries = this.config.execution?.retryAttempts || 3;
        const timeout = this.config.execution?.timeout || 60000;
        const tasks = groups.map(async (group) => {
            return pRetry(async () => {
                const agent = new LLMExtractionAgent(this.llmClient, {
                    agentId: `subagent-${group.id}`,
                    customPrompt: this.config.extractionPrompt,
                    extractionSchema: this.config.extractionSchema,
                });
                const result = await this.executeWithTimeout(agent, group, timeout);
                if (!result.success && !this.config.execution?.continueOnError) {
                    throw new Error(result.error || 'Extraction failed');
                }
                completed++;
                await this.hooks.onExtractionProgress?.(completed, groups.length, group.id);
                return result;
            }, {
                retries: maxRetries,
                minTimeout: this.config.execution?.retryDelay || 1000,
            });
        });
        const settled = await Promise.allSettled(tasks);
        for (const result of settled) {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            }
            else {
                results.push({
                    agentId: 'unknown',
                    groupId: 'unknown',
                    success: false,
                    error: result.reason?.message || 'Unknown rejection',
                    duration: 0,
                });
            }
        }
        return results;
    }
    async executeWithTimeout(agent, group, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Extraction timed out after ${timeout}ms`));
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
    calculateStatistics(document, groups, results, startTime) {
        const successfulGroups = results.filter(r => r.success).length;
        const failedGroups = results.filter(r => !r.success).length;
        const totalDuration = Date.now() - startTime;
        const averageGroupDuration = results.length > 0
            ? results.reduce((sum, r) => sum + r.duration, 0) / results.length
            : 0;
        return {
            totalPages: document.metadata.pageCount,
            totalGroups: groups.length,
            successfulGroups,
            failedGroups,
            totalDuration,
            averageGroupDuration,
            totalTokensUsed: results.reduce((sum, r) => sum + (r.tokensUsed || 0), 0),
        };
    }
    determineStatus(results, errors) {
        if (errors.length === 0)
            return 'success';
        const successCount = results.filter(r => r.success).length;
        if (successCount === 0)
            return 'failed';
        if (successCount < results.length)
            return 'partial';
        return 'success';
    }
    createFailedResult(errors, startTime, document, groups, results) {
        return {
            documentId: document?.id || 'unknown',
            status: 'failed',
            groups: results ? this.merger.toGroupResults(results) : [],
            mergedOutput: {
                sections: [],
                entities: [],
                tables: [],
                metadata: {},
            },
            statistics: {
                totalPages: document?.metadata.pageCount || 0,
                totalGroups: groups?.length || 0,
                successfulGroups: 0,
                failedGroups: groups?.length || 0,
                totalDuration: Date.now() - startTime,
                averageGroupDuration: 0,
                totalTokensUsed: 0,
            },
            errors,
        };
    }
    formatOutput(result) {
        return this.formatter.format(result.mergedOutput, {
            format: this.config.output?.format || 'json',
            includeMetadata: this.config.output?.includeMetadata ?? true,
            includeSourcePages: this.config.output?.includeSourcePages ?? false,
            prettyPrint: this.config.output?.prettyPrint ?? true,
        });
    }
}
export function createLLMPipeline(config, hooks) {
    return new LLMPipeline(config, hooks);
}
//# sourceMappingURL=llm-pipeline.js.map