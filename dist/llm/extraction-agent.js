import { v4 as uuidv4 } from 'uuid';
export class LLMExtractionAgent {
    llmClient;
    agentId;
    customPrompt;
    extractionSchema;
    constructor(llmClient, options = {}) {
        this.llmClient = llmClient;
        this.agentId = options.agentId || uuidv4();
        this.customPrompt = options.customPrompt;
        this.extractionSchema = options.extractionSchema;
    }
    async execute(group) {
        const startTime = Date.now();
        try {
            const content = this.prepareContent(group);
            const messages = this.buildMessages(group, content);
            const extractedData = await this.llmClient.completeWithJSON(messages, this.extractionSchema);
            extractedData.groupId = group.id;
            if (!extractedData.title) {
                extractedData.title = group.title;
            }
            extractedData.metadata = {
                ...extractedData.metadata,
                startPage: group.startPage,
                endPage: group.endPage,
                pageCount: group.pages.length,
                extractedAt: new Date().toISOString(),
                extractedBy: this.agentId,
            };
            return {
                agentId: this.agentId,
                groupId: group.id,
                success: true,
                data: extractedData,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            return {
                agentId: this.agentId,
                groupId: group.id,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown extraction error',
                duration: Date.now() - startTime,
            };
        }
    }
    prepareContent(group) {
        const sections = [];
        for (const page of group.pages) {
            sections.push(`--- Page ${page.number} ---\n${page.text}`);
        }
        return sections.join('\n\n');
    }
    buildMessages(group, content) {
        const systemPrompt = this.customPrompt || this.getDefaultSystemPrompt();
        const messages = [
            {
                role: 'system',
                content: systemPrompt,
            },
            {
                role: 'user',
                content: `Extract structured information from this document section.

Section: ${group.title || `Pages ${group.startPage}-${group.endPage}`}
Pages: ${group.startPage} to ${group.endPage}

Content:
${content}

Respond with a JSON object containing:
{
  "title": "Section title if identifiable",
  "summary": "2-3 sentence summary of the content",
  "entities": [
    {
      "type": "person|organization|date|money|location|email|url|percentage|other",
      "name": "the entity value",
      "value": "additional context if applicable",
      "confidence": 0.0-1.0
    }
  ],
  "sections": [
    {
      "heading": "Section heading",
      "content": "Section content",
      "level": 1-4
    }
  ],
  "tables": [
    {
      "headers": ["col1", "col2"],
      "rows": [["val1", "val2"]],
      "caption": "Table caption if any",
      "pageNumber": 1
    }
  ]
}`,
            },
        ];
        return messages;
    }
    getDefaultSystemPrompt() {
        return `You are an expert document extraction agent. Your task is to analyze document sections and extract structured, accurate information.

Extraction Guidelines:
1. **Entities**: Extract all meaningful entities with their types
   - person: Names of people
   - organization: Company, institution, or group names
   - date: Any date references (normalize to ISO format when possible)
   - money: Monetary amounts with currency
   - location: Physical locations, addresses
   - email: Email addresses
   - url: Web URLs
   - percentage: Percentage values
   - other: Any other significant entity

2. **Sections**: Identify the document structure
   - Capture headings and their content
   - Maintain hierarchy with levels (1 = main, 2 = subsection, etc.)

3. **Tables**: Extract tabular data
   - Preserve header structure
   - Include all rows
   - Note the page number

4. **Summary**: Provide a concise 2-3 sentence summary

5. **Confidence**: Assign confidence scores based on clarity and context

Always respond with valid JSON. Be thorough but accurate. If information is unclear, note it in the confidence score.`;
    }
}
export function createLLMExtractionAgent(llmClient, options) {
    return new LLMExtractionAgent(llmClient, options);
}
//# sourceMappingURL=extraction-agent.js.map