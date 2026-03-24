import { v4 as uuidv4 } from 'uuid';
import type { 
  PDFDocument, 
  DocumentGroup, 
  GroupingStrategy,
  PythonExtractionResult,
  PythonGroupObject,
  TableData,
} from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
import { createParser, PDFParser } from '../parser/index.js';
import { MainAgent } from '../llm/main-agent.js';
import { DocumentPersistence, createDocumentPersistence } from './persistence.js';
import path from 'path';

export interface StoredDocument {
  id: string;
  document: PDFDocument;
  groups: DocumentGroup[];
  metadata: {
    uploadedAt: Date;
    fileName?: string;
    groupingStrategy: GroupingStrategy;
    documentType?: string;
    pdfType?: 'digital' | 'scanned' | 'hybrid';
  };
  // Store Python extraction result for access to all group strategies
  pythonResult?: PythonExtractionResult;
}

export interface QueryContext {
  documentId: string;
  groupIds?: string[];
  query: string;
  userId?: string;
}

export interface DocumentStoreOptions {
  dataDir?: string;
  usePythonExtractor?: boolean;
}

export class DocumentStore {
  private documents: Map<string, StoredDocument> = new Map();
  private llmClient: LLMClient;
  private mainAgent: MainAgent;
  private persistence: DocumentPersistence;
  private initialized: boolean = false;
  private usePythonExtractor: boolean;

  constructor(llmClient: LLMClient, options?: DocumentStoreOptions) {
    this.llmClient = llmClient;
    this.mainAgent = new MainAgent(llmClient);
    this.persistence = createDocumentPersistence(options?.dataDir);
    this.usePythonExtractor = options?.usePythonExtractor !== false; // Default to true
  }

  /**
   * Initialize the store by loading persisted documents
   * Must be called before the store is ready for use
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('Initializing document store...');
    const persistedDocs = await this.persistence.loadAllDocuments();
    
    for (const doc of persistedDocs) {
      this.documents.set(doc.id, doc);
    }
    
    this.initialized = true;
    console.log(`Document store initialized with ${this.documents.size} documents`);
  }

  /**
   * Check if the store is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  async upload(
    source: string | Buffer,
    options: {
      fileName?: string;
      groupingStrategy?: GroupingStrategy;
    } = {}
  ): Promise<StoredDocument> {
    // Use Python extractor for enhanced extraction
    const parser = createParser({ 
      usePythonExtractor: this.usePythonExtractor,
      outputDir: this.persistence.getDataDir(),
    });
    
    // Parse PDF - Python extractor returns all 3 grouping strategies
    const document = await parser.parse(source);
    
    // Get the Python extraction result with all groups
    let pythonResult: PythonExtractionResult | undefined;
    let groups: DocumentGroup[];
    
    if (this.usePythonExtractor && parser.lastPythonResult) {
      // For Python extractor, we get all groups from the result
      pythonResult = parser.lastPythonResult;
      
      // Convert Python groups to DocumentGroup[]
      groups = this.convertPythonGroups(pythonResult.groups, document);
    } else {
      // Fallback: Use old grouping logic
      const strategy = options.groupingStrategy || 'hybrid';
      
      if (strategy === 'fixed') {
        groups = this.createFixedGroups(document);
      } else {
        try {
          groups = await this.mainAgent.identifyGroups(document, strategy);
        } catch (error) {
          console.warn('LLM grouping failed, falling back to fixed groups:', error);
          groups = this.createFixedGroups(document);
        }
      }
    }

    // Analyze document type (optional, can fail gracefully)
    let documentType: string | undefined;
    try {
      const analysis = await this.mainAgent.analyzeDocument(document);
      documentType = analysis.documentType;
    } catch (error) {
      console.warn('Document analysis failed:', error);
    }

    const stored: StoredDocument = {
      id: document.id,
      document,
      groups,
      metadata: {
        uploadedAt: new Date(),
        fileName: options.fileName,
        groupingStrategy: options.groupingStrategy || 'hybrid',
        documentType,
        pdfType: document.pdfType,
      },
      pythonResult,
    };

    this.documents.set(stored.id, stored);
    
    // Persist to disk
    await this.persistence.saveDocument(stored);
    
    return stored;
  }

  /**
   * Convert Python group objects to TypeScript DocumentGroup[]
   */
  private convertPythonGroups(pythonGroups: PythonGroupObject[], document: PDFDocument): DocumentGroup[] {
    return pythonGroups.map((pg) => {
      // Get pages for this group
      const groupPages = document.pages.filter(
        (p) => p.number >= pg.start_page && p.number <= pg.end_page
      );

      return {
        id: pg.group_id,
        type: this.mapStrategy(pg.strategy),
        title: pg.title,
        startPage: pg.start_page,
        endPage: pg.end_page,
        pages: groupPages,
        fullText: pg.full_text,
        tables: pg.tables,
        imagePaths: pg.image_paths,
        metadata: {
          strategy: pg.strategy,
        },
      };
    });
  }

