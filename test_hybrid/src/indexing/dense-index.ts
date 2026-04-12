import type { Chunk, DenseSearchResult, DenseIndex } from '../types/index.js';

/**
 * Simple cosine similarity calculation.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Dense vector index for semantic search.
 * Stores embeddings and supports similarity search.
 */
export class DenseIndexer {
  private index: DenseIndex;
  private chunkStore: Map<string, Chunk>;
  private embeddingModel: string;

  constructor(dimensions: number = 1024, model: string = 'BAAI/bge-m3') {
    this.index = {
      embeddings: new Map(),
      model,
      dimensions,
    };
    this.chunkStore = new Map();
    this.embeddingModel = model;
  }

  /**
   * Add a chunk with its embedding to the index.
   */
  addEmbedding(chunk: Chunk, embedding: number[]): void {
    if (embedding.length !== this.index.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.index.dimensions}, got ${embedding.length}`
      );
    }

    this.index.embeddings.set(chunk.id, embedding);
    this.chunkStore.set(chunk.id, chunk);
  }

  /**
   * Add multiple embeddings at once.
   */
  addEmbeddings(items: Array<{ chunk: Chunk; embedding: number[] }>): void {
    for (const { chunk, embedding } of items) {
      this.addEmbedding(chunk, embedding);
    }
  }

  /**
   * Remove a chunk from the index.
   */
  removeEmbedding(chunkId: string): boolean {
    const existed = this.index.embeddings.delete(chunkId);
    this.chunkStore.delete(chunkId);
    return existed;
  }

  /**
   * Search for similar vectors.
   * Returns top-k results sorted by similarity score.
   */
  search(queryEmbedding: number[], topK: number = 50): DenseSearchResult[] {
    if (queryEmbedding.length !== this.index.dimensions) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.index.dimensions}, got ${queryEmbedding.length}`
      );
    }

    const scores: Array<{ chunkId: string; score: number }> = [];

    // Calculate similarity with all stored embeddings
    for (const [chunkId, embedding] of this.index.embeddings) {
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      scores.push({ chunkId, score: similarity });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top-k results
    return scores.slice(0, topK).map((result) => {
      const chunk = this.chunkStore.get(result.chunkId)!;
      return {
        chunkId: result.chunkId,
        score: result.score,
        text: chunk.text,
        metadata: chunk.metadata,
        embedding: this.index.embeddings.get(result.chunkId),
      };
    });
  }

  /**
   * Get embedding for a specific chunk.
   */
  getEmbedding(chunkId: string): number[] | undefined {
    return this.index.embeddings.get(chunkId);
  }

  /**
   * Get chunk by ID.
   */
  getChunk(chunkId: string): Chunk | undefined {
    return this.chunkStore.get(chunkId);
  }

  /**
   * Get index statistics.
   */
  getStats(): {
    totalVectors: number;
    dimensions: number;
    model: string;
  } {
    return {
      totalVectors: this.index.embeddings.size,
      dimensions: this.index.dimensions,
      model: this.index.model,
    };
  }

  /**
   * Clear the index.
   */
  clear(): void {
    this.index.embeddings.clear();
    this.chunkStore.clear();
  }

  /**
   * Get all chunks.
   */
  getAllChunks(): Chunk[] {
    return Array.from(this.chunkStore.values());
  }

  /**
   * Export index for persistence.
   */
  export(): {
    embeddings: Array<[string, number[]]>;
    dimensions: number;
    model: string;
    chunks: Array<[string, { text: string; metadata: Record<string, unknown> }]>;
  } {
    return {
      embeddings: Array.from(this.index.embeddings.entries()),
      dimensions: this.index.dimensions,
      model: this.index.model,
      chunks: Array.from(this.chunkStore.entries()).map(([id, chunk]) => [
        id,
        { text: chunk.text, metadata: chunk.metadata as Record<string, unknown> },
      ]),
    };
  }
}

/**
 * Create a dense indexer.
 */
export function createDenseIndexer(dimensions?: number, model?: string): DenseIndexer {
  return new DenseIndexer(dimensions, model);
}

/**
 * Embedding provider interface.
 * Implement this to use different embedding models.
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  embedSingle(text: string): Promise<number[]>;
  getDimensions(): number;
  getModel(): string;
}

/**
 * Mock embedding provider for testing.
 * Returns random vectors - replace with actual embedding API in production.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;

  constructor(dimensions: number = 1024) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => this.randomVector());
  }

  async embedSingle(text: string): Promise<number[]> {
    return this.randomVector();
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return 'mock-embedding-model';
  }

  private randomVector(): number[] {
    // Generate normalized random vector
    const vector: number[] = [];
    let norm = 0;

    for (let i = 0; i < this.dimensions; i++) {
      const val = Math.random() * 2 - 1; // Random value between -1 and 1
      vector.push(val);
      norm += val * val;
    }

    // Normalize
    norm = Math.sqrt(norm);
    return vector.map((v) => v / norm);
  }
}

/**
 * BGE-M3 Embedding Provider using HuggingFace Inference API.
 * BGE-M3 is a powerful open-source embedding model with 1024 dimensions.
 * Model: https://huggingface.co/BAAI/bge-m3
 * 
 * Note: BGE-M3 is registered as a sentence-similarity pipeline on HuggingFace,
 * so we use the explicit feature-extraction pipeline endpoint.
 */
