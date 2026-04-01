/**
 * Simple persistent storage for vector embeddings using local JSON files.
 * 
 * This provides persistent storage without requiring a running ChromaDB server.
 * Stores:
 * - Dense vector embeddings (JSON file)
 * - Raw chunk text and metadata (JSON file)
 * - BM25 sparse index (JSON file)
 */

import fs from 'fs';
import path from 'path';
import type { Chunk, DenseSearchResult } from '../types/index.js';
import { cosineSimilarity } from '../indexing/dense-index.js';
import { BM25Indexer } from './bm25-store.js';

export interface PersistentStoreConfig {
  dataDir?: string;
  collectionName?: string;
}

export interface StoredChunk {
  id: string;
  documentId: string;
  text: string;
  embedding: number[];
  tokenCount: number;
  position: number;
  metadata: Record<string, unknown>;
}

export interface PersistentIndexData {
  chunks: StoredChunk[];
  embeddingModel: string;
  dimensions: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persistent storage using local JSON files.
 */
export class PersistentStore {
  private dataDir: string;
  private collectionName: string;
  private chunks: Map<string, StoredChunk> = new Map();
  private bm25Indexer: BM25Indexer;
  private embeddingModel: string = 'BAAI/bge-m3';
  private dimensions: number = 1024;
  private initialized = false;

  constructor(config: PersistentStoreConfig = {}) {
    this.dataDir = config.dataDir || './data';
    this.collectionName = config.collectionName || 'default';
    this.bm25Indexer = new BM25Indexer();
  }

  /**
   * Initialize the store - load from disk if exists.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Load chunks with embeddings
    const indexPath = this.getIndexPath();
    if (fs.existsSync(indexPath)) {
      try {
        const data: PersistentIndexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        
        this.embeddingModel = data.embeddingModel || this.embeddingModel;
        this.dimensions = data.dimensions || this.dimensions;
        
        for (const chunk of data.chunks || []) {
          this.chunks.set(chunk.id, chunk);
        }
        
        console.log(`Loaded ${this.chunks.size} chunks from ${indexPath}`);
      } catch (error: any) {
        console.warn(`Failed to load index: ${error.message}`);
      }
    }

    // Load BM25 index
    const bm25Path = this.getBM25Path();
    if (fs.existsSync(bm25Path)) {
      try {
        const bm25Data = JSON.parse(fs.readFileSync(bm25Path, 'utf-8'));
        this.bm25Indexer.loadFromJSON(bm25Data);
        console.log(`Loaded BM25 index from ${bm25Path}`);
      } catch (error: any) {
        console.warn(`Failed to load BM25 index: ${error.message}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Get the path to the index file.
   */
  private getIndexPath(): string {
    return path.join(this.dataDir, `${this.collectionName}-index.json`);
  }

  /**
   * Get the path to the BM25 index file.
   */
  private getBM25Path(): string {
    return path.join(this.dataDir, `${this.collectionName}-bm25.json`);
  }

  /**
   * Add chunks with embeddings to the store.
   */
  async addChunks(
    chunks: Chunk[],
    embeddings: number[][]
  ): Promise<void> {
    if (!this.initialized) await this.initialize();

    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings must have the same length');
    }

    // Add chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      const storedChunk: StoredChunk = {
        id: chunk.id,
        documentId: chunk.documentId,
        text: chunk.text,
        embedding,
        tokenCount: chunk.tokenCount,
        position: chunk.position,
        metadata: chunk.metadata,
      };

      this.chunks.set(chunk.id, storedChunk);
      
      // Update dimensions if first chunk
      if (this.chunks.size === 1) {
        this.dimensions = embedding.length;
      }

