#!/usr/bin/env node
/**
 * CLI script to ingest documents into the hybrid search system.
 * 
 * Usage:
 *   npm run ingest -- <file-path> [options]
 *   tsx src/cli/ingest.ts <file-path> [options]
 * 
 * Options:
 *   --name <name>       Document name (default: file name)
 *   --chunk-size <n>    Chunk size in tokens (default: 512)
 *   --overlap <n>       Chunk overlap in tokens (default: 50)
 *   --provider <type>   Embedding provider: bge-m3 | local-bge-m3 | openai | mock
 *   --data-dir <dir>    Data directory (default: ./data)
 *   --collection <name> Collection name (default: default)
 * 
 * Examples:
 *   npm run ingest -- ./documents/report.pdf
 *   npm run ingest -- ./documents/report.pdf --name "Annual Report 2024"
 *   npm run ingest -- ./documents/report.pdf --provider openai
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from multiple possible locations
const envPaths = [
  path.resolve(__dirname, '../../.env'),  // test_hybrid/.env
  path.resolve(process.cwd(), '.env'),     // current working directory
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      console.log(`Loaded environment from: ${envPath}`);
      envLoaded = true;
      break;
    }
  }
}

if (!envLoaded) {
  console.warn('Warning: No .env file found. Using system environment variables.');
}
import { createEmbeddingProvider, EmbeddingProvider } from '../indexing/dense-index.js';
import { createDocument, createChunksFromExtractedContent } from '../indexing/chunker.js';
import { createPersistentStore, PersistentStore } from '../store/index.js';
import { createDefaultPDFExtractor, PDFExtractorClient } from '../extraction/index.js';

// Parse command line arguments
function parseArgs(): {
  filePath: string;
  name?: string;
  chunkSize: number;
  overlap: number;
  provider: 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock';
  dataDir: string;
  collection: string;
} {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: npm run ingest -- <file-path> [options]

Arguments:
  <file-path>          Path to the document file (PDF, TXT, MD, etc.)

Options:
  --name <name>        Document name (default: file name)
  --chunk-size <n>     Chunk size in tokens (default: 512)
  --overlap <n>        Chunk overlap in tokens (default: 50)
  --provider <type>    Embedding provider: bge-m3 | local-bge-m3 | openai | mock
  --data-dir <dir>     Data directory (default: ./data)
  --collection <name>  Collection name (default: default)

Examples:
  npm run ingest -- ./documents/report.pdf
  npm run ingest -- ./documents/report.pdf --name "Annual Report 2024"
  npm run ingest -- ./documents/report.pdf --provider openai
  npm run ingest -- ./documents/report.pdf --collection "my-docs"
`);
    process.exit(0);
  }

  let filePath = '';
  let name: string | undefined;
  let chunkSize = 512;
  let overlap = 50;
  let provider: 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock' = 'bge-m3';
  let dataDir = './data';
  let collection = 'default';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') {
      name = args[++i];
    } else if (args[i] === '--chunk-size') {
      chunkSize = parseInt(args[++i], 10);
    } else if (args[i] === '--overlap') {
      overlap = parseInt(args[++i], 10);
    } else if (args[i] === '--provider') {
      provider = args[++i] as 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock';
    } else if (args[i] === '--data-dir') {
      dataDir = args[++i];
    } else if (args[i] === '--collection') {
      collection = args[++i];
    } else if (!args[i].startsWith('--')) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error('Error: File path is required');
    process.exit(1);
  }

  return { filePath, name, chunkSize, overlap, provider, dataDir, collection };
}

// Read file content
async function readFileContent(filePath: string): Promise<{ text: string; pageTexts?: string[] }> {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  if (ext === '.txt' || ext === '.md') {
    const text = fs.readFileSync(absolutePath, 'utf-8');
    return { text };
  }

  if (ext === '.pdf') {
    console.log('Processing PDF file...');
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = fs.readFileSync(absolutePath);
      const data = await pdfParse(buffer);
      
      return { 
        text: data.text,
        pageTexts: [data.text]
      };
    } catch (error: any) {
      console.error('PDF parsing error:', error);
      throw new Error('Failed to parse PDF. Make sure pdf-parse is installed: npm install pdf-parse');
    }
  }

  console.log(`Warning: Unknown file type "${ext}", reading as plain text`);
  const text = fs.readFileSync(absolutePath, 'utf-8');
  return { text };
}

/**
 * Extract content from PDF using the PyMuPDF extraction server.
 * This method extracts text, tables (as markdown), and images (with descriptions).
 */
async function extractPdfContent(
  filePath: string,
  extractor: PDFExtractorClient
): Promise<{
  contents: Array<{
    type: 'text' | 'table' | 'image';
    text: string;
    page_number: number;
    position: number;
    metadata?: Record<string, unknown>;
  }>;
  totalPages: number;
}> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  console.log('Extracting PDF content using PyMuPDF server...');
  
  // Check if extraction server is available
  const isHealthy = await extractor.healthCheck();
  if (!isHealthy) {
    console.warn('PDF extraction server is not available. Falling back to pdf-parse.');
    const { text, pageTexts } = await readFileContent(filePath);
    // Convert to extracted content format
    const contents = [{
      type: 'text' as const,
      text,
      page_number: 1,
      position: 0,
    }];
    return { contents, totalPages: pageTexts?.length || 1 };
  }

  try {
    const result = await extractor.extractPdfFromPath(absolutePath);
    
    console.log(`Extracted ${result.contents.length} content pieces:`);
    console.log(`  - Text blocks: ${result.metadata.text_count}`);
    console.log(`  - Tables: ${result.metadata.table_count}`);
    console.log(`  - Images: ${result.metadata.image_count}`);
    
    return {
      contents: result.contents,
      totalPages: result.total_pages,
    };
  } catch (error: any) {
    console.error('PDF extraction error:', error.message);
    console.warn('Falling back to pdf-parse...');
    const { text, pageTexts } = await readFileContent(filePath);
    const contents = [{
      type: 'text' as const,
      text,
      page_number: 1,
      position: 0,
    }];
    return { contents, totalPages: pageTexts?.length || 1 };
  }
}

