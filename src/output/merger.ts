import type {
  SubagentResult,
  ExtractedData,
  MergedOutput,
  GroupResult,
  Section,
  Entity,
  TableData,
  OutputFormat,
  OutputConfig,
} from '../types/index.js';

export interface MergerOptions {
  deduplicateEntities?: boolean;
  mergeSections?: boolean;
  maxSummaryLength?: number;
  sortEntitiesByConfidence?: boolean;
}

export class OutputMerger {
  private options: MergerOptions;

  constructor(options: MergerOptions = {}) {
    this.options = {
      deduplicateEntities: true,
      mergeSections: true,
      maxSummaryLength: 1000,
      sortEntitiesByConfidence: true,
      ...options,
    };
  }

  merge(results: SubagentResult[]): MergedOutput {
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

  toGroupResults(results: SubagentResult[]): GroupResult[] {
    return results.map(result => ({
      groupId: result.groupId,
      status: result.success ? 'success' : 'failed',
      extraction: result.data,
      duration: result.duration,
      error: result.error,
    }));
  }

  private mergeAllSections(results: SubagentResult[]): Section[] {
    const sections: Section[] = [];

    for (const result of results) {
      if (result.data?.sections) {
        for (const section of result.data.sections) {
          if (this.options.mergeSections) {
            const existing = sections.find(s => 
              s.heading.toLowerCase() === section.heading.toLowerCase()
            );
            
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

  private mergeContent(existing: string, newContent: string): string {
    if (existing.includes(newContent) || newContent.includes(existing)) {
      return existing.length > newContent.length ? existing : newContent;
    }
    return `${existing}\n\n${newContent}`;
  }

  private sortSections(sections: Section[]): Section[] {
    return sections.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return a.heading.localeCompare(b.heading);
    });
  }

  private mergeAllEntities(results: SubagentResult[]): Entity[] {
    let entities: Entity[] = [];

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

  private deduplicateEntities(entities: Entity[]): Entity[] {
    const seen = new Map<string, Entity>();

    for (const entity of entities) {
      const key = `${entity.type}:${entity.name.toLowerCase()}`;
      const existing = seen.get(key);

      if (!existing || entity.confidence > existing.confidence) {
        seen.set(key, entity);
      }
    }

    return Array.from(seen.values());
  }

  private mergeAllTables(results: SubagentResult[]): TableData[] {
    const tables: TableData[] = [];

    for (const result of results) {
      if (result.data?.tables) {
        tables.push(...result.data.tables);
      }
    }

    return tables;
  }

  private generateCombinedSummary(results: SubagentResult[]): string {
    const summaries: string[] = [];

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

  private truncateSummary(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    const truncated = text.substring(0, maxLength);
    const lastSentence = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    );

    if (lastSentence > maxLength * 0.7) {
      return truncated.substring(0, lastSentence + 1);
    }

    return truncated + '...';
  }

  private extractTitle(results: SubagentResult[]): string | undefined {
    for (const result of results) {
      if (result.data?.title) {
        return result.data.title;
      }
    }
    return undefined;
  }

  private buildMetadata(results: SubagentResult[]): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      totalGroups: results.length,
      successfulGroups: results.filter(r => r.success).length,
      extractedAt: new Date().toISOString(),
    };

    const groupMetadata = results
      .filter(r => r.data?.metadata)
      .map(r => ({
        groupId: r.groupId,
        ...r.data!.metadata,
      }));

    if (groupMetadata.length > 0) {
      metadata.groups = groupMetadata;
    }

    return metadata;
  }

  private buildFullContent(results: SubagentResult[]): string {
    const contents: string[] = [];

    for (const result of results) {
      if (result.data?.rawContent) {
        contents.push(result.data.rawContent);
      }
    }

    return contents.join('\n\n---\n\n');
  }
}

export class OutputFormatter {
  format(output: MergedOutput, config: OutputConfig): string {
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

  private toJSON(output: MergedOutput, config: OutputConfig): string {
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

  private toMarkdown(output: MergedOutput, config: OutputConfig): string {
    const lines: string[] = [];

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

  private toSummary(output: MergedOutput, _config: OutputConfig): string {
    const lines: string[] = [];

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

  private toSearchIndex(output: MergedOutput, _config: OutputConfig): string {
    const documents: Record<string, unknown>[] = [];

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

  private groupEntitiesByType(entities: Entity[]): Record<string, Entity[]> {
    const grouped: Record<string, Entity[]> = {};

    for (const entity of entities) {
      if (!grouped[entity.type]) {
        grouped[entity.type] = [];
      }
      grouped[entity.type].push(entity);
    }

    return grouped;
  }
}

export function createMerger(options?: MergerOptions): OutputMerger {
  return new OutputMerger(options);
}

export function createFormatter(): OutputFormatter {
  return new OutputFormatter();
}