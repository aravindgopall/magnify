import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import type { DocumentGroup } from '../types/index.js';
import type { SubAgentResult } from './types.js';
import { getPiMonoLogger } from './pi-mono-logger.js';

const RELEVANCE_MARKER = 'NOT_RELEVANT';

// Initialize model registry to load from ~/.pi/agent/models.json
const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

// Get the grid model from models.json
function getGridModel(): Model<'openai-completions'> {
  const model = modelRegistry.find('grid', 'glm-latest');
  if (!model) {
    throw new Error('Grid model "glm-latest" not found in ~/.pi/agent/models.json. Please configure it.');
  }
  return model as Model<'openai-completions'>;
}

/**
 * Sub-agent that analyzes a single document group to determine if it contains
 * relevant context for the user's query.
 */
export class GroupContextAgent {
  private agent: Agent;
  private extractionType?: 'summary' | 'entities' | 'full' | 'custom';
  private customPrompt?: string;

  constructor(extractionType?: 'summary' | 'entities' | 'full' | 'custom', customPrompt?: string) {
    this.extractionType = extractionType;
    this.customPrompt = customPrompt;
    
    // Load grid model from ~/.pi/agent/models.json
    const model = getGridModel();
    
    this.agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: this.buildSystemPrompt(extractionType, customPrompt),
      },
      getApiKey: async () => {
        const apiKey = await authStorage.getApiKey('grid');
        if (!apiKey) {
          throw new Error('Grid API key not found. Please configure it in ~/.pi/agent/auth.json');
        }
        return apiKey;
      },
    });
  }

  private buildSystemPrompt(
    extractionType?: 'summary' | 'entities' | 'full' | 'custom',
    customPrompt?: string
  ): string {
    if (extractionType === 'custom' && customPrompt) {
      return customPrompt;
    }

    const baseInstructions = this.getExtractionInstructions(extractionType);
    return `You are a context extraction agent specialized in analyzing document sections.

${baseInstructions}

Your task:
1. Read the provided document section carefully
2. Determine if it contains information RELATED to the user's query
3. If relevant, extract the relevant portions EXACTLY AS THEY APPEAR in the document
4. If NOT relevant, respond with ONLY: "${RELEVANCE_MARKER}"

Guidelines - When to mark as NOT RELEVANT:
- Table of contents or index pages (only lists page numbers without context)
- Pages that briefly mention the topic in passing without any details
- Cross-references without additional context
- Completely unrelated content

Mark as RELEVANT if the section contains:
- Definitions, explanations, or descriptions related to the query topic
- Technical specifications, field definitions, or data structures about the topic
- Implementation details, requirements, or procedures involving the topic
- Tables, values, codes, or parameters related to the topic
- Examples, use cases, or context that helps understand the topic
- Any substantive information that relates to the query topic

CRITICAL Response Format Rules:
- If NOT relevant: respond with ONLY "${RELEVANCE_MARKER}" (nothing else)
- If relevant: Copy the relevant text EXACTLY as it appears in the document
  * DO NOT reformat tables or restructure content
  * DO NOT add headers, markdown formatting, or explanations
  * DO NOT reorganize or interpret the information
  * PRESERVE the original formatting, table structure, and text layout
  * Extract complete paragraphs, tables, and sections that are relevant
  * You may concatenate multiple relevant sections with "..." as separator

Example:
Query: "What is field tag 18?"
Document: "Tag 18: Merchant Name, Length: 25 bytes, Format: AN..."

CORRECT Response:
"Tag 18: Merchant Name, Length: 25 bytes, Format: AN..."

INCORRECT Response:
"## Field Tag 18
**Tag:** 18
**Name:** Merchant Name
**Length:** 25 bytes"

Remember: Extract verbatim. The main agent will handle formatting.`;
  }

  private getExtractionInstructions(extractionType?: 'summary' | 'entities' | 'full' | 'custom'): string {
    switch (extractionType) {
      case 'summary':
        return 'Extraction Mode: SUMMARY\nExtract relevant portions verbatim. Main agent will create summary.';
      case 'entities':
        return 'Extraction Mode: ENTITIES\nExtract relevant portions verbatim. Main agent will identify entities.';
      case 'full':
        return 'Extraction Mode: FULL\nExtract all relevant portions verbatim, preserving complete detail.';
      default:
        return 'Extraction Mode: BALANCED\nExtract relevant portions verbatim. Main agent will format appropriately.';
    }
  }

  /**
   * Analyze a document group to extract relevant context for a query.
   * Returns false if the group contains no relevant information.
   */
  async analyze(
    group: DocumentGroup,
    query: string,
    signal?: AbortSignal
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const logger = getPiMonoLogger();
    const groupTitle = group.title || `Pages ${group.startPage}-${group.endPage}`;

    // Build the prompt with group content
    const groupText = this.extractGroupText(group);
    const prompt = this.buildAnalysisPrompt(group, groupText, query);

    console.log(`  [SubAgent] Analyzing: ${groupTitle} (${groupText.length} chars)`);

    // Reset agent for fresh analysis
    this.agent.reset();

    // Execute the agent and wait for completion
    await this.agent.prompt(prompt);
    await this.agent.waitForIdle();
    
    const durationMs = Date.now() - startTime;
    
    // Get the response
    const messages = this.agent.state.messages;
    const lastMessage = messages[messages.length - 1];
    
    // Log the LLM call with full agent state
    const llmCallId = await logger.logLLMCall(
      'sub-agent',
      this.buildSystemPrompt(this.extractionType, this.customPrompt),
      prompt,
      this.agent.state,
      durationMs,
      group.id,
      group.title || `Pages ${group.startPage}-${group.endPage}`
    );
    
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return {
        groupId: group.id,
        groupTitle: group.title || `Pages ${group.startPage}-${group.endPage}`,
        hasRelevantContext: false,
      };
    }

    const rawResponse = this.extractTextFromMessage(lastMessage);
    
    // Check if the response contains NOT_RELEVANT marker (anywhere in the response)
    const isNotRelevant = rawResponse.includes(RELEVANCE_MARKER) || 
                          rawResponse.trim().endsWith(RELEVANCE_MARKER);
    
    if (isNotRelevant) {
      const result = {
        groupId: group.id,
        groupTitle: group.title || `Pages ${group.startPage}-${group.endPage}`,
        hasRelevantContext: false,
      };
      return result;
    }

    // Extract only the relevant content, filtering out reasoning/thinking
    const cleanedContext = this.extractRelevantContent(rawResponse);

    // Extract relevant context
    const result = {
      groupId: group.id,
      groupTitle: group.title || `Pages ${group.startPage}-${group.endPage}`,
      hasRelevantContext: true,
      context: cleanedContext,
      relevantExcerpt: this.extractExcerpt(cleanedContext),
    };
    
    return result;
  }

  private extractGroupText(group: DocumentGroup): string {
    // Use fullText if available, otherwise concatenate page text
    if (group.fullText) {
      return group.fullText;
    }

    return group.pages
      .map((page) => page.text || page.rawText)
      .filter(Boolean)
      .join('\n\n');
  }

  private buildAnalysisPrompt(
    group: DocumentGroup,
    groupText: string,
    query: string
  ): string {
    const title = group.title || `Pages ${group.startPage}-${group.endPage}`;
    
    return `Analyze this document section for relevance to the query.

Document Section: ${title}
Pages: ${group.startPage}-${group.endPage}

Query: ${query}

Section Content:
${groupText.slice(0, 15000)} ${groupText.length > 15000 ? '...[truncated]' : ''}

Extract relevant context or respond with "${RELEVANCE_MARKER}" if not relevant.`;
  }

  private extractTextFromMessage(message: any): string {
    if (typeof message.content === 'string') {
      return message.content;
    }
    
    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text' || c.type === 'thinking')
        .map((c: any) => c.text || c.thinking || '')
        .filter(Boolean)
        .join('\n');
    }
    
    // If content is an object, try to extract text from known fields
    if (typeof message.content === 'object' && message.content !== null) {
      return message.content.text || message.content.thinking || '';
    }
    
    return '';
  }

  /**
   * Extract only the relevant content from the response, filtering out reasoning/thinking.
   * Skips lines that contain metacognitive phrases like "Let me", "Looking through", etc.
   */
  private extractRelevantContent(rawResponse: string): string {
    const lines = rawResponse.split('\n');
    const relevantLines: string[] = [];
    
    // Common reasoning/thinking patterns to skip
    const thinkingPatterns = [
      'The user is asking',
      'Let me',
      'Looking through',
      'Looking at',
      'I should',
      'I can see',
      'I need to',
      'I will',
      'This section',
      'This document',
      'Analyzing',
      'Based on my analysis',
    ];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) continue;
      
      // Skip lines that start with reasoning patterns
      const isThinking = thinkingPatterns.some(pattern => 
        trimmedLine.startsWith(pattern)
      );
      
      if (!isThinking) {
        relevantLines.push(line);
      }
    }
    
    return relevantLines.join('\n').trim();
  }

  private extractExcerpt(context: string, maxLength: number = 200): string {
    if (context.length <= maxLength) {
      return context;
    }
    
    // Try to break at a sentence
    const excerpt = context.slice(0, maxLength);
    const lastPeriod = excerpt.lastIndexOf('.');
    const lastNewline = excerpt.lastIndexOf('\n');
    
    const breakPoint = Math.max(lastPeriod, lastNewline);
    if (breakPoint > maxLength * 0.7) {
      return excerpt.slice(0, breakPoint + 1) + '...';
    }
    
    return excerpt + '...';
  }
}
