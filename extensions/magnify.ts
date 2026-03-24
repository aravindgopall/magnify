/**
 * Magnify Extension
 * Orchestrates the 4-step PDF query pipeline
 * 
 * Flow: Rewriter → Explorer → Reader → Main Agent
 */

// Configuration
const MAGNIFY_API_BASE = 'http://localhost:3000/api';

// Types
interface RewriterOutput {
  explorer_query: string;
  reader_query: string;
}

interface MatchedGroup {
  groupId: string;
  title: string;
  pages: string;
  relevanceScore: number;
  matchReason: string;
}

interface ExplorerOutput {
  documentId: string;
  matchedGroups: MatchedGroup[];
  totalGroupsSearched: number;
  strategy: string;
}

interface Source {
  groupId: string;
  title: string;
  pages: string;
  excerpt?: string;
}

interface Table {
  title?: string;
  headers: string[];
  rows: string[][];
  pageNumber?: number;
}

interface Image {
  description?: string;
  pageNumber: number;
  path: string;
}

interface ReaderOutput {
  success: boolean;
  answer: string;
  sources: Source[];
  tables: Table[];
  images: Image[];
  keyEntities: string[];
  confidence: number;
  gaps: string[];
}

interface PipelineResult {
  success: boolean;
  originalQuery: string;
  explorerQuery: string;
  readerQuery: string;
  documentId: string | null;
  matchedGroups: MatchedGroup[];
  answer: string;
  sources: Source[];
  tables: Table[];
  images: Image[];
  keyEntities: string[];
  confidence: number;
  gaps: string[];
  processingTime: number;
}

// API Client
class MagnifyClient {
  private baseUrl: string;

  constructor(baseUrl: string = MAGNIFY_API_BASE) {
    this.baseUrl = baseUrl;
  }

  async getDocuments(): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/documents`);
    const data = await response.json();
    return data.documents || [];
  }

  async getGroups(documentId: string): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/documents/${documentId}/groups`);
    const data = await response.json();
    return data.groups || [];
  }

  async query(params: {
    documentId: string;
    query: string;
    groupIds: string[];
    extractionType?: string;
  }): Promise<any> {
    const response = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: params.documentId,
        query: params.query,
        groupIds: params.groupIds,
        extractionType: params.extractionType || 'full',
      }),
    });
    return response.json();
  }
}

// Pipeline Orchestrator
export class MagnifyPipeline {
  private client: MagnifyClient;
  private llmClient: any; // LLM client for rewriter

  constructor(llmClient?: any) {
    this.client = new MagnifyClient();
    this.llmClient = llmClient;
  }

  /**
   * Execute the full 4-step pipeline
   */
  async execute(userQuery: string): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      // Step 1: Rewriter Agent
      const rewritten = await this.executeRewriter(userQuery);

      // Step 2: Explorer Agent
      const explorerResult = await this.executeExplorer(rewritten.explorer_query);

      if (!explorerResult || !explorerResult.matchedGroups.length) {
        return this.createEmptyResult(userQuery, rewritten, startTime, 'No matching groups found');
      }

      // Step 3: Reader Agent
      const readerResult = await this.executeReader({
        reader_query: rewritten.reader_query,
        documentId: explorerResult.documentId,
        groupIds: explorerResult.matchedGroups.map(g => g.groupId),
      });

      // Build final result
      const processingTime = Date.now() - startTime;

