#!/usr/bin/env node
/**
 * CLI entry point for: npm run ingest -- <file_path>
 * 
 * Ingests a PDF file into 3 SQLite databases:
 * - fixed_chunks.db: 10 pages per chunk
 * - heading_chunks.db: chunks based on detected headings
 * - toc_chunks.db: chunks based on table of contents
 */

import { ingestPDF } from '../ingest/pipeline.js';
import fs from 'fs';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let batchSize: number | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--batch-size') {
      const val = args[++i];
      batchSize = parseInt(val, 10);
      if (isNaN(batchSize) || batchSize < 1 || batchSize > 16) {
        console.error('Error: --batch-size must be between 1 and 16');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    }
  }
  
  if (!filePath) {
    console.error('Error: No file path provided.\n');
    printUsage();
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    console.error('Error: File must be a PDF.');
    process.exit(1);
  }
  
  console.log(`[Ingest] Starting ingestion for: ${filePath}`);
  console.log('');
  
  try {
    const result = await ingestPDF(filePath, batchSize);
    
    console.log('');
    console.log('✓ Ingestion Complete!');
    console.log('');
    console.log('Results:');
    console.log(`  Document ID: ${result.documentId}`);
    console.log(`  Total Pages: ${result.totalPages}`);
    console.log('');
    console.log('Chunks stored:');
    console.log(`  Fixed chunks (10 pages each): ${result.fixedChunks}`);
    console.log(`  Heading chunks: ${result.headingChunks}`);
    console.log(`  TOC chunks: ${result.tocChunks}`);
    console.log('');
    console.log('Databases:');
    console.log('  data/fixed_chunks.db');
    console.log('  data/heading_chunks.db');
    console.log('  data/toc_chunks.db');
    
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('✗ Ingestion failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`
Usage: npm run ingest -- <file_path> [options]

Ingest a PDF file into SQLite databases for querying.

Note: Use "--" after "ingest" to pass arguments correctly (especially for paths with spaces).

Arguments:
  file_path    Path to the PDF file to ingest

Options:
  -h, --help      Show this help message
  --batch-size N  Process N pages in parallel (default: 4, max: 16)

Examples:
  npm run ingest -- ./document.pdf
  npm run ingest -- "/path/with spaces/report.pdf"
  npm run ingest -- ./large.pdf --batch-size 8

The ingestion creates 3 SQLite databases:
  1. fixed_chunks.db  - Fixed 10-page chunks
  2. heading_chunks.db - Chunks based on detected headings
  3. toc_chunks.db    - Chunks based on table of contents
`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
