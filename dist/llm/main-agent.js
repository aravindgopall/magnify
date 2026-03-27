import { v4 as uuidv4 } from 'uuid';
export class MainAgent {
    llmClient;
    constructor(llmClient) {
        this.llmClient = llmClient;
    }
    async analyzeDocument(document) {
        const sampleContent = this.extractSampleContent(document);
        const messages = [
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
        const response = await this.llmClient.completeWithJSON(messages);
        for (const group of response.groups) {
            if (!group.id) {
                group.id = uuidv4();
            }
        }
        return response;
    }
    async identifyGroups(document, strategy) {
        const analysis = await this.analyzeDocument(document);
        const groups = [];
        const effectiveStrategy = strategy || analysis.recommendedStrategy;
        for (const identifiedGroup of analysis.groups) {
            const startPage = Math.max(1, identifiedGroup.startPage);
            const endPage = Math.max(startPage, Math.min(document.pages.length, identifiedGroup.endPage));
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
    extractSampleContent(document) {
        const samples = [];
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
    getPagesToSample(totalPages) {
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
    formatTOC(items) {
        const lines = [];
        const formatItems = (itemsList, level = 0) => {
            for (const item of itemsList) {
                const indent = '  '.repeat(level);
                lines.push(`${indent}- ${item.title} (page ${item.pageNumber})`);
                if (item.children && Array.isArray(item.children)) {
                    formatItems(item.children, level + 1);
                }
            }
        };
        formatItems(items);
        return lines.join('\n');
    }
    getSystemPrompt() {
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
export function createMainAgent(llmClient) {
    return new MainAgent(llmClient);
}
//# sourceMappingURL=main-agent.js.map