export class BGEM3EmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private baseUrl: string;

  constructor(options: {
    apiKey?: string;
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'BAAI/bge-m3';
    this.dimensions = options.dimensions || 1024;
    // Use HuggingFace Inference Endpoints - new router format
    this.baseUrl = options.baseUrl || 'https://router.huggingface.co/hf-inference/models';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const embeddings: number[][] = [];
    
    // Process each text individually using the HuggingFace feature-extraction pipeline
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/${this.model}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          inputs: text,
          options: {
            wait_for_model: true
          }
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `BGE-M3 Embedding API error: ${error}\n` +
          `Try using --provider openai or --provider mock instead.`
        );
      }

      const data = await response.json();
      
      // Handle the response - extract embedding from response
      // BGE-M3 via feature-extraction returns embeddings in various shapes
      if (Array.isArray(data)) {
        if (typeof data[0] === 'number') {
          // Flat embedding: [1024]
          embeddings.push(data as unknown as number[]);
        } else if (Array.isArray(data[0])) {
          if (Array.isArray(data[0][0])) {
            // 3D: [1, seq_len, 1024] - take first or mean pool
            const tokenEmbeddings = data[0] as number[][];
            embeddings.push(this.meanPool(tokenEmbeddings));
          } else {
            // 2D: [seq_len, 1024] - mean pool
            embeddings.push(this.meanPool(data as number[][]));
          }
        }
      } else {
        throw new Error(`Unexpected response format from BGE-M3 API: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }
    
    return embeddings;
  }

  /**
   * Mean pool token embeddings to get a single sentence embedding.
   */
  private meanPool(tokenEmbeddings: number[][]): number[] {
    if (tokenEmbeddings.length === 0) return [];
    
    const dims = tokenEmbeddings[0].length;
    const result = new Array(dims).fill(0);
    
    for (const token of tokenEmbeddings) {
      for (let i = 0; i < dims; i++) {
        result[i] += token[i];
      }
    }
    
    // Average
    for (let i = 0; i < dims; i++) {
      result[i] /= tokenEmbeddings.length;
    }
    
    return result;
  }

  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0];
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return this.model;
  }
}

/**
 * Local BGE-M3 Embedding Provider using the FlagEmbedding server.
 * 
 * This provider connects to a local embedding server that uses the official
 * FlagEmbedding library for best results. The server provides both dense
 * and sparse embeddings.
 * 
 * To start the server:
 *   python scripts/embedding_server.py
 * 
 * The server runs on http://localhost:8002 by default.
 */
export class LocalBGEM3Provider implements EmbeddingProvider {
  private baseUrl: string;
  private dimensions: number;
  private model: string;

  constructor(options: {
    baseUrl: string;
    dimensions?: number;
    model?: string;
  }) {
    this.baseUrl = options.baseUrl;
    this.dimensions = options.dimensions || 1024;
    this.model = options.model || 'BAAI/bge-m3';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        texts,
        return_dense: true,
        return_sparse: false,
        return_colbert_vecs: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Local BGE-M3 API error: ${error}\n` +
        `Make sure the embedding server is running: python scripts/embedding_server.py`
      );
    }

    const data = await response.json();
    return data.embeddings;
  }

  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0];
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return this.model;
  }
}

/**
 * Create an embedding provider based on environment configuration.
 */
export function createEmbeddingProvider(options?: {
  type?: 'mock' | 'bge-m3' | 'local-bge-m3';
  apiKey?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}): EmbeddingProvider {
  const type = options?.type || 'bge-m3';

  switch (type) {
    case 'bge-m3':
      return new BGEM3EmbeddingProvider({
        apiKey: options?.apiKey,
        model: options?.model,
        dimensions: options?.dimensions,
        baseUrl: options?.baseUrl,
      });

    case 'local-bge-m3':
      if (!options?.baseUrl) {
        throw new Error('baseUrl is required for local BGE-M3 provider');
      }
      return new LocalBGEM3Provider({
        baseUrl: options.baseUrl,
        model: options.model,
        dimensions: options.dimensions,
      });

    case 'mock':
    default:
      return new MockEmbeddingProvider(options?.dimensions ?? 1024);
  }
}
