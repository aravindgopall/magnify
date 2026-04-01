#!/usr/bin/env node
/**
 * CLI script to query the hybrid search system.
 * 
 * Usage:
 *   npm run query -- "your question" [options]
 *   tsx src/cli/query.ts "your question" [options]
 * 
 * Options:
 *   --provider <type>   Embedding provider: bge-m3 | local-bge-m3 | openai | mock
 *   --data-dir <dir>    Data directory (default: ./data)
 *   --max-hops <n>      Maximum multi-hop iterations (default: 3)
 *   --subagents <n>     Number of parallel subagents (default: 4)
 *   --top-k <n>         Top K results (default: 50)
 *   --format <type>     Output format: text | json (default: text)
 * 
 * Examples:
 *   npm run query -- "What is the main topic of the document?"
 *   npm run query -- "Summarize the key findings" --max-hops 5
 *   npm run query -- "What are the recommendations?" --format json
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createHybridSearchAgent } from '../agent/hybrid-search-agent.js';
import { createHybridIndexer } from '../indexing/hybrid-index.js';
import { createEmbeddingProvider } from '../indexing/dense-index.js';
import { createDocument } from '../indexing/chunker.js';
import type { HybridSearchConfig, Chunk, QueryResponse } from '../types/index.js';
import { DEFAULT_HYBRID_SEARCH_CONFIG } from '../types/index.js';

// Parse command line arguments
function parseArgs(): {
  query: string;
  provider: 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock' | 'bm25-only';
  dataDir: string;
  maxHops: number;
  subagents: number;
  topK: number;
  format: 'text' | 'json';
} {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: npm run query -- "your question" [options]

Arguments:
  "query"              Your question to search for

Options:
  --provider <type>    Embedding provider: bge-m3 | local-bge-m3 | openai | mock | bm25-only
                       - bm25-only: Uses keyword search only (no embeddings needed)
                       - mock: Random embeddings (for testing)
  --data-dir <dir>     Data directory (default: ./data)
  --max-hops <n>       Maximum multi-hop iterations (default: 3)
  --subagents <n>      Number of parallel subagents (default: 4)
  --top-k <n>          Top K results (default: 50)
  --format <type>      Output format: text | json (default: text)

Examples:
  npm run query -- "What is the main topic of the document?" --provider bm25-only
  npm run query -- "Summarize the key findings" --max-hops 5
  npm run query -- "What are the recommendations?" --format json
`);
    process.exit(0);
  }

  let query = '';
  let provider: 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock' | 'bm25-only' = 'bm25-only';
  let dataDir = './data';
  let maxHops = 3;
  let subagents = 4;
  let topK = 50;
  let format: 'text' | 'json' = 'text';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider') {
      provider = args[++i] as 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock' | 'bm25-only';
    } else if (args[i] === '--data-dir') {
      dataDir = args[++i];
    } else if (args[i] === '--max-hops') {
      maxHops = parseInt(args[++i], 10);
    } else if (args[i] === '--subagents') {
      subagents = parseInt(args[++i], 10);
    } else if (args[i] === '--top-k') {
      topK = parseInt(args[++i], 10);
    } else if (args[i] === '--format') {
      format = args[++i] as 'text' | 'json';
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  if (!query) {
    console.error('Error: Query is required');
    process.exit(1);
  }

  return { query, provider, dataDir, maxHops, subagents, topK, format };
}

// Load existing index from disk (with embeddings if available)
async function loadIndex(dataDir: string): Promise<{ 
  chunks: Chunk[]; 
  embeddings: number[][] | null;
  hasEmbeddings: boolean;
} | null> {
  // Try both default-index.json and index.json
  const indexPaths = [
    path.join(dataDir, 'default-index.json'),
    path.join(dataDir, 'index.json'),
  ];
  
  for (const indexPath of indexPaths) {
    if (fs.existsSync(indexPath)) {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      
      const chunks: Chunk[] = [];
      const embeddings: number[][] = [];
      let hasEmbeddings = false;
      
      // Handle both array formats:
      // 1. Array of objects: [{id, documentId, text, embedding, ...}, ...]
      // 2. Array of tuples: [[id, {text, ...}], ...]
      if (data.chunks && Array.isArray(data.chunks)) {
        for (const item of data.chunks) {
          if (Array.isArray(item)) {
            // Tuple format: [chunkId, chunkData]
            const [chunkId, chunkData] = item;
            chunks.push({
              id: chunkId,
              documentId: chunkData.documentId,
              text: chunkData.text,
              tokenCount: chunkData.tokenCount,
              position: chunkData.position,
              metadata: chunkData.metadata,
            });
            // Tuple format doesn't have embeddings in our case
          } else if (item && typeof item === 'object' && item.id) {
            // Object format: {id, documentId, text, embedding, ...}
            chunks.push({
              id: item.id,
              documentId: item.documentId,
              text: item.text,
              tokenCount: item.tokenCount,
              position: item.position,
              metadata: item.metadata,
            });
            
            // Check if embedding exists and is valid
            if (item.embedding && Array.isArray(item.embedding) && item.embedding.length > 0) {
              embeddings.push(item.embedding);
              hasEmbeddings = true;
            }
          }
        }
      }
      
      console.log(`Loaded from: ${indexPath}`);
      return { 
        chunks, 
        embeddings: hasEmbeddings ? embeddings : null,
        hasEmbeddings 
      };
    }
  }
  
  return null;
}

// Format output for text display
function formatTextOutput(response: QueryResponse): string {
  const lines: string[] = [];
  
  lines.push('='.repeat(70));
  lines.push('ANSWER');
  lines.push('='.repeat(70));
  lines.push('');
  lines.push(response.answer);
  lines.push('');
  
  if (response.sources.length > 0) {
    lines.push('='.repeat(70));
    lines.push('SOURCES');
    lines.push('='.repeat(70));
    lines.push('');
    
    for (let i = 0; i < Math.min(response.sources.length, 5); i++) {
      const source = response.sources[i];
      lines.push(`[${i + 1}] Document: ${source.documentId}`);
      if (source.pageNumber) {
        lines.push(`    Page: ${source.pageNumber}`);
      }
      lines.push(`    Relevance: ${(source.relevanceScore * 100).toFixed(1)}%`);
      lines.push(`    Excerpt: "${source.text.slice(0, 150)}..."`);
      lines.push('');
    }
    
    if (response.sources.length > 5) {
      lines.push(`... and ${response.sources.length - 5} more sources`);
      lines.push('');
    }
  }
  
  lines.push('='.repeat(70));
  lines.push('METADATA');
  lines.push('='.repeat(70));
  lines.push(`Confidence:      ${(response.confidence * 100).toFixed(1)}%`);
  lines.push(`Total chunks:    ${response.metadata.totalChunks}`);
  lines.push(`Relevant chunks: ${response.metadata.relevantChunks}`);
  lines.push(`Subagents:       ${response.metadata.subagentCount}`);
  lines.push(`Total hops:      ${response.metadata.totalHops}`);
  lines.push(`Processing time: ${response.metadata.processingTimeMs}ms`);
  lines.push('');
  
  return lines.join('\n');
}

// Format output for JSON display
function formatJsonOutput(response: QueryResponse): string {
  return JSON.stringify(response, null, 2);
}

// Main function
async function main() {
  const options = parseArgs();
  
  console.log('='.repeat(60));
  console.log('Hybrid Search Agent - Query');
  console.log('='.repeat(60));
  console.log(`Query: "${options.query}"`);
  console.log(`Provider: ${options.provider}`);
  console.log(`Max hops: ${options.maxHops}`);
  console.log(`Subagents: ${options.subagents}`);
  console.log(`Data directory: ${options.dataDir}`);
  console.log('='.repeat(60));

  // Create embedding provider
  const embeddingProvider = createEmbeddingProvider({
    type: options.provider,
    apiKey: process.env.HUGGINGFACE_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: process.env.LOCAL_BGE_M3_URL,
    dimensions: options.provider === 'openai' ? 1536 : 1024,
  });

  // Create configuration
  const config: Partial<HybridSearchConfig> = {
    embeddingDimensions: embeddingProvider.getDimensions(),
    embeddingModel: embeddingProvider.getModel(),
    maxHops: options.maxHops,
    subagentCount: options.subagents,
    topKCandidates: options.topK,
  };

  // Create indexer with embedding provider
  const indexer = createHybridIndexer(
    { ...DEFAULT_HYBRID_SEARCH_CONFIG, ...config },
    embeddingProvider
  );

  // Load existing index
  console.log('\nLoading index...');
  const indexData = await loadIndex(options.dataDir);
  
  if (!indexData || indexData.chunks.length === 0) {
    console.error('Error: No indexed documents found. Run `npm run ingest` first.');
    process.exit(1);
  }
  
  console.log(`Loaded ${indexData.chunks.length} chunks from index`);

  // Add chunks to indexer - use stored embeddings if available
  if (indexData.hasEmbeddings && indexData.embeddings) {
    console.log(`Using ${indexData.embeddings.length} stored embeddings (no regeneration needed)`);
    indexer.addChunksWithEmbeddings(indexData.chunks, indexData.embeddings);
  } else {
    console.log('No stored embeddings found. Generating embeddings for loaded chunks...');
    await indexer.addChunks(indexData.chunks);
  }

  // Create search agent
  const agent = createHybridSearchAgent(indexer, undefined, config);

  // Execute query
  console.log('\nExecuting query...');
  const startTime = Date.now();
  
  const response = await agent.query({
    query: options.query,
    options: {
      maxHops: options.maxHops,
      subagentCount: options.subagents,
      topK: options.topK,
    },
  });
  
  console.log(`\nQuery completed in ${Date.now() - startTime}ms`);

  // Output result
  console.log('\n');
  if (options.format === 'json') {
    console.log(formatJsonOutput(response));
  } else {
    console.log(formatTextOutput(response));
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});