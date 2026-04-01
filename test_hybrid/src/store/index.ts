/**
 * Store module exports for persistent storage.
 */

// Primary persistent store (JSON-based, no external dependencies)
export { PersistentStore, createPersistentStore } from './persistent-store.js';
export type { PersistentStoreConfig, StoredChunk, PersistentIndexData } from './persistent-store.js';

// ChromaDB-based store (requires running ChromaDB server)
export { ChromaStore, createChromaStore } from './chroma-store.js';
export type { ChromaStoreConfig, StoredDocument } from './chroma-store.js';

// BM25 indexer
export { BM25Indexer } from './bm25-store.js';
export type { BM25Document, BM25IndexData } from './bm25-store.js';
