/**
 * ChromaDB-based persistent storage for vector embeddings.
 * 
 * This module provides persistent storage of:
 * - Dense vector embeddings (via ChromaDB)
 * - Raw chunk text and metadata (via ChromaDB documents)
 * - BM25 sparse index (via JSON file)
 */

import { ChromaClient, Collection, IncludeEnum } from 'chromadb';
import type { Chunk, DenseSearchResult } from '../types/index.js';
import { BM25Indexer } from './bm25-store.js';
import fs from 'fs';
import path from 'path';

export interface ChromaStoreConfig {
  chromaUrl?: string; // e.g., 'http://localhost:8000'
  collectionName?: string;
  dataDir?: string;
}

export interface StoredDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * Persistent storage using ChromaDB for vectors and JSON for BM25.
 */
export class ChromaStore {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private collectionName: string;
  private bm25Indexer: BM25Indexer;
  private dataDir: string;
  private initialized = false;

  constructor(config: ChromaStoreConfig = {}) {
    const chromaUrl = config.chromaUrl || 'http://localhost:8000';
    this.client = new ChromaClient({ path: chromaUrl });
    this.collectionName = config.collectionName || 'hybrid_search_chunks';
    this.dataDir = config.dataDir || './data';
    this.bm25Indexer = new BM25Indexer();
  }

  /**
   * Initialize the store - connect to ChromaDB and create/load collection.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get or create the collection
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        metadata: { description: 'Hybrid search chunks with dense embeddings' },
      });

      // Load BM25 index from disk if exists
      const bm25Path = path.join(this.dataDir, 'bm25-index.json');
      if (fs.existsSync(bm25Path)) {
        const bm25Data = JSON.parse(fs.readFileSync(bm25Path, 'utf-8'));
        this.bm25Indexer.loadFromJSON(bm25Data);
      }

      this.initialized = true;
    } catch (error: any) {
      throw new Error(`Failed to initialize ChromaDB: ${error.message}`);
    }
  }

  /**
   * Add chunks with embeddings to the store.
   */
  async addChunks(
    chunks: Chunk[],
    embeddings: number[][]
  ): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings must have the same length');
    }

    // Add to ChromaDB
    const ids = chunks.map(c => c.id);
    const documents = chunks.map(c => c.text);
    const metadatas = chunks.map(c => ({
      ...c.metadata,
      documentId: c.documentId,
      tokenCount: c.tokenCount,
      position: c.position,
    }));

    await this.collection.add({
      ids,
      embeddings,
      documents,
      metadatas,
    });

    // Add to BM25 index
    for (let i = 0; i < chunks.length; i++) {
      this.bm25Indexer.addDocument(chunks[i].id, chunks[i].text);
    }

    // Persist BM25 index
    await this.persistBM25();
  }

  /**
   * Search dense vectors using ChromaDB.
   */
  async searchDense(
    queryEmbedding: number[],
    topK: number = 50
  ): Promise<DenseSearchResult[]> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    const results = await this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: [
        IncludeEnum.Distances,
        IncludeEnum.Documents,
        IncludeEnum.Metadatas,
      ],
    });

    const searchResults: DenseSearchResult[] = [];

    if (results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0][i];
        const distance = results.distances?.[0]?.[i] ?? 0;
        const text = results.documents?.[0]?.[i] ?? '';
        const metadata = results.metadatas?.[0]?.[i] ?? {};

        // Convert distance to similarity (cosine distance to similarity)
        // ChromaDB returns cosine distance, so similarity = 1 - distance
        const score = 1 - distance;

        searchResults.push({
          chunkId: id,
          score,
          text,
          metadata,
        });
      }
    }

    return searchResults;
  }

  /**
   * Search using BM25 sparse index.
   */
  searchSparse(query: string, topK: number = 50): Array<{ chunkId: string; score: number; text: string }> {
    return this.bm25Indexer.search(query, topK);
  }

  /**
   * Get a specific chunk by ID.
   */
  async getChunk(chunkId: string): Promise<StoredDocument | null> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    const results = await this.collection.get({
      ids: [chunkId],
      include: [IncludeEnum.Documents, IncludeEnum.Embeddings, IncludeEnum.Metadatas],
    });

    if (!results.ids[0]) return null;

    return {
      id: results.ids[0],
      text: results.documents?.[0] ?? '',
      embedding: results.embeddings?.[0] ?? [],
      metadata: results.metadatas?.[0] ?? {},
    };
  }

  /**
   * Get all chunks (for reindexing or export).
   */
  async getAllChunks(): Promise<StoredDocument[]> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    const results = await this.collection.get({
      include: [IncludeEnum.Documents, IncludeEnum.Embeddings, IncludeEnum.Metadatas],
    });

    const chunks: StoredDocument[] = [];
    for (let i = 0; i < results.ids.length; i++) {
      chunks.push({
        id: results.ids[i],
        text: results.documents?.[i] ?? '',
        embedding: results.embeddings?.[i] ?? [],
        metadata: results.metadatas?.[i] ?? {},
      });
    }

    return chunks;
  }

  /**
   * Delete a chunk by ID.
   */
  async deleteChunk(chunkId: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    await this.collection.delete({ ids: [chunkId] });
    this.bm25Indexer.removeDocument(chunkId);
    await this.persistBM25();

    return true;
  }

  /**
   * Delete all chunks for a document.
   */
  async deleteDocument(documentId: string): Promise<number> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    // Get all chunks for this document
    const results = await this.collection.get({
      where: { documentId },
    });

    if (results.ids.length === 0) return 0;

    // Delete from ChromaDB
    await this.collection.delete({ ids: results.ids });

    // Delete from BM25
    for (const id of results.ids) {
      this.bm25Indexer.removeDocument(id);
    }
    await this.persistBM25();

    return results.ids.length;
  }

  /**
   * Get store statistics.
   */
  async getStats(): Promise<{
    totalChunks: number;
    collectionName: string;
    bm25Stats: ReturnType<BM25Indexer['getStats']>;
  }> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    const count = await this.collection.count();

    return {
      totalChunks: count,
      collectionName: this.collectionName,
      bm25Stats: this.bm25Indexer.getStats(),
    };
  }

  /**
   * Persist BM25 index to disk.
   */
  private async persistBM25(): Promise<void> {
    const bm25Path = path.join(this.dataDir, 'bm25-index.json');
    
    // Ensure directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const bm25Data = this.bm25Indexer.toJSON();
    fs.writeFileSync(bm25Path, JSON.stringify(bm25Data, null, 2));
  }

  /**
   * Clear all data from the store.
   */
  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (!this.collection) throw new Error('Collection not initialized');

    // Delete and recreate collection
    await this.client.deleteCollection({ name: this.collectionName });
    this.collection = await this.client.createCollection({
      name: this.collectionName,
      metadata: { description: 'Hybrid search chunks with dense embeddings' },
    });

    // Clear BM25
    this.bm25Indexer.clear();
    await this.persistBM25();
  }
}

/**
 * Create a ChromaDB store.
 */
export function createChromaStore(config?: ChromaStoreConfig): ChromaStore {
  return new ChromaStore(config);
}