import fs from 'fs';
import path from 'path';
import type { StoredDocument } from './document-store.js';

/**
 * File-based persistence layer for document storage
 * Stores documents as JSON files in a dedicated directory
 */
export class DocumentPersistence {
  private dataDir: string;

  constructor(dataDir?: string) {
    // Default to 'data' directory in project root
    this.dataDir = dataDir || path.join(process.cwd(), 'data');
    this.ensureDataDirectory();
  }

  /**
   * Ensure the data directory exists
   */
  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      console.log(`Created data directory: ${this.dataDir}`);
    }
  }

  /**
   * Get the file path for a document
   */
  private getDocumentPath(documentId: string): string {
    return path.join(this.dataDir, `${documentId}.json`);
  }

  /**
   * Save a document to disk
   */
  async saveDocument(document: StoredDocument): Promise<void> {
    const filePath = this.getDocumentPath(document.id);
    const data = JSON.stringify(document, null, 2);
    
    await fs.promises.writeFile(filePath, data, 'utf-8');
    console.log(`Saved document: ${document.id}`);
  }

  /**
   * Load a document from disk
   */
  async loadDocument(documentId: string): Promise<StoredDocument | null> {
    const filePath = this.getDocumentPath(documentId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      const document = JSON.parse(data) as StoredDocument;
      
      // Restore Date objects
      document.metadata.uploadedAt = new Date(document.metadata.uploadedAt);
      
      return document;
    } catch (error) {
      console.error(`Error loading document ${documentId}:`, error);
      return null;
    }
  }

  /**
   * Delete a document from disk
   */
  async deleteDocument(documentId: string): Promise<boolean> {
    const filePath = this.getDocumentPath(documentId);
    
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      await fs.promises.unlink(filePath);
      console.log(`Deleted document: ${documentId}`);
      return true;
    } catch (error) {
      console.error(`Error deleting document ${documentId}:`, error);
      return false;
    }
  }

  /**
   * List all document IDs in storage
   */
  async listDocumentIds(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.dataDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.basename(file, '.json'));
    } catch (error) {
      console.error('Error listing documents:', error);
      return [];
    }
  }

  /**
   * Load all documents from disk
   */
  async loadAllDocuments(): Promise<StoredDocument[]> {
    const ids = await this.listDocumentIds();
    const documents: StoredDocument[] = [];

    for (const id of ids) {
      const doc = await this.loadDocument(id);
      if (doc) {
        documents.push(doc);
      }
    }

    console.log(`Loaded ${documents.length} documents from persistence`);
    return documents;
  }

  /**
   * Check if a document exists
   */
  documentExists(documentId: string): boolean {
    const filePath = this.getDocumentPath(documentId);
    return fs.existsSync(filePath);
  }

  /**
   * Get the data directory path
   */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Get storage stats
   */
  async getStats(): Promise<{
    documentCount: number;
    totalSizeBytes: number;
    dataDirectory: string;
  }> {
    const ids = await this.listDocumentIds();
    let totalSize = 0;

    for (const id of ids) {
      const filePath = this.getDocumentPath(id);
      try {
        const stats = await fs.promises.stat(filePath);
        totalSize += stats.size;
      } catch {
        // Ignore errors for individual files
      }
    }

    return {
      documentCount: ids.length,
      totalSizeBytes: totalSize,
      dataDirectory: this.dataDir,
    };
  }
}

/**
 * Create a persistence instance
 */
export function createDocumentPersistence(dataDir?: string): DocumentPersistence {
  return new DocumentPersistence(dataDir);
}