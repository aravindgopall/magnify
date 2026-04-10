/**
 * Store module exports for persistent storage.
 */

// Primary persistent store (JSON-based, no external dependencies)
export { PersistentStore, createPersistentStore } from './persistent-store.js';
export type { PersistentStoreConfig, StoredChunk, PersistentIndexData } from './persistent-store.js';

// BM25 indexer (uses FlexSearch, consistent with indexing/bm25-index.ts)
export { BM25Indexer } from './bm25-store.js';
export type { BM25Document, BM25IndexData } from './bm25-store.js';