      return {
        success: readerResult.success,
        originalQuery: userQuery,
        explorerQuery: rewritten.explorer_query,
        readerQuery: rewritten.reader_query,
        documentId: explorerResult.documentId,
        matchedGroups: explorerResult.matchedGroups,
        answer: readerResult.answer,
        sources: readerResult.sources,
        tables: readerResult.tables,
        images: readerResult.images,
        keyEntities: readerResult.keyEntities,
        confidence: readerResult.confidence,
        gaps: readerResult.gaps,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      return {
        success: false,
        originalQuery: userQuery,
        explorerQuery: '',
        readerQuery: '',
        documentId: null,
        matchedGroups: [],
        answer: '',
        sources: [],
        tables: [],
        images: [],
        keyEntities: [],
        confidence: 0,
        gaps: [`Pipeline error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        processingTime,
      };
    }
  }

  /**
   * Step 1: Rewriter Agent
   * Transforms user query into explorer and reader queries
   */
  private async executeRewriter(userQuery: string): Promise<RewriterOutput> {
    // If LLM client is available, use it for intelligent rewriting
    if (this.llmClient) {
      try {
        const prompt = `You are a query rewriter. Transform this user query into two versions:
1. explorer_query: Short (3-7 words), keyword-focused for matching document section titles
2. reader_query: Detailed, content-focused for deep extraction

User query: "${userQuery}"

Return ONLY valid JSON with exactly these two fields.`;

        const response = await this.llmClient.complete(prompt);
        const parsed = JSON.parse(response);
        return {
          explorer_query: parsed.explorer_query || userQuery,
          reader_query: parsed.reader_query || userQuery,
        };
      } catch {
        // Fall back to rule-based rewriting
      }
    }

    // Rule-based fallback rewriting
    return this.ruleBasedRewrite(userQuery);
  }

  /**
   * Fallback rule-based query rewriting
   */
  private ruleBasedRewrite(query: string): RewriterOutput {
    // Remove common filler words
    const fillerWords = ['what', 'is', 'the', 'a', 'an', 'how', 'do', 'does', 'can', 'i', 'to', 'for', 'about', 'tell', 'me', 'please'];
    
    // Create explorer query (keywords only)
    const keywords = query
      .toLowerCase()
      .replace(/[?.,!]/g, '')
      .split(/\s+/)
      .filter(word => !fillerWords.includes(word) && word.length > 2)
      .slice(0, 5)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    return {
      explorer_query: keywords || query,
      reader_query: query.includes('what') || query.includes('how')
        ? `Explain in detail: ${query}`
        : query,
    };
  }

  /**
   * Step 2: Explorer Agent
   * Finds relevant document groups
   */
  private async executeExplorer(explorerQuery: string): Promise<ExplorerOutput | null> {
    // Get all documents
    const documents = await this.client.getDocuments();
    
    if (!documents.length) {
      return null;
    }

    // Use first document (could be enhanced to search across multiple)
    const doc = documents[0];
    
    // Get all groups for the document
    const groups = await this.client.getGroups(doc.id);
    
    // Match groups against explorer query
    const matchedGroups = this.matchGroups(explorerQuery, groups);

    return {
      documentId: doc.id,
      matchedGroups,
      totalGroupsSearched: groups.length,
      strategy: 'toc',
    };
  }

  /**
   * Match groups against explorer query
   */
  private matchGroups(explorerQuery: string, groups: any[]): MatchedGroup[] {
    const queryTerms = explorerQuery.toLowerCase().split(/\s+/);
    
    const scored = groups.map(group => {
      const title = (group.title || '').toLowerCase();
      let score = 0;
      let matchReason = '';

      // Exact match
      if (title.includes(explorerQuery.toLowerCase())) {
        score = 1.0;
        matchReason = 'Exact title match';
      } else {
        // Keyword matching
        const matchingTerms = queryTerms.filter(term => title.includes(term));
        score = matchingTerms.length / queryTerms.length;
        matchReason = `Matched ${matchingTerms.length} keywords: ${matchingTerms.join(', ')}`;
      }

      return {
        groupId: group.id,
        title: group.title || `Pages ${group.startPage}-${group.endPage}`,
        pages: `${group.startPage}-${group.endPage}`,
        relevanceScore: Math.min(score, 1.0),
        matchReason,
        type: group.type,
      };
    });

    // Filter and sort by relevance
    return scored
      .filter(g => g.relevanceScore > 0.2)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 5);
  }

  /**
   * Step 3: Reader Agent
   * Executes deep content extraction
   */
  private async executeReader(params: {
    reader_query: string;
    documentId: string;
    groupIds: string[];
  }): Promise<ReaderOutput> {
    try {
      const response = await this.client.query({
        documentId: params.documentId,
        query: params.reader_query,
        groupIds: params.groupIds,
        extractionType: 'full',
      });

      return {
        success: true,
        answer: response.answer || '',
        sources: (response.sources || []).map((s: any) => ({
          groupId: s.groupId,
          title: s.title,
          pages: s.pages || `${s.startPage}-${s.endPage}`,
          excerpt: s.excerpt,
        })),
        tables: response.tables || [],
        images: response.images || [],
        keyEntities: (response.entities || []).map((e: any) => e.name || e.type),
        confidence: response.confidence || 0.8,
        gaps: [],
      };
    } catch (error) {
      return {
        success: false,
        answer: '',
        sources: [],
        tables: [],
        images: [],
        keyEntities: [],
        confidence: 0,
        gaps: [`Reader error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Create empty result for error cases
   */
  private createEmptyResult(
    userQuery: string,
    rewritten: RewriterOutput,
    startTime: number,
    reason: string
  ): PipelineResult {
    return {
      success: false,
      originalQuery: userQuery,
      explorerQuery: rewritten.explorer_query,
      readerQuery: rewritten.reader_query,
      documentId: null,
      matchedGroups: [],
      answer: '',
      sources: [],
      tables: [],
      images: [],
      keyEntities: [],
      confidence: 0,
      gaps: [reason],
      processingTime: Date.now() - startTime,
    };
  }
}

// Export factory function
export function createMagnifyPipeline(llmClient?: any): MagnifyPipeline {
  return new MagnifyPipeline(llmClient);
}

// Export for convenience
export default MagnifyPipeline;