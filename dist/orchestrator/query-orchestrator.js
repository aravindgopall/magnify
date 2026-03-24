"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryOrchestrator = void 0;
exports.createQueryOrchestrator = createQueryOrchestrator;
const uuid_1 = require("uuid");
const query_log_js_1 = require("../store/query-log.js");
class QueryOrchestrator {
    llmClient;
    documentStore;
    maxConcurrentRequests = 3; // Limit to avoid rate limiting
    queryLogPersistence;
    constructor(llmClient, documentStore) {
        this.llmClient = llmClient;
        this.documentStore = documentStore;
        this.queryLogPersistence = (0, query_log_js_1.createQueryLogPersistence)();
    }
    /**
     * Process items in batches to avoid rate limiting
     */
    async processInBatches(items, processor) {
        const results = [];
        for (let i = 0; i < items.length; i += this.maxConcurrentRequests) {
            const batch = items.slice(i, i + this.maxConcurrentRequests);
            const batchResults = await Promise.all(batch.map(processor));
            results.push(...batchResults);
        }
        return results;
    }
    /**
     * Log LLM call before making it
     */
    logLLMCall(agentType, messages, groupId) {
        const startTime = Date.now();
        const log = {
            agentType,
            groupId,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            timestamp: new Date().toISOString(),
        };
        console.log(`\n========== LLM CALL START [${agentType}${groupId ? ` | Group: ${groupId}` : ''}] ==========`);
        console.log(`Timestamp: ${log.timestamp}`);
        console.log('Messages:');
        messages.forEach((m, i) => {
            console.log(`  [${i}] ${m.role.toUpperCase()}: ${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}`);
        });
        console.log('============================================================\n');
        return { log, startTime };
    }
    /**
     * Complete LLM call log after response
     */
    completeLLMCall(log, startTime, response, error) {
        log.durationMs = Date.now() - startTime;
        log.response = response;
        log.error = error;
        console.log(`\n========== LLM CALL END [${log.agentType}${log.groupId ? ` | Group: ${log.groupId}` : ''}] ==========`);
        console.log(`Duration: ${log.durationMs}ms`);
        if (error) {
            console.log(`Error: ${error}`);
        }
        else {
            console.log(`Response: ${JSON.stringify(response).substring(0, 500)}...`);
        }
        console.log('============================================================\n');
        return log;
    }
    async execute(request) {
        const startTime = Date.now();
        const queryId = (0, uuid_1.v4)();
        const llmCalls = [];
        const stored = this.documentStore.get(request.documentId);
        if (!stored) {
            throw new Error(`Document ${request.documentId} not found`);
        }
        // Build document context
        const documentContext = {
            title: stored.document.metadata.title,
            documentType: stored.metadata.documentType,
            totalGroups: stored.groups.length,
            totalPageCount: stored.document.pages.length,
        };
        // Track routing timing
        const routingStartTime = Date.now();
        const routingResult = await this.identifyRelevantGroups(stored, request.query, request.groupIds, llmCalls);
        const routingDurationMs = Date.now() - routingStartTime;
        // Track subagent timing
        const subagentStartTime = Date.now();
        const subagentResults = await this.processInBatches(routingResult.selectedGroups, group => this.executeSubagent(group, request.query, request.extractionType, request.customPrompt, llmCalls));
        const subagentDurationMs = Date.now() - subagentStartTime;
        // Track merge timing
        const mergeStartTime = Date.now();
        const mergeResult = await this.mergeResults(request.query, subagentResults, stored, llmCalls);
        const mergeDurationMs = Date.now() - mergeStartTime;
        const totalTokens = subagentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
        const totalDurationMs = Date.now() - startTime;
        // Build and save query log
        const queryLog = {
            queryId,
            documentId: request.documentId,
            timestamp: new Date(),
            query: request.query,
            extractionType: request.extractionType,
            customPrompt: request.customPrompt,
            documentContext,
            routing: {
                requestedGroupIds: request.groupIds,
                selectedGroupIds: routingResult.selectedGroups.map((g) => g.id),
                selectedGroups: routingResult.selectedGroups.map((g) => ({
                    id: g.id,
                    title: g.title,
                    startPage: g.startPage,
                    endPage: g.endPage,
                })),
                reasoning: routingResult.reasoning,
                durationMs: routingDurationMs,
                llmCall: routingResult.llmCall,
            },
            subagentResults: subagentResults.map(r => ({
                groupId: r.groupId,
                groupTitle: r.groupTitle,
                startPage: r.startPage,
                endPage: r.endPage,
                answer: r.answer,
                entities: r.entities,
                relevantExcerpt: r.excerpt,
                tokensUsed: r.tokensUsed,
                durationMs: r.durationMs,
                llmCall: r.llmCall,
            })),
            mergeResult: {
                type: subagentResults.length === 0 ? 'none' : subagentResults.length === 1 ? 'single' : 'synthesis',
                reasoning: subagentResults.length > 1 ? 'Multiple sections synthesized into comprehensive answer' : undefined,
                durationMs: mergeDurationMs,
                llmCall: mergeResult.llmCall,
            },
            finalResult: {
                answer: mergeResult.result.answer,
                sources: mergeResult.result.sources,
                entities: mergeResult.result.entities || [],
                confidence: mergeResult.result.confidence,
            },
            performance: {
                totalDurationMs,
                routingDurationMs,
                subagentDurationMs,
                mergeDurationMs,
                totalTokensUsed: totalTokens,
            },
            llmCalls,
        };
        // Save log asynchronously (don't wait for it)
        this.queryLogPersistence.saveLog(queryLog).catch(err => {
            console.error(`Failed to save query log ${queryId}:`, err);
        });
        return {
            queryId,
            documentId: request.documentId,
            result: mergeResult.result,
            groupsProcessed: routingResult.selectedGroups.map((g) => g.id),
            duration: totalDurationMs,
            tokensUsed: totalTokens,
        };
    }
    async identifyRelevantGroups(stored, query, specificGroupIds, llmCalls) {
        if (specificGroupIds && specificGroupIds.length > 0) {
            const selectedGroups = stored.groups.filter(g => specificGroupIds.includes(g.id));
            return {
                selectedGroups,
                reasoning: `User explicitly requested groups: ${specificGroupIds.join(', ')}`,
            };
        }
        const messages = [
            {
                role: 'system',
                content: `You are a document routing agent. Given a query and a list of document sections, identify which sections are most relevant to answer the query.

Respond with a JSON object containing:
{
  "relevantGroupIds": ["id1", "id2", ...],
  "reasoning": "Brief explanation of why these sections were selected"
}

Select only sections that contain information relevant to the query. If unsure, include the section.`,
            },
            {
                role: 'user',
                content: `Document: ${stored.document.metadata.title || 'Untitled'}
Document Type: ${stored.metadata.documentType || 'Unknown'}

Available Sections:
${stored.groups.map(g => `- ID: ${g.id}
  Title: ${g.title || `Pages ${g.startPage}-${g.endPage}`}
  Pages: ${g.startPage}-${g.endPage}`).join('\n')}

Query: ${query}

Which sections are relevant to this query?`,
            },
        ];
        // Log before LLM call
        const { log, startTime } = this.logLLMCall('router', messages);
        try {
            const response = await this.llmClient.completeWithJSON(messages);
            // Complete the log
            this.completeLLMCall(log, startTime, response);
            llmCalls?.push(log);
            const relevantIds = new Set(response.relevantGroupIds);
            const selectedGroups = stored.groups.filter(g => relevantIds.has(g.id));
            return {
                selectedGroups,
                reasoning: response.reasoning,
                llmCall: log,
            };
        }
        catch (error) {
            this.completeLLMCall(log, startTime, undefined, error instanceof Error ? error.message : String(error));
            llmCalls?.push(log);
            throw error;
        }
    }
    async executeSubagent(group, query, extractionType, customPrompt, llmCalls) {
        const startTime = Date.now();
        const content = group.pages.map(p => p.text).join('\n\n');
        const systemPrompt = this.getSystemPrompt(extractionType, customPrompt);
        const messages = [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: `Section: ${group.title || `Pages ${group.startPage}-${group.endPage}`}
Pages: ${group.startPage} to ${group.endPage}

Content:
${content.substring(0, 8000)}${content.length > 8000 ? '...' : ''}

Query: ${query}`,
            },
        ];
        // Log before LLM call
        const { log, startTime: llmStartTime } = this.logLLMCall('extraction', messages, group.id);
        try {
            const response = await this.llmClient.completeWithJSON(messages);
            const durationMs = Date.now() - startTime;
            // Complete the log
            this.completeLLMCall(log, llmStartTime, response);
            llmCalls?.push(log);
            return {
                groupId: group.id,
                groupTitle: group.title,
                startPage: group.startPage,
                endPage: group.endPage,
                answer: response.answer,
                entities: response.entities || [],
                excerpt: response.relevantExcerpt || '',
                tokensUsed: 0, // TODO: Get actual token count from LLM response
                durationMs,
                llmCall: log,
            };
        }
        catch (error) {
            const durationMs = Date.now() - startTime;
            this.completeLLMCall(log, llmStartTime, undefined, error instanceof Error ? error.message : String(error));
            llmCalls?.push(log);
            return {
                groupId: group.id,
                groupTitle: group.title,
                startPage: group.startPage,
                endPage: group.endPage,
                answer: `Error processing section: ${error instanceof Error ? error.message : String(error)}`,
                entities: [],
                excerpt: '',
                tokensUsed: 0,
                durationMs,
                llmCall: log,
            };
        }
    }
    getSystemPrompt(extractionType, customPrompt) {
        if (customPrompt) {
            return customPrompt;
        }
        switch (extractionType) {
            case 'summary':
                return `You are a document analysis agent. Provide a concise summary relevant to the query.
Respond with JSON: { "answer": "summary text", "entities": [], "relevantExcerpt": "key quote" }`;
            case 'entities':
                return `You are an entity extraction agent. Extract all relevant entities mentioned in the context of the query.
Respond with JSON: { "answer": "brief context", "entities": [{"type": "person|org|date|money|etc", "name": "value", "confidence": 0.0-1.0}], "relevantExcerpt": "quote" }`;
            case 'full':
                return `You are a comprehensive document analysis agent. Provide detailed answers with all relevant information.
Respond with JSON: { "answer": "detailed answer", "entities": [...], "relevantExcerpt": "key quote" }`;
            default:
                return `You are a document query agent. Answer the query based on the provided document section.
Be accurate and only use information from the provided content.
Respond with JSON: { "answer": "your answer", "entities": [{"type": "type", "name": "value", "confidence": 0.0-1.0}], "relevantExcerpt": "relevant quote from content" }`;
        }
    }
    async mergeResults(query, subagentResults, stored, llmCalls) {
        if (subagentResults.length === 0) {
            return {
                result: {
                    answer: 'No relevant information found in the document.',
                    sources: [],
                    confidence: 0,
                },
            };
        }
        if (subagentResults.length === 1) {
            const result = subagentResults[0];
            const group = stored.groups.find(g => g.id === result.groupId);
            return {
                result: {
                    answer: result.answer,
                    sources: [{
                            groupId: result.groupId,
                            groupTitle: group?.title,
                            startPage: group?.startPage || 1,
                            endPage: group?.endPage || 1,
                            relevantExcerpt: result.excerpt,
                        }],
                    entities: result.entities,
                    confidence: 0.8,
                },
                llmCall: result.llmCall,
            };
        }
        const messages = [
            {
                role: 'system',
                content: `You are a synthesis agent. Combine multiple partial answers into a coherent, comprehensive response.
Maintain accuracy and cite sources. Remove redundancy while preserving all unique information.
Respond with JSON: { "answer": "synthesized answer", "confidence": 0.0-1.0 }`,
            },
            {
                role: 'user',
                content: `Original Query: ${query}

Partial Answers from Document Sections:
${subagentResults.map((r, i) => `--- Section ${i + 1} (${r.groupId}) ---\n${r.answer}`).join('\n\n')}

Synthesize these into a comprehensive answer:`,
            },
        ];
        // Log before LLM call
        const { log, startTime } = this.logLLMCall('synthesis', messages);
        try {
            const merged = await this.llmClient.completeWithJSON(messages);
            // Complete the log
            this.completeLLMCall(log, startTime, merged);
            llmCalls?.push(log);
            const allEntities = [];
            const entityMap = new Map();
            for (const result of subagentResults) {
                for (const entity of result.entities) {
                    const key = `${entity.type}:${entity.name}`;
                    if (!entityMap.has(key) || entity.confidence > (entityMap.get(key)?.confidence || 0)) {
                        entityMap.set(key, entity);
                    }
                }
            }
            allEntities.push(...entityMap.values());
            const sources = subagentResults.map(r => {
                const group = stored.groups.find(g => g.id === r.groupId);
                return {
                    groupId: r.groupId,
                    groupTitle: group?.title,
                    startPage: group?.startPage || 1,
                    endPage: group?.endPage || 1,
                    relevantExcerpt: r.excerpt,
                };
            });
            return {
                result: {
                    answer: merged.answer,
                    sources,
                    entities: allEntities,
                    confidence: merged.confidence,
                },
                llmCall: log,
            };
        }
        catch (error) {
            this.completeLLMCall(log, startTime, undefined, error instanceof Error ? error.message : String(error));
            llmCalls?.push(log);
            throw error;
        }
    }
    /**
     * Get the query log persistence instance
     */
    getQueryLogPersistence() {
        return this.queryLogPersistence;
    }
}
exports.QueryOrchestrator = QueryOrchestrator;
function createQueryOrchestrator(llmClient, documentStore) {
    return new QueryOrchestrator(llmClient, documentStore);
}
//# sourceMappingURL=query-orchestrator.js.map