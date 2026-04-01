import type { StoredDocument } from './document-store.js';
/**
 * File-based persistence layer for document storage
 * Stores documents as JSON files in a dedicated directory
 */
export declare class DocumentPersistence {
    private dataDir;
    constructor(dataDir?: string);
    /**
     * Ensure the data directory exists
     */
    private ensureDataDirectory;
    /**
     * Get the file path for a document
     */
    private getDocumentPath;
    /**
     * Save a document to disk
     */
    saveDocument(document: StoredDocument): Promise<void>;
    /**
     * Load a document from disk
     */
    loadDocument(documentId: string): Promise<StoredDocument | null>;
    /**
     * Delete a document from disk
     */
    deleteDocument(documentId: string): Promise<boolean>;
    /**
     * List all document IDs in storage
     */
    listDocumentIds(): Promise<string[]>;
    /**
     * Load all documents from disk
     */
    loadAllDocuments(): Promise<StoredDocument[]>;
    /**
     * Check if a document exists
     */
    documentExists(documentId: string): boolean;
    /**
     * Get the data directory path
     */
    getDataDir(): string;
    /**
     * Get storage stats
     */
    getStats(): Promise<{
        documentCount: number;
        totalSizeBytes: number;
        dataDirectory: string;
    }>;
}
/**
 * Create a persistence instance
 */
export declare function createDocumentPersistence(dataDir?: string): DocumentPersistence;
//# sourceMappingURL=persistence.d.ts.map