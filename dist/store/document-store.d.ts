import type { PDFDocument, DocumentGroup, GroupingStrategy, PythonExtractionResult } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
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
export declare class DocumentStore {
    private documents;
    private llmClient;
    private mainAgent;
    private persistence;
    private initialized;
    private usePythonExtractor;
    constructor(llmClient: LLMClient, options?: DocumentStoreOptions);
    /**
     * Initialize the store by loading persisted documents
     * Must be called before the store is ready for use
     */
    initialize(): Promise<void>;
    /**
     * Check if the store is initialized
     */
    isInitialized(): boolean;
    upload(source: string | Buffer, options?: {
        fileName?: string;
        groupingStrategy?: GroupingStrategy;
    }): Promise<StoredDocument>;
    /**
     * Convert Python group objects to TypeScript DocumentGroup[]
     */
    private convertPythonGroups;
    /**
     * Map Python strategy string to TypeScript GroupingStrategy
     */
    private mapStrategy;
    /**
     * Get groups filtered by strategy
     */
    getGroupsByStrategy(documentId: string, strategy: 'toc' | 'heading' | 'range'): DocumentGroup[];
    /**
     * Get all available strategies for a document
     */
    getAvailableStrategies(documentId: string): string[];
    get(documentId: string): StoredDocument | undefined;
    getGroup(documentId: string, groupId: string): DocumentGroup | undefined;
    list(): StoredDocument[];
    delete(documentId: string): Promise<boolean>;
    /**
     * Get storage statistics
     */
    getStats(): Promise<{
        documentCount: number;
        persistence: {
            documentCount: number;
            totalSizeBytes: number;
            dataDirectory: string;
        };
    }>;
    private createFixedGroups;
}
export declare function createDocumentStore(llmClient: LLMClient, options?: DocumentStoreOptions): DocumentStore;
//# sourceMappingURL=document-store.d.ts.map