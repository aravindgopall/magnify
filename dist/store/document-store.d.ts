import type { PDFDocument, DocumentGroup, GroupingStrategy } from '../types/index.js';
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
    };
}
export interface QueryContext {
    documentId: string;
    groupIds?: string[];
    query: string;
    userId?: string;
}
export declare class DocumentStore {
    private documents;
    private llmClient;
    private mainAgent;
    constructor(llmClient: LLMClient);
    upload(source: string | Buffer, options?: {
        fileName?: string;
        groupingStrategy?: GroupingStrategy;
    }): Promise<StoredDocument>;
    get(documentId: string): StoredDocument | undefined;
    getGroup(documentId: string, groupId: string): DocumentGroup | undefined;
    list(): StoredDocument[];
    delete(documentId: string): boolean;
    private createFixedGroups;
}
export declare function createDocumentStore(llmClient: LLMClient): DocumentStore;
//# sourceMappingURL=document-store.d.ts.map