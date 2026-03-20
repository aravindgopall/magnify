import { v4 as uuidv4 } from 'uuid';
import type { PDFDocument, DocumentGroup, GroupingStrategy } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
import { createParser } from '../parser/index.js';
import { MainAgent } from '../llm/main-agent.js';

export interface StoredDocument {
  id: string;
  document: PDFDocument;
  groups: DocumentGroup[];
  metadata: {
    uploadedAt: Date;
    fileName?: string;
    groupingStrategy: GroupingStrategy;
    documentType?: string;
  };
}

export interface QueryContext {
  documentId: string;
  groupIds?: string[];
  query: string;
  userId?: string;
}

export class DocumentStore {
  private documents: Map<string, StoredDocument> = new Map();
  private llmClient: LLMClient;
  private mainAgent: MainAgent;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
    this.mainAgent = new MainAgent(llmClient);
  }

  async upload(
    source: string | Buffer,
    options: {
      fileName?: string;
      groupingStrategy?: GroupingStrategy;
    } = {}
  ): Promise<StoredDocument> {
    const parser = createParser();
    const document = await parser.parse(source);
    
    const strategy = options.groupingStrategy || 'hybrid';
    let groups: DocumentGroup[];

    if (strategy === 'fixed') {
      groups = this.createFixedGroups(document);
    } else {
      groups = await this.mainAgent.identifyGroups(document, strategy);
    }

    const analysis = await this.mainAgent.analyzeDocument(document);

    const stored: StoredDocument = {
      id: document.id,
      document,
      groups,
      metadata: {
        uploadedAt: new Date(),
        fileName: options.fileName,
        groupingStrategy: strategy,
        documentType: analysis.documentType,
      },
    };

    this.documents.set(stored.id, stored);
    return stored;
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

  delete(documentId: string): boolean {
    return this.documents.delete(documentId);
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

export function createDocumentStore(llmClient: LLMClient): DocumentStore {
  return new DocumentStore(llmClient);
}