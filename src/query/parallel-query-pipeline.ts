import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getDatabase, type Chunk } from '../db/database.js';
import type { SQLiteChunk, ChunkSource, ExtractionType, SQLiteQueryConfig, SQLiteQueryResult } from '../types/index.js';
import { appendFileSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

const LOG_DIR = join(process.cwd(), 'data', 'query-logs');
const RESULTS_DIR = join(process.cwd(), 'data', 'query-results');

const RELEVANCE_MARKER = 'NOT_RELEVANT';
const MAX_CONCURRENT_AGENTS = 9;
const BATCH_SUMMARIZE_SIZE = 10;

interface SubAgentResult {
  chunkId: string;
  title: string | null;
  source: ChunkSource;
  startPage: number;
  endPage: number;
  hasRelevantContext: boolean;
  context?: string;
  relevantExcerpt?: string;
}

interface IntermediateResult {
  query: string;
  timestamp: string;
  totalChunks: number;
  relevantChunks: SubAgentResult[];
  irrelevantChunks: SubAgentResult[];
}

class QueryLogger {
  private logFile: string;
  private startTime: number;

  constructor(query: string) {
    this.startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = query.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    this.logFile = join(LOG_DIR, `${timestamp}_${slug}.log`);

    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    this.write(`=== Parallel Query Log ===`);
    this.write(`Time: ${new Date().toISOString()}`);
    this.write(`Query: "${query}"`);
    this.write(`Max Concurrency: ${MAX_CONCURRENT_AGENTS}`);
    this.write('');
  }

  log(message: string): void {
    console.log(message);
    this.write(message);
  }

  error(message: string, detail?: unknown): void {
    console.error(message, detail ?? '');
    this.write(`${message}${detail ? ' ' + String(detail) : ''}`);
  }

  section(title: string): void {
    const line = `── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`;
    this.log(line);
  }

  chunkResult(agentId: string, title: string, pages: string, relevant: boolean, context?: string): void {
    const status = relevant ? 'RELEVANT' : 'not relevant';
    this.log(`[SubAgent:${agentId}] "${title}" (${pages}) → ${status}`);
    if (relevant && context) {
      this.write(`  Context preview: ${context.slice(0, 200)}${context.length > 200 ? '...' : ''}`);
    }
  }

  synthesisStep(pass: number, source: string, detail: string, charCount?: number): void {
    const chars = charCount !== undefined ? ` (${charCount} chars)` : '';
    this.log(`[Synthesis] Pass ${pass}: ${source} — ${detail}${chars}`);
  }

  finalAnswer(answer: string, sources: number, total: number, timeMs: number): void {
    this.write('');
    this.section('Final Answer');
    this.write(answer);
    this.write('');
    this.write(`Sources used: ${sources}/${total} chunks`);
    this.write(`Total time: ${(timeMs / 1000).toFixed(1)}s`);
    this.write('');
  }

  private write(text: string): void {
    try {
      appendFileSync(this.logFile, text + '\n');
    } catch {
      // ignore write errors
    }
  }

  getLogPath(): string {
    return this.logFile;
  }
}

function getGridModel(): Model<'openai-completions'> {
  const model = modelRegistry.find('grid', 'glm-latest');
  if (!model) {
    throw new Error('Grid model "glm-latest" not found in ~/.pi/agent/models.json');
  }
  return { ...model, maxTokens: 10000 } as Model<'openai-completions'>;
}

async function getApiKey(): Promise<string> {
  const apiKey = await authStorage.getApiKey('grid');
  if (!apiKey) {
    throw new Error('Grid API key not found in ~/.pi/agent/auth.json');
  }
  return apiKey;
}

export class ParallelQueryPipeline {
  private logger: QueryLogger | null = null;

  async execute(config: SQLiteQueryConfig): Promise<SQLiteQueryResult> {
    const startTime = Date.now();
    this.logger = new QueryLogger(config.query);

    if (!existsSync(RESULTS_DIR)) {
      mkdirSync(RESULTS_DIR, { recursive: true });
    }

    const allChunks = this.loadAllChunks();

    if (allChunks.length === 0) {
      return {
        answer: 'No documents have been ingested. Please run `npm ingest <file_path>` first.',
        sources: [],
        extractionType: 'summary',
        metadata: {
          totalChunks: 0,
          relevantChunks: 0,
          processingTimeMs: Date.now() - startTime,
        },
        logPath: this.logger.getLogPath(),
      };
    }

    this.logger.section('Loading');
    this.logger.log(`[Query] Loaded ${allChunks.length} chunks from 3 databases`);
    this.logger.log(`[Query] Max concurrent agents: ${MAX_CONCURRENT_AGENTS}`);

    const extractionType = config.extractionType || await this.classifyQuery(config.query);
    this.logger.log(`[Query] Extraction type: ${extractionType}`);

    // ── Pass 1: Per-chunk parallel relevance check ──
    this.logger.section('Pass 1: Relevance Check');
    const relevantResults = await this.checkRelevanceInParallel(allChunks, config.query, extractionType);

    const totalRelevant = relevantResults.length;
    this.logger.log(`[Pass 1] Found ${totalRelevant} relevant chunks out of ${allChunks.length}`);

    this.saveIntermediateResults(config.query, allChunks.length, relevantResults);

    if (totalRelevant === 0) {
      this.logger.log(`[Query] No relevant chunks found`);
      return {
        answer: 'I could not find any relevant information in the ingested documents to answer this query.',
        sources: [],
        extractionType,
        metadata: {
          totalChunks: allChunks.length,
          relevantChunks: 0,
          processingTimeMs: Date.now() - startTime,
        },
        logPath: this.logger!.getLogPath(),
      };
    }

    // ── Pass 2: Batch summarize → merge ──
    this.logger.section('Pass 2: Batch Synthesis');
    const answer = await this.batchSummarize(config.query, relevantResults, extractionType);

    const sources = relevantResults.map(r => ({
      chunkId: r.chunkId,
      title: r.title,
      source: r.source,
      startPage: r.startPage,
      endPage: r.endPage,
      relevantExcerpt: r.relevantExcerpt,
    }));

    this.logger.finalAnswer(answer, totalRelevant, allChunks.length, Date.now() - startTime);
    this.logger.log(`[Query] Log saved to: ${this.logger.getLogPath()}`);

    return {
      answer,
      sources,
      extractionType,
      metadata: {
        totalChunks: allChunks.length,
        relevantChunks: totalRelevant,
        processingTimeMs: Date.now() - startTime,
      },
      logPath: this.logger!.getLogPath(),
    };
  }

  private loadAllChunks(): SQLiteChunk[] {
    const fixedDb = getDatabase('fixed');
    const headingDb = getDatabase('heading');
    const tocDb = getDatabase('toc');

    const fixedChunks = fixedDb.getAllChunks().map(c => ({ ...c, source: 'fixed' as ChunkSource }));
    const headingChunks = headingDb.getAllChunks().map(c => ({ ...c, source: 'heading' as ChunkSource }));
    const tocChunks = tocDb.getAllChunks().map(c => ({ ...c, source: 'toc' as ChunkSource }));

    return [...fixedChunks, ...headingChunks, ...tocChunks];
  }

  private async classifyQuery(query: string): Promise<ExtractionType> {
    const model = getGridModel();
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: `You classify queries. Respond with ONLY one word: summary, entities, full, or custom.`,
      },
      getApiKey,
    });

    const prompt = `Classify this query into ONE type. Respond with ONLY the type name.

Types:
- summary: asking for overview, brief, main points
- entities: asking to extract, list, find specific items
- full: asking for detailed explanation, comprehensive answer
- custom: other or specialized requests

Query: "${query}"

Type:`;

    agent.reset();
    await agent.prompt(prompt);
    await agent.waitForIdle();

    const messages = agent.state.messages;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.role !== 'assistant') {
      return 'full';
    }

    const response = this.extractTextFromMessage(lastMessage).toLowerCase().trim();

    if (response.includes('summary')) return 'summary';
    if (response.includes('entities') || response.includes('entity')) return 'entities';
    if (response.includes('full')) return 'full';
    if (response.includes('custom')) return 'custom';

    return 'full';
  }

  /**
   * Pass 1: Check every chunk in parallel with concurrency cap.
   * Each chunk gets its own Agent call. Up to MAX_CONCURRENT_AGENTS run simultaneously.
   */
  private async checkRelevanceInParallel(
    chunks: SQLiteChunk[],
    query: string,
    extractionType: ExtractionType
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    let inFlight = 0;
    let chunkIndex = 0;

    this.logger!.log(`[Pass 1] Processing ${chunks.length} chunks with max ${MAX_CONCURRENT_AGENTS} concurrent agents`);

    return new Promise<SubAgentResult[]>((resolve) => {
      const processNext = () => {
        while (chunkIndex < chunks.length && inFlight < MAX_CONCURRENT_AGENTS) {
          const chunk = chunks[chunkIndex];
          const index = chunkIndex;
          chunkIndex++;
          inFlight++;

          this.checkSingleChunk(chunk, query, extractionType, index)
            .then(result => {
              results.push(result);
              this.logger!.chunkResult(
                `${result.source}-${index}`,
                result.title || 'Untitled',
                `pages ${result.startPage}-${result.endPage}`,
                result.hasRelevantContext,
                result.context
              );
            })
            .catch(error => {
              this.logger!.error(`[Pass 1] Error processing chunk ${chunk.chunk_id}`, error);
              results.push({
                chunkId: chunk.chunk_id,
                title: chunk.title,
                source: chunk.source,
                startPage: chunk.start_page,
                endPage: chunk.end_page,
                hasRelevantContext: false,
              });
            })
            .finally(() => {
              inFlight--;
              if (chunkIndex >= chunks.length && inFlight === 0) {
                resolve(results.filter(r => r.hasRelevantContext));
              } else {
                processNext();
              }
            });
        }

        if (chunks.length === 0) {
          resolve([]);
        }
      };

      processNext();
    });
  }

  /**
   * Check a single chunk for relevance using an in-process Agent.
   */
  private async checkSingleChunk(
    chunk: SQLiteChunk,
    query: string,
    extractionType: ExtractionType,
    index: number
  ): Promise<SubAgentResult> {
    const model = getGridModel();
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: this.buildRelevanceSystemPrompt(extractionType),
      },
      getApiKey,
    });

    const prompt = this.buildAnalysisPrompt(chunk, query);

    agent.reset();
    await agent.prompt(prompt);
    await agent.waitForIdle();

    const messages = agent.state.messages;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.role !== 'assistant') {
      return {
        chunkId: chunk.chunk_id,
        title: chunk.title,
        source: chunk.source,
        startPage: chunk.start_page,
        endPage: chunk.end_page,
        hasRelevantContext: false,
      };
    }

    const response = this.extractTextFromMessage(lastMessage);
    const trimmedResponse = response.trim();
    const isNotRelevant = trimmedResponse === RELEVANCE_MARKER || trimmedResponse.startsWith(RELEVANCE_MARKER + '\n');
    const cleanedContext = !isNotRelevant ? this.extractRelevantContent(response) : undefined;

    if (isNotRelevant) {
      return {
        chunkId: chunk.chunk_id,
        title: chunk.title,
        source: chunk.source,
        startPage: chunk.start_page,
        endPage: chunk.end_page,
        hasRelevantContext: false,
      };
    }

    return {
      chunkId: chunk.chunk_id,
      title: chunk.title,
      source: chunk.source,
      startPage: chunk.start_page,
      endPage: chunk.end_page,
      hasRelevantContext: true,
      context: cleanedContext!,
      relevantExcerpt: this.extractExcerpt(cleanedContext!),
    };
  }

  /**
   * Pass 2: Batch summarize relevant chunks, then merge all batch summaries.
   */
  private async batchSummarize(
    query: string,
    relevantResults: SubAgentResult[],
    extractionType: ExtractionType
  ): Promise<string> {
    const formatInstructions = this.getFormatInstructions(extractionType);
    const batches: SubAgentResult[][] = [];

    for (let i = 0; i < relevantResults.length; i += BATCH_SUMMARIZE_SIZE) {
      batches.push(relevantResults.slice(i, i + BATCH_SUMMARIZE_SIZE));
    }

    this.logger!.synthesisStep(2, 'start', `${relevantResults.length} relevant chunks in ${batches.length} batch(es)`);


    const batchSummaries = await Promise.all(
      batches.map(async (batch, batchIdx) => {
        const contextSections = batch
          .map((result, idx) => {
            return `[Section ${idx + 1}: ${result.title} (pages ${result.startPage}-${result.endPage}, source: ${result.source})]\n${result.context}\n`;
          })
          .join('\n---\n\n');

        const prompt = `Based on the following document sections, synthesize a focused answer to the user's query.

User Query: ${query}

Extraction Type: ${extractionType}

${formatInstructions}

Document Sections (batch ${batchIdx + 1}/${batches.length}):
${contextSections}

Synthesize your answer according to the extraction type format. Only include information present in the sections above.`;

        const summary = await this.runAgentPrompt(prompt);
        this.logger!.synthesisStep(2, `batch ${batchIdx + 1}`, `${batch.length} chunks summarized`, summary ? summary.length : 0);
        return summary;
      })
    );

    const nonEmptySummaries = batchSummaries.filter(Boolean) as string[];

    if (nonEmptySummaries.length === 0) {
      return 'Failed to generate an answer. Please try again.';
    }

    if (nonEmptySummaries.length === 1) {
      this.logger!.synthesisStep(2, 'done', 'single batch, no merge needed');
      return nonEmptySummaries[0];
    }

    this.logger!.synthesisStep(2, 'merge', `merging ${nonEmptySummaries.length} batch summaries`);

    const mergedContext = nonEmptySummaries
      .map((summary, i) => `=== Batch ${i + 1} Summary ===\n${summary}`)
      .join('\n\n');

    const mergePrompt = `You have ${nonEmptySummaries.length} summaries of document sections, each from a different batch of chunks (covering fixed-size pages, heading-based sections, and table-of-contents sections). Merge them into one coherent, deduplicated answer.

User Query: ${query}

Extraction Type: ${extractionType}

${formatInstructions}

Batch Summaries:
${mergedContext}

Merge these summaries into a single answer. Remove duplicates, resolve any conflicts by preferring the more detailed version, and organize the information clearly. Cite which source each piece of information comes from when relevant.`;

    const answer = await this.runAgentPrompt(mergePrompt);

    if (!answer) {
      this.logger!.error(`[Synthesis] Merge failed, concatenating batch summaries`);
      return nonEmptySummaries.join('\n\n');
    }

    this.logger!.synthesisStep(2, 'done', 'final answer generated', answer.length);
    return answer;
  }

  private buildRelevanceSystemPrompt(extractionType: ExtractionType): string {
    const instructions = this.getExtractionInstructions(extractionType);

    return `You are a STRICT relevance filter for document sections.

${instructions}

Your task:
1. Read the provided document section carefully
2. Determine if it DIRECTLY and SUBSTANTIVELY addresses the user's query
3. If relevant, extract ONLY the directly relevant portions EXACTLY AS THEY APPEAR
4. If NOT directly relevant, respond with ONLY: "${RELEVANCE_MARKER}"

STRICT relevance criteria — mark as RELEVANT ONLY if the section contains:
- A DIRECT answer to the query (not just tangentially related information)
- Specific data, values, or specifications that the query is explicitly asking about
- Definitions or explanations of the EXACT concepts mentioned in the query
- Implementation details or procedures that DIRECTLY address the query topic

Mark as NOT_RELEVANT if the section:
- Only mentions the query topic in passing without substantive detail
- Contains related but different concepts
- Has only peripheral or contextual information that doesn't answer the query
- Mentions the topic in a table of contents, index, or cross-reference without actual content

Be CONSERVATIVE. When in doubt, mark as NOT_RELEVANT. It is better to miss a marginally relevant section than to include irrelevant noise.

CRITICAL Response Format Rules:
- If NOT relevant: respond with ONLY "${RELEVANCE_MARKER}" (nothing else)
- If relevant: Copy ONLY the directly relevant text EXACTLY as it appears in the document
  * DO NOT reformat tables or restructure content
  * DO NOT add headers, markdown formatting, or explanations
  * PRESERVE the original formatting and text layout
  * DO NOT include surrounding context that is not itself relevant`;
  }

  private getExtractionInstructions(extractionType: ExtractionType): string {
    switch (extractionType) {
      case 'summary':
        return 'Extraction Mode: SUMMARY\nExtract relevant portions verbatim.';
      case 'entities':
        return 'Extraction Mode: ENTITIES\nExtract relevant portions verbatim.';
      case 'full':
        return 'Extraction Mode: FULL\nExtract all relevant portions verbatim, preserving complete detail.';
      default:
        return 'Extraction Mode: BALANCED\nExtract relevant portions verbatim.';
    }
  }

  private buildAnalysisPrompt(chunk: SQLiteChunk, query: string): string {
    const title = chunk.title || `Pages ${chunk.start_page}-${chunk.end_page}`;

    return `Analyze this document section for relevance to the query.

Document Section: ${title}
Pages: ${chunk.start_page}-${chunk.end_page}
Source: ${chunk.source}

Query: ${query}

Section Content:
${chunk.content.slice(0, 15000)}${chunk.content.length > 15000 ? '...[truncated]' : ''}

Extract relevant context or respond with "${RELEVANCE_MARKER}" if not relevant.`;
  }

  private async runAgentPrompt(prompt: string): Promise<string | null> {
    const model = getGridModel();
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
        tools: [],
        systemPrompt: `You are an expert document analysis and synthesis agent.

Your role is to synthesize information from multiple document sections to provide accurate, well-formatted answers to user queries.

IMPORTANT: The context provided to you is RAW TEXT extracted verbatim from document sections. You must:
1. Read and understand the raw context
2. Format your answer according to the specified extraction type
3. Preserve all technical accuracy (numbers, codes, field names, specifications)

Guidelines:
- Base your answer ONLY on the provided context from document sections
- Extract and synthesize the relevant information from raw context
- If information is incomplete or uncertain, acknowledge this
- Cite specific sections when referencing information
- If the provided context contains no relevant information, state this clearly
- DO NOT add information not present in the context
- Preserve exact technical terms, field names, codes, and specifications`,
      },
      getApiKey,
    });

    agent.reset();
    await agent.prompt(prompt);
    await agent.waitForIdle();

    const messages = agent.state.messages;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.role !== 'assistant') {
      return null;
    }

    return this.cleanAnswer(this.extractTextFromMessage(lastMessage));
  }

  private saveIntermediateResults(
    query: string,
    totalChunks: number,
    relevantResults: SubAgentResult[]
  ): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const slug = query.slice(0, 30).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
      const filePath = join(RESULTS_DIR, `${timestamp}_${slug}.json`);

      const data: IntermediateResult = {
        query,
        timestamp: new Date().toISOString(),
        totalChunks,
        relevantChunks: relevantResults,
        irrelevantChunks: [],
      };

      writeFileSync(filePath, JSON.stringify(data, null, 2));
      this.logger!.log(`[Intermediate] Results saved to: ${filePath}`);
    } catch (error) {
      this.logger!.error(`[Intermediate] Failed to save results`, error);
    }
  }

  private getFormatInstructions(extractionType: ExtractionType): string {
    switch (extractionType) {
      case 'summary':
        return `FORMAT YOUR ANSWER AS A SUMMARY:
- Provide a concise overview (2-5 bullet points or short paragraphs)
- Highlight the key points only
- Be brief but informative
- Cite section numbers where information comes from`;

      case 'entities':
        return `FORMAT YOUR ANSWER AS AN ENTITY LIST:
- Extract and list key entities (names, codes, field tags, identifiers, values)
- Use structured format (bullet points)
- Include context for each entity
- Cite section numbers where each entity is found`;

      case 'full':
        return `FORMAT YOUR ANSWER WITH FULL DETAIL:
- Provide comprehensive explanation with complete details
- Organize into clear sections/paragraphs
- Include all relevant specifications, definitions, and technical details
- Cite specific sections when referencing information`;

      default:
        return `FORMAT YOUR ANSWER WITH BALANCED DETAIL:
- Provide clear explanation with key details
- Be thorough but not overwhelming
- Cite sections when referencing specific information`;
    }
  }

  private extractTextFromMessage(message: any): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .filter(Boolean)
        .join('\n');
    }

    if (typeof message.content === 'object' && message.content !== null) {
      return message.content.text || '';
    }

    return '';
  }

  private extractRelevantContent(rawResponse: string): string {
    const lines = rawResponse.split('\n');
    const relevantLines: string[] = [];

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
      if (!trimmedLine) continue;

      const isThinking = thinkingPatterns.some(pattern => trimmedLine.startsWith(pattern));
      if (!isThinking) {
        relevantLines.push(line);
      }
    }

    return relevantLines.join('\n').trim();
  }

  private extractExcerpt(context: string, maxLength: number = 200): string {
    if (context.length <= maxLength) return context;

    const excerpt = context.slice(0, maxLength);
    const lastPeriod = excerpt.lastIndexOf('.');
    const lastNewline = excerpt.lastIndexOf('\n');
    const breakPoint = Math.max(lastPeriod, lastNewline);

    if (breakPoint > maxLength * 0.7) {
      return excerpt.slice(0, breakPoint + 1) + '...';
    }

    return excerpt + '...';
  }

  private cleanAnswer(response: string): string {
    if (!response) return response;

    const reasoningPatterns = [
      /^The user is asking.*?(?:\n|\.)/gm,
      /^Let me (?:analyze|synthesize|examine|review|look at).*?(?:\n|\.)/gm,
      /^Looking through.*?(?:\n|\.)/gm,
      /^I (?:should|need to|can|will).*?(?:\n|\.)/gm,
      /^Based on (?:my analysis|the context),?/gm,
      /^From (?:my understanding|what I can see),?/gm,
    ];

    let cleaned = response;
    for (const pattern of reasoningPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.replace(/^\s*\n+/, '').trim();
  }
}

export function createParallelQueryPipeline(): ParallelQueryPipeline {
  return new ParallelQueryPipeline();
}
