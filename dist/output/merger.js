"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutputFormatter = exports.OutputMerger = void 0;
exports.createMerger = createMerger;
exports.createFormatter = createFormatter;
class OutputMerger {
    options;
    constructor(options = {}) {
        this.options = {
            deduplicateEntities: true,
            mergeSections: true,
            maxSummaryLength: 1000,
            sortEntitiesByConfidence: true,
            ...options,
        };
    }
    merge(results) {
        const successfulResults = results.filter(r => r.success && r.data);
        const allSections = this.mergeAllSections(successfulResults);
        const allEntities = this.mergeAllEntities(successfulResults);
        const allTables = this.mergeAllTables(successfulResults);
        const summary = this.generateCombinedSummary(successfulResults);
        const title = this.extractTitle(successfulResults);
        const metadata = this.buildMetadata(successfulResults);
        const fullContent = this.buildFullContent(successfulResults);
        return {
            title,
            summary,
            sections: allSections,
            entities: allEntities,
            tables: allTables,
            metadata,
            fullContent,
        };
    }
    toGroupResults(results) {
        return results.map(result => ({
            groupId: result.groupId,
            status: result.success ? 'success' : 'failed',
            extraction: result.data,
            duration: result.duration,
            error: result.error,
        }));
    }
    mergeAllSections(results) {
        const sections = [];
        for (const result of results) {
            if (result.data?.sections) {
                for (const section of result.data.sections) {
                    if (this.options.mergeSections) {
                        const existing = sections.find(s => s.heading.toLowerCase() === section.heading.toLowerCase());
                        if (existing) {
                            existing.content = this.mergeContent(existing.content, section.content);
                            continue;
                        }
                    }
                    sections.push({
                        ...section,
                        subsections: section.subsections ? [...section.subsections] : undefined,
                    });
                }
            }
        }
        return this.sortSections(sections);
    }
    mergeContent(existing, newContent) {
        if (existing.includes(newContent) || newContent.includes(existing)) {
            return existing.length > newContent.length ? existing : newContent;
        }
        return `${existing}\n\n${newContent}`;
    }
    sortSections(sections) {
        return sections.sort((a, b) => {
            if (a.level !== b.level) {
                return a.level - b.level;
            }
            return a.heading.localeCompare(b.heading);
        });
    }
    mergeAllEntities(results) {
        let entities = [];
        for (const result of results) {
            if (result.data?.entities) {
                entities.push(...result.data.entities);
            }
        }
        if (this.options.deduplicateEntities) {
            entities = this.deduplicateEntities(entities);
        }
        if (this.options.sortEntitiesByConfidence) {
            entities.sort((a, b) => b.confidence - a.confidence);
        }
        return entities;
    }
    deduplicateEntities(entities) {
        const seen = new Map();
        for (const entity of entities) {
            const key = `${entity.type}:${entity.name.toLowerCase()}`;
            const existing = seen.get(key);
            if (!existing || entity.confidence > existing.confidence) {
                seen.set(key, entity);
            }
        }
        return Array.from(seen.values());
    }
    mergeAllTables(results) {
        const tables = [];
        for (const result of results) {
            if (result.data?.tables) {
                tables.push(...result.data.tables);
            }
        }
        return tables;
    }
    generateCombinedSummary(results) {
        const summaries = [];
        for (const result of results) {
            if (result.data?.summary) {
                summaries.push(result.data.summary);
            }
        }
        if (summaries.length === 0) {
            return 'No summary available.';
        }
        const combined = summaries.join(' ');
        if (combined.length <= (this.options.maxSummaryLength || 1000)) {
            return combined;
        }
        return this.truncateSummary(combined, this.options.maxSummaryLength || 1000);
    }
    truncateSummary(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        const truncated = text.substring(0, maxLength);
        const lastSentence = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
        if (lastSentence > maxLength * 0.7) {
            return truncated.substring(0, lastSentence + 1);
        }
        return truncated + '...';
    }
    extractTitle(results) {
        for (const result of results) {
            if (result.data?.title) {
                return result.data.title;
            }
        }
        return undefined;
    }
    buildMetadata(results) {
        const metadata = {
            totalGroups: results.length,
            successfulGroups: results.filter(r => r.success).length,
            extractedAt: new Date().toISOString(),
        };
        const groupMetadata = results
            .filter(r => r.data?.metadata)
            .map(r => ({
            groupId: r.groupId,
            ...r.data.metadata,
        }));
        if (groupMetadata.length > 0) {
            metadata.groups = groupMetadata;
        }
        return metadata;
    }
    buildFullContent(results) {
        const contents = [];
        for (const result of results) {
            if (result.data?.rawContent) {
                contents.push(result.data.rawContent);
            }
        }
        return contents.join('\n\n---\n\n');
    }
}
exports.OutputMerger = OutputMerger;
class OutputFormatter {
    format(output, config) {
        switch (config.format) {
            case 'json':
                return this.toJSON(output, config);
            case 'markdown':
                return this.toMarkdown(output, config);
            case 'summary':
                return this.toSummary(output, config);
            case 'search-index':
                return this.toSearchIndex(output, config);
            default:
                return this.toJSON(output, config);
        }
    }
    toJSON(output, config) {
        const result = config.includeMetadata ? output : {
            title: output.title,
            summary: output.summary,
            sections: output.sections,
            entities: output.entities,
            tables: output.tables,
        };
        return config.prettyPrint
            ? JSON.stringify(result, null, 2)
            : JSON.stringify(result);
    }
    toMarkdown(output, config) {
        const lines = [];
        if (output.title) {
            lines.push(`# ${output.title}`);
            lines.push('');
        }
        if (output.summary) {
            lines.push('## Summary');
            lines.push('');
            lines.push(output.summary);
            lines.push('');
        }
        if (output.sections.length > 0) {
            lines.push('## Sections');
            lines.push('');
            for (const section of output.sections) {
                const prefix = '#'.repeat(section.level + 2);
                lines.push(`${prefix} ${section.heading}`);
                lines.push('');
                lines.push(section.content);
                lines.push('');
            }
        }
        if (output.entities.length > 0) {
            lines.push('## Entities');
            lines.push('');
            const grouped = this.groupEntitiesByType(output.entities);
            for (const [type, entities] of Object.entries(grouped)) {
                lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}`);
                lines.push('');
                for (const entity of entities) {
                    lines.push(`- ${entity.name}${entity.value ? `: ${entity.value}` : ''}`);
                }
                lines.push('');
            }
        }
        if (output.tables.length > 0) {
            lines.push('## Tables');
            lines.push('');
            for (let i = 0; i < output.tables.length; i++) {
                const table = output.tables[i];
                lines.push(`### Table ${i + 1}${table.caption ? `: ${table.caption}` : ''}`);
                lines.push('');
                if (table.headers.length > 0) {
                    lines.push(`| ${table.headers.join(' | ')} |`);
                    lines.push(`| ${table.headers.map(() => '---').join(' | ')} |`);
                    for (const row of table.rows) {
                        lines.push(`| ${row.join(' | ')} |`);
                    }
                    lines.push('');
                }
            }
        }
        if (config.includeMetadata && Object.keys(output.metadata).length > 0) {
            lines.push('## Metadata');
            lines.push('');
            lines.push('```json');
            lines.push(JSON.stringify(output.metadata, null, 2));
            lines.push('```');
        }
        return lines.join('\n');
    }
    toSummary(output, _config) {
        const lines = [];
        if (output.title) {
            lines.push(`Title: ${output.title}`);
            lines.push('');
        }
        lines.push('Summary:');
        lines.push(output.summary || 'No summary available.');
        lines.push('');
        lines.push(`Sections: ${output.sections.length}`);
        lines.push(`Entities: ${output.entities.length}`);
        lines.push(`Tables: ${output.tables.length}`);
        return lines.join('\n');
    }
    toSearchIndex(output, _config) {
        const documents = [];
        if (output.summary) {
            documents.push({
                id: 'summary',
                type: 'summary',
                content: output.summary,
                title: output.title || 'Summary',
            });
        }
        for (let i = 0; i < output.sections.length; i++) {
            const section = output.sections[i];
            documents.push({
                id: `section-${i}`,
                type: 'section',
                heading: section.heading,
                content: section.content,
                level: section.level,
            });
        }
        for (let i = 0; i < output.entities.length; i++) {
            const entity = output.entities[i];
            documents.push({
                id: `entity-${i}`,
                type: 'entity',
                entityType: entity.type,
                name: entity.name,
                value: entity.value,
                confidence: entity.confidence,
            });
        }
        for (let i = 0; i < output.tables.length; i++) {
            const table = output.tables[i];
            documents.push({
                id: `table-${i}`,
                type: 'table',
                caption: table.caption,
                headers: table.headers,
                rows: table.rows,
                pageNumber: table.pageNumber,
            });
        }
        return JSON.stringify({
            title: output.title,
            documents,
            metadata: output.metadata,
        }, null, 2);
    }
    groupEntitiesByType(entities) {
        const grouped = {};
        for (const entity of entities) {
            if (!grouped[entity.type]) {
                grouped[entity.type] = [];
            }
            grouped[entity.type].push(entity);
        }
        return grouped;
    }
}
exports.OutputFormatter = OutputFormatter;
function createMerger(options) {
    return new OutputMerger(options);
}
function createFormatter() {
    return new OutputFormatter();
}
//# sourceMappingURL=merger.js.map