      // Add to BM25
      this.bm25Indexer.addDocument(chunk.id, chunk.text);
    }

    // Persist to disk
    await this.persist();
  }

  /**
   * Search dense vectors using cosine similarity.
   */
  async searchDense(
    queryEmbedding: number[],
    topK: number = 50
  ): Promise<DenseSearchResult[]> {
    if (!this.initialized) await this.initialize();

    const scores: Array<{ chunkId: string; score: number }> = [];

    // Calculate similarity with all stored embeddings
    for (const [chunkId, chunk] of this.chunks) {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      scores.push({ chunkId, score: similarity });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top-k results
    return scores.slice(0, topK).map((result) => {
      const chunk = this.chunks.get(result.chunkId)!;
      return {
        chunkId: result.chunkId,
        score: result.score,
        text: chunk.text,
        metadata: chunk.metadata,
      };
    });
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
  async getChunk(chunkId: string): Promise<StoredChunk | null> {
    if (!this.initialized) await this.initialize();
    return this.chunks.get(chunkId) || null;
  }

  /**
   * Get all chunks.
   */
  async getAllChunks(): Promise<StoredChunk[]> {
    if (!this.initialized) await this.initialize();
    return Array.from(this.chunks.values());
  }

  /**
   * Delete a chunk by ID.
   */
  async deleteChunk(chunkId: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    const existed = this.chunks.delete(chunkId);
    if (existed) {
      this.bm25Indexer.removeDocument(chunkId);
      await this.persist();
    }
    return existed;
  }

  /**
   * Delete all chunks for a document.
   */
  async deleteDocument(documentId: string): Promise<number> {
    if (!this.initialized) await this.initialize();

    let deleted = 0;
    for (const [chunkId, chunk] of this.chunks) {
      if (chunk.documentId === documentId) {
        this.chunks.delete(chunkId);
        this.bm25Indexer.removeDocument(chunkId);
        deleted++;
      }
    }

    if (deleted > 0) {
      await this.persist();
    }
    return deleted;
  }

  /**
   * Get store statistics.
   */
  async getStats(): Promise<{
    totalChunks: number;
    dimensions: number;
    embeddingModel: string;
    bm25Stats: ReturnType<BM25Indexer['getStats']>;
  }> {
    if (!this.initialized) await this.initialize();

    return {
      totalChunks: this.chunks.size,
      dimensions: this.dimensions,
      embeddingModel: this.embeddingModel,
      bm25Stats: this.bm25Indexer.getStats(),
    };
  }

  /**
   * Persist to disk.
   */
  private async persist(): Promise<void> {
    // Ensure directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Save chunks with embeddings
    const indexData: PersistentIndexData = {
      chunks: Array.from(this.chunks.values()),
      embeddingModel: this.embeddingModel,
      dimensions: this.dimensions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(this.getIndexPath(), JSON.stringify(indexData, null, 2));

    // Save BM25 index
    const bm25Data = this.bm25Indexer.toJSON();
    fs.writeFileSync(this.getBM25Path(), JSON.stringify(bm25Data, null, 2));

    console.log(`Persisted ${this.chunks.size} chunks to ${this.getIndexPath()}`);
  }

  /**
   * Clear all data from the store.
   */
  async clear(): Promise<void> {
    this.chunks.clear();
    this.bm25Indexer.clear();
    
    // Delete files
    const indexPath = this.getIndexPath();
    const bm25Path = this.getBM25Path();
    
    if (fs.existsSync(indexPath)) {
      fs.unlinkSync(indexPath);
    }
    if (fs.existsSync(bm25Path)) {
      fs.unlinkSync(bm25Path);
    }
  }

  /**
   * Get the embedding model name.
   */
  getEmbeddingModel(): string {
    return this.embeddingModel;
  }

  /**
   * Set the embedding model name.
   */
  setEmbeddingModel(model: string): void {
    this.embeddingModel = model;
  }

  /**
   * Get embedding dimensions.
   */
  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * Create a persistent store.
 */
export function createPersistentStore(config?: PersistentStoreConfig): PersistentStore {
  return new PersistentStore(config);
}