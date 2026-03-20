"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtractionAgent = void 0;
exports.createExtractionAgent = createExtractionAgent;
const base_agent_js_1 = require("./base-agent.js");
class ExtractionAgent extends base_agent_js_1.BaseSubagent {
    extractionConfig;
    constructor(config) {
        super(config);
        this.extractionConfig = {
            extractEntities: true,
            extractSections: true,
            extractTables: true,
            extractSummary: true,
            ...config,
        };
    }
    async execute(group) {
        const startTime = Date.now();
        try {
            const content = this.extractContent(group);
            const entities = this.extractionConfig.extractEntities
                ? this.extractEntitiesFromContent(group)
                : [];
            const sections = this.extractionConfig.extractSections
                ? this.extractSectionsFromContent(group)
                : [];
            const tables = this.extractionConfig.extractTables
                ? this.extractTablesFromContent(group)
                : [];
            const summary = this.extractionConfig.extractSummary
                ? this.generateSummary(content)
                : undefined;
            const extractedData = {
                groupId: group.id,
                title: group.title,
                summary,
                entities,
                sections,
                tables,
                metadata: {
                    startPage: group.startPage,
                    endPage: group.endPage,
                    pageCount: group.pages.length,
                    extractedAt: new Date().toISOString(),
                },
                rawContent: content,
            };
            if (this.extractionConfig.llmClient) {
                const enhanced = await this.enhanceWithLLM(group, extractedData);
                return this.createSuccessResult(group.id, enhanced, Date.now() - startTime);
            }
            return this.createSuccessResult(group.id, extractedData, Date.now() - startTime);
        }
        catch (error) {
            return this.createErrorResult(group.id, error instanceof Error ? error.message : 'Unknown extraction error', Date.now() - startTime);
        }
    }
    extractContent(group) {
        return group.pages
            .map(page => page.text)
            .join('\n\n--- Page Break ---\n\n');
    }
    extractEntitiesFromContent(_group) {
        const entities = [];
        const text = this.extractContent(_group);
        const datePatterns = [
            /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/g,
            /\b(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})\b/g,
            /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi,
        ];
        for (const pattern of datePatterns) {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                entities.push({
                    type: 'date',
                    name: match[1],
                    confidence: 0.9,
                });
            }
        }
        const moneyPattern = /\b(\$[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP))\b/g;
        const moneyMatches = text.matchAll(moneyPattern);
        for (const match of moneyMatches) {
            entities.push({
                type: 'money',
                name: match[1],
                confidence: 0.95,
            });
        }
        const emailPattern = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
        const emailMatches = text.matchAll(emailPattern);
        for (const match of emailMatches) {
            entities.push({
                type: 'email',
                name: match[1],
                confidence: 0.95,
            });
        }
        const urlPattern = /\b(https?:\/\/[^\s<>"{}|\\^`\[\]]+)\b/g;
        const urlMatches = text.matchAll(urlPattern);
        for (const match of urlMatches) {
            entities.push({
                type: 'url',
                name: match[1],
                confidence: 0.95,
            });
        }
        const percentPattern = /\b(\d+(?:\.\d+)?%)\b/g;
        const percentMatches = text.matchAll(percentPattern);
        for (const match of percentMatches) {
            entities.push({
                type: 'percentage',
                name: match[1],
                confidence: 0.9,
            });
        }
        return this.deduplicateEntities(entities);
    }
    deduplicateEntities(entities) {
        const seen = new Map();
        for (const entity of entities) {
            const key = `${entity.type}:${entity.name}`;
            if (!seen.has(key)) {
                seen.set(key, entity);
            }
        }
        return Array.from(seen.values());
    }
    extractSectionsFromContent(group) {
        const sections = [];
        let currentSection = null;
        let currentContent = [];
        for (const page of group.pages) {
            for (const element of page.elements) {
                if (element.type === 'heading' && element.level !== undefined) {
                    if (currentSection) {
                        currentSection.content = currentContent.join('\n').trim();
                        sections.push(currentSection);
                    }
                    currentSection = {
                        heading: element.text,
                        content: '',
                        level: element.level,
                    };
                    currentContent = [];
                }
                else if (element.type === 'text' && currentSection) {
                    currentContent.push(element.text);
                }
            }
        }
        if (currentSection) {
            currentSection.content = currentContent.join('\n').trim();
            sections.push(currentSection);
        }
        return sections;
    }
    extractTablesFromContent(group) {
        const tables = [];
        for (const page of group.pages) {
            const lines = page.text.split('\n');
            const potentialTables = this.detectTables(lines);
            for (const table of potentialTables) {
                tables.push({
                    ...table,
                    pageNumber: page.number,
                });
            }
        }
        return tables;
    }
    detectTables(lines) {
        const tables = [];
        let currentTable = null;
        let consecutiveAligned = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) {
                if (currentTable && consecutiveAligned >= 2) {
                    tables.push({
                        headers: currentTable.headers,
                        rows: currentTable.rows,
                    });
                }
                currentTable = null;
                consecutiveAligned = 0;
                continue;
            }
            const columns = this.parseTableRow(line);
            if (columns.length >= 2) {
                if (!currentTable) {
                    currentTable = {
                        headers: columns,
                        rows: [],
                    };
                    consecutiveAligned = 1;
                }
                else if (columns.length === currentTable.headers.length) {
                    currentTable.rows.push(columns);
                    consecutiveAligned++;
                }
                else {
                    if (consecutiveAligned >= 2) {
                        tables.push({
                            headers: currentTable.headers,
                            rows: currentTable.rows,
                        });
                    }
                    currentTable = {
                        headers: columns,
                        rows: [],
                    };
                    consecutiveAligned = 1;
                }
            }
        }
        if (currentTable && consecutiveAligned >= 2) {
            tables.push({
                headers: currentTable.headers,
                rows: currentTable.rows,
            });
        }
        return tables;
    }
    parseTableRow(line) {
        if (line.includes('\t')) {
            return line.split('\t').map(s => s.trim()).filter(s => s);
        }
        if (line.includes('|')) {
            return line.split('|').map(s => s.trim()).filter(s => s);
        }
        const multiSpacePattern = /\s{2,}/;
        if (multiSpacePattern.test(line)) {
            return line.split(multiSpacePattern).map(s => s.trim()).filter(s => s);
        }
        return [];
    }
    generateSummary(content) {
        const sentences = content
            .replace(/\n+/g, ' ')
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 20);
        if (sentences.length === 0) {
            return 'No content available for summary.';
        }
        const firstSentences = sentences.slice(0, 3).join('. ');
        return firstSentences.length > 500
            ? firstSentences.substring(0, 500) + '...'
            : firstSentences + '.';
    }
    async enhanceWithLLM(group, baseData) {
        if (!this.extractionConfig.llmClient) {
            return baseData;
        }
        const prompt = this.buildExtractionPrompt(group);
        try {
            const response = await this.extractionConfig.llmClient.complete(prompt);
            const parsed = this.parseLLMResponse(response);
            return {
                ...baseData,
                ...parsed,
                metadata: {
                    ...baseData.metadata,
                    llmEnhanced: true,
                },
            };
        }
        catch {
            return baseData;
        }
    }
    parseLLMResponse(response) {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }
        catch {
            // Return empty object if parsing fails
        }
        return {};
    }
}
exports.ExtractionAgent = ExtractionAgent;
function createExtractionAgent(config) {
    return new ExtractionAgent(config);
}
//# sourceMappingURL=extraction-agent.js.map