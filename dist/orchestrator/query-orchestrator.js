"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryOrchestrator = void 0;
exports.createQueryOrchestrator = createQueryOrchestrator;
const uuid_1 = require("uuid");
class QueryOrchestrator {
    llmClient;
    documentStore;
    constructor(llmClient, documentStore) {
        this.llmClient = llmClient;
        this.documentStore = documentStore;
    }
    async execute(request) {
        const startTime = Date.now();
        const queryId = (0, uuid_1.v4)();
        const stored = this.documentStore.get(request.documentId);
        if (!stored) {
            throw new Error(`Document ${request.documentId} not found`);
        }
        const relevantGroups = await this.identifyRelevantGroups(stored, request.query, request.groupIds);
        const subagentResults = await Promise.all(relevantGroups.map(group => this.executeSubagent(group, request.query, request.extractionType, request.customPrompt)));
        const mergedResult = await this.mergeResults(request.query, subagentResults, stored);
        const totalTokens = subagentResults.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
        return {
            queryId,
            documentId: request.documentId,
            result: mergedResult,
            groupsProcessed: relevantGroups.map(g => g.id),
            duration: Date.now() - startTime,
            tokensUsed: totalTokens,
        };
    }
    async identifyRelevantGroups(stored, query, specificGroupIds) {
        if (specificGroupIds && specificGroupIds.length > 0) {
            return stored.groups.filter(g => specificGroupIds.includes(g.id));
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
        const response = await this.llmClient.completeWithJSON(messages);
        const relevantIds = new Set(response.relevantGroupIds);
        return stored.groups.filter(g => relevantIds.has(g.id));
    }
    async executeSubagent(group, query, extractionType, customPrompt) {
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
        const response = await this.llmClient.completeWithJSON(messages);
        return {
            groupId: group.id,
            answer: response.answer,
            entities: response.entities || [],
            excerpt: response.relevantExcerpt || '',
            tokensUsed: 0,
        };
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
    async mergeResults(query, subagentResults, stored) {
        if (subagentResults.length === 0) {
            return {
                answer: 'No relevant information found in the document.',
                sources: [],
                confidence: 0,
            };
        }
        if (subagentResults.length === 1) {
            const result = subagentResults[0];
            const group = stored.groups.find(g => g.id === result.groupId);
            return {
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
        const merged = await this.llmClient.completeWithJSON(messages);
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
            answer: merged.answer,
            sources,
            entities: allEntities,
            confidence: merged.confidence,
        };
    }
}
exports.QueryOrchestrator = QueryOrchestrator;
function createQueryOrchestrator(llmClient, documentStore) {
    return new QueryOrchestrator(llmClient, documentStore);
}
//# sourceMappingURL=query-orchestrator.js.map