  /**
   * Map Python strategy string to TypeScript GroupingStrategy
   */
  private mapStrategy(strategy: string): GroupingStrategy {
    const strategyMap: Record<string, GroupingStrategy> = {
      toc: 'toc',
      heading: 'heading',
      range: 'fixed',
    };
    return strategyMap[strategy] || 'fixed';
  }

  /**
   * Get groups filtered by strategy
   */
  getGroupsByStrategy(documentId: string, strategy: 'toc' | 'heading' | 'range'): DocumentGroup[] {
    const doc = this.documents.get(documentId);
    if (!doc) return [];
    
    return doc.groups.filter((g) => {
      if (strategy === 'range') {
        return g.type === 'fixed';
      }
      return g.type === strategy;
    });
  }

  /**
   * Get all available strategies for a document
   */
  getAvailableStrategies(documentId: string): string[] {
    const doc = this.documents.get(documentId);
    if (!doc) return [];
    
    const strategies = new Set<string>();
    for (const group of doc.groups) {
      strategies.add(group.type);
    }
    return Array.from(strategies);
  }

  get(documentId: string): StoredDocument | undefined {
    return this.documents.get(documentId);
  }

  getGroup(documentId: string, groupId: string): DocumentGroup | undefined {
    const doc = this.documents.get(documentId);
    return doc?.groups.find(g => g.id === groupId);
  }

  list(): StoredDocument[] {
    return Array.from(this.documents.values());
  }

  async delete(documentId: string): Promise<boolean> {
    const existed = this.documents.delete(documentId);
    
    if (existed) {
      // Remove from persistence
      await this.persistence.deleteDocument(documentId);
    }
    
    return existed;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    documentCount: number;
    persistence: {
      documentCount: number;
      totalSizeBytes: number;
      dataDirectory: string;
    };
  }> {
    const persistenceStats = await this.persistence.getStats();
    
    return {
      documentCount: this.documents.size,
      persistence: persistenceStats,
    };
  }

  private createFixedGroups(document: PDFDocument): DocumentGroup[] {
    const pagesPerGroup = 10;
    const groups: DocumentGroup[] = [];
    const pages = document.pages;

    for (let i = 0; i < pages.length; i += pagesPerGroup) {
      const groupPages = pages.slice(i, Math.min(i + pagesPerGroup, pages.length));
      const startPage = i + 1;
      const endPage = Math.min(i + pagesPerGroup, pages.length);

      groups.push({
        id: uuidv4(),
        type: 'fixed',
        title: `Pages ${startPage}-${endPage}`,
        startPage,
        endPage,
        pages: groupPages,
        metadata: {
          groupIndex: Math.floor(i / pagesPerGroup),
        },
      });
    }

    return groups;
  }
}

export function createDocumentStore(llmClient: LLMClient, options?: DocumentStoreOptions): DocumentStore {
  return new DocumentStore(llmClient, options);
}