import { v4 as uuidv4 } from 'uuid';
import type { LLMClient, LLMMessage } from './client.js';
import type { PDFDocument, Page, DocumentGroup, GroupingStrategy } from '../types/index.js';

export interface IdentifiedGroup {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  reasoning: string;
  suggestedExtractionType?: string;
}

export interface PDFAnalysisResult {
  documentType: string;
  summary: string;
  groups: IdentifiedGroup[];
  recommendedStrategy: GroupingStrategy;
  metadata: {
    hasTOC: boolean;
    hasHeadings: boolean;
    estimatedComplexity: 'low' | 'medium' | 'high';
  };
}

export class MainAgent {
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  async analyzeDocument(document: PDFDocument): Promise<PDFAnalysisResult> {
    const sampleContent = this.extractSampleContent(document);
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: this.getSystemPrompt(),
      },
      {
        role: 'user',
        content: `Analyze this PDF document and identify logical groups for extraction.

Document Metadata:
- Title: ${document.metadata.title || 'Unknown'}
- Pages: ${document.metadata.pageCount}
- Author: ${document.metadata.author || 'Unknown'}
- Has TOC: ${document.toc ? 'Yes' : 'No'}

${document.toc ? `Table of Contents:
${this.formatTOC(document.toc.items)}` : ''}

Sample Content from Key Pages:
${sampleContent}

Respond with a JSON object containing:
1. documentType: Type of document (report, invoice, research, book, manual, contract, etc.)
2. summary: Brief 1-2 sentence summary
3. groups: Array of identified groups with id, title, startPage, endPage, reasoning
4. recommendedStrategy: "heading", "toc", or "hybrid"
5. metadata: Object with hasTOC, hasHeadings, estimatedComplexity`,
      },
    ];

    const response = await this.llmClient.completeWithJSON<PDFAnalysisResult>(messages);
    
    for (const group of response.groups) {
      if (!group.id) {
        group.id = uuidv4();
      }
    }

    return response;
  }

  async identifyGroups(document: PDFDocument, strategy?: GroupingStrategy): Promise<DocumentGroup[]> {
    const analysis = await this.analyzeDocument(document);
    const groups: DocumentGroup[] = [];

    const effectiveStrategy = strategy || analysis.recommendedStrategy;

    for (const identifiedGroup of analysis.groups) {
      const startPage = Math.max(1, identifiedGroup.startPage);
      const endPage = Math.min(document.pages.length, identifiedGroup.endPage);
      
      const groupPages = document.pages.slice(startPage - 1, endPage);

      groups.push({
        id: identifiedGroup.id,
        type: effectiveStrategy,
        title: identifiedGroup.title,
        startPage,
        endPage,
        pages: groupPages,
        metadata: {
          reasoning: identifiedGroup.reasoning,
          suggestedExtractionType: identifiedGroup.suggestedExtractionType,
          identifiedBy: 'main-agent',
        },
      });
    }

    return groups;
  }

  private extractSampleContent(document: PDFDocument): string {
    const samples: string[] = [];
    const totalPages = document.pages.length;

    const pagesToSample = this.getPagesToSample(totalPages);

    for (const pageNum of pagesToSample) {
      const page = document.pages[pageNum - 1];
      if (page) {
        const text = page.text.substring(0, 1000);
        samples.push(`--- Page ${pageNum} ---\n${text}${page.text.length > 1000 ? '...' : ''}`);
      }
    }

    return samples.join('\n\n');
  }

  private getPagesToSample(totalPages: number): number[] {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const samples = [1, 2];
    
    const middle = Math.floor(totalPages / 2);
    samples.push(middle);
    
    if (totalPages > 10) {
      samples.push(Math.floor(totalPages * 0.75));
    }
    
    samples.push(totalPages - 1, totalPages);

    return [...new Set(samples)].sort((a, b) => a - b);
  }

  private formatTOC(items: Array<{ title: string; level: number; pageNumber: number; children?: unknown[] }>): string {
    const lines: string[] = [];
    
    const formatItems = (itemsList: typeof items, level: number = 0) => {
      for (const item of itemsList) {
        const indent = '  '.repeat(level);
        lines.push(`${indent}- ${item.title} (page ${item.pageNumber})`);
        if (item.children && Array.isArray(item.children)) {
          formatItems(item.children as typeof items, level + 1);
        }
      }
    };

    formatItems(items);
    return lines.join('\n');
  }

  private getSystemPrompt(): string {
    return `You are an expert document analyst. Your task is to analyze PDF documents and identify logical groupings for parallel extraction.

Your responsibilities:
1. Identify the document type and structure
2. Determine logical break points where content themes change
3. Create groups that are:
   - Semantically coherent (each group covers one main topic)
   - Appropriately sized (not too large, not too small)
   - Suitable for parallel processing

Guidelines for grouping:
- For reports: Group by sections/chapters
- For invoices: Each invoice is typically 1-2 pages
- For research papers: Abstract, Introduction, Methods, Results, Discussion, References
- For books: Use chapters or major sections
- For manuals: Group by feature or topic
- For contracts: Group by clauses or sections

Always respond with valid JSON matching the requested schema.`;
  }
}

export function createMainAgent(llmClient: LLMClient): MainAgent {
  return new MainAgent(llmClient);
}