// Main function
async function main() {
  const options = parseArgs();
  
  console.log('='.repeat(60));
  console.log('Hybrid Search Agent - Document Ingestion');
  console.log('='.repeat(60));
  console.log(`File: ${options.filePath}`);
  console.log(`Provider: ${options.provider}`);
  console.log(`Chunk size: ${options.chunkSize} tokens`);
  console.log(`Chunk overlap: ${options.overlap} tokens`);
  console.log(`Data directory: ${options.dataDir}`);
  console.log(`Collection: ${options.collection}`);
  console.log('='.repeat(60));

  // Create embedding provider
  const embeddingProvider = createEmbeddingProvider({
    type: options.provider,
    apiKey: process.env.HUGGINGFACE_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: process.env.LOCAL_BGE_M3_URL,
    dimensions: options.provider === 'openai' ? 1536 : 1024,
  });

  // Create persistent store
  const store = createPersistentStore({
    dataDir: options.dataDir,
    collectionName: options.collection,
  });

  // Initialize store (loads existing data)
  await store.initialize();

  // Extract document name
  const docName = options.name || path.basename(options.filePath);
  const docId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Get file extension
  const ext = path.extname(options.filePath).toLowerCase();
  const isPdf = ext === '.pdf';

  // Create chunks based on file type
  let chunks: import('../types/index.js').Chunk[];
  let textCount = 0;
  let tableCount = 0;
  let imageCount = 0;

  if (isPdf) {
    // Use PyMuPDF extraction for PDFs (with tables and images)
    console.log('\nExtracting PDF content...');
    const pdfExtractor = createDefaultPDFExtractor();
    
    const { contents, totalPages } = await extractPdfContent(options.filePath, pdfExtractor);
    console.log(`Total pages: ${totalPages}`);
    
    // Count content types
    textCount = contents.filter(c => c.type === 'text').length;
    tableCount = contents.filter(c => c.type === 'table').length;
    imageCount = contents.filter(c => c.type === 'image').length;
    
    console.log(`Content extracted: ${textCount} text blocks, ${tableCount} tables, ${imageCount} images`);
    
    // Create chunks from extracted content
    console.log('\nChunking document...');
    chunks = createChunksFromExtractedContent(docId, contents, {
      chunkSize: options.chunkSize,
      chunkOverlap: options.overlap,
      fileName: docName,
    });
  } else {
    // Use regular text extraction for non-PDF files
    console.log('\nReading file...');
    const { text, pageTexts } = await readFileContent(options.filePath);
    console.log(`Total text length: ${text.length} characters`);
    
    // Create document with chunks
    console.log('\nChunking document...');
    const document = createDocument(text, {
      id: docId,
      fileName: docName,
      chunkSize: options.chunkSize,
      chunkOverlap: options.overlap,
      pageTexts,
    });
    
    chunks = document.chunks;
    textCount = chunks.length;
  }

  console.log(`Created ${chunks.length} chunks`);
  
  // Count chunk types
  const textChunks = chunks.filter(c => c.chunkType === 'text').length;
  const tableChunks = chunks.filter(c => c.chunkType === 'table').length;
  const imageChunks = chunks.filter(c => c.chunkType === 'image').length;
  console.log(`Chunk types: ${textChunks} text, ${tableChunks} table, ${imageChunks} image`);

  // Generate embeddings
  console.log('\nGenerating embeddings...');
  const startTime = Date.now();
  
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTypeLabel = chunk.chunkType || 'text';
    console.log(`  Embedding chunk ${i + 1}/${chunks.length} [${chunkTypeLabel}]...`);
    const embedding = await embeddingProvider.embedSingle(chunk.text);
    embeddings.push(embedding);
  }
  
  const duration = Date.now() - startTime;
  console.log(`Embedding time: ${duration}ms`);

  // Store chunks with embeddings (persisted automatically)
  console.log('\nStoring chunks with embeddings...');
  await store.addChunks(chunks, embeddings);
  
  // Calculate total tokens
  const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
  
  console.log('\n' + '='.repeat(60));
  console.log('Ingestion Complete');
  console.log('='.repeat(60));
  console.log(`Document ID: ${docId}`);
  console.log(`Document name: ${docName}`);
  console.log(`Chunks created: ${chunks.length}`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`Processing time: ${duration}ms`);
  
  if (isPdf) {
    console.log(`\nContent breakdown:`);
    console.log(`  Text blocks: ${textCount}`);
    console.log(`  Tables: ${tableCount}`);
    console.log(`  Images (with descriptions): ${imageCount}`);
  }
  
  // Print stats
  const stats = await store.getStats();
  console.log('\nStore Statistics:');
  console.log(`  Total chunks: ${stats.totalChunks}`);
  console.log(`  Embedding model: ${stats.embeddingModel}`);
  console.log(`  Dimensions: ${stats.dimensions}`);
  console.log(`  BM25 vocabulary size: ${stats.bm25Stats.vocabularySize}`);
  
  console.log('\n✅ Document successfully ingested with persistent embeddings!');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});