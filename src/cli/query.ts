#!/usr/bin/env node
/**
 * CLI entry point for: npm query "question"
 * 
 * Queries ingested documents using the SQLite query pipeline.
 * Uses pi-mono agents for query classification and answer synthesis.
 */

import { SQLiteQueryPipeline } from '../query/sqlite-pipeline.js';
import type { ExtractionType } from '../types/index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  let query: string | undefined;
  let extractionType: ExtractionType | undefined;
  let showSources = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === '--type' || arg === '-t') {
      const type = args[++i];
      if (type && ['summary', 'entities', 'full', 'custom'].includes(type)) {
        extractionType = type as ExtractionType;
      } else {
        console.error('Error: --type must be one of: summary, entities, full, custom');
        process.exit(1);
      }
    } else if (arg === '--sources' || arg === '-s') {
      showSources = true;
    } else if (!arg.startsWith('-')) {
      query = arg;
    }
  }
  
  if (!query) {
    console.error('Error: No query provided.\n');
    printUsage();
    process.exit(1);
  }
  
  console.log(`[Query] Processing: "${query}"`);
  if (extractionType) {
    console.log(`[Query] Extraction type: ${extractionType}`);
  }
  console.log('');
  
  try {
    const pipeline = new SQLiteQueryPipeline();
    const result = await pipeline.execute({ query, extractionType });
    
    console.log('─'.repeat(60));
    console.log('');
    console.log('Answer:');
    console.log('');
    console.log(result.answer);
    console.log('');
    
    if (showSources && result.sources.length > 0) {
      console.log('─'.repeat(60));
      console.log('');
      console.log('Sources:');
      console.log('');
      result.sources.forEach((source, idx) => {
        console.log(`  ${idx + 1}. ${source.title || 'Untitled'} (${source.source}, pages ${source.startPage}-${source.endPage})`);
        if (source.relevantExcerpt) {
          console.log(`     "${source.relevantExcerpt.slice(0, 100)}..."`);
        }
      });
      console.log('');
    }
    
    console.log('─'.repeat(60));
    console.log(`Extraction type: ${result.extractionType}`);
    console.log(`Relevant chunks: ${result.metadata.relevantChunks}/${result.metadata.totalChunks}`);
    console.log(`Processing time: ${result.metadata.processingTimeMs}ms`);
    console.log(`Log file: ${result.logPath || 'N/A'}`);
    
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('✗ Query failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`
Usage: npm query "question" [options]

Query ingested documents using AI-powered search.

Arguments:
  query           The question to ask about the documents

Options:
  -t, --type TYPE Extraction type: summary, entities, full, custom
  -s, --sources   Show source references in output
  -h, --help      Show this help message

Extraction Types:
  summary   Concise overview (2-5 bullet points)
  entities  List of key entities (names, codes, values)
  full      Comprehensive answer with complete details
  custom    Flexible format based on query

Examples:
  npm query "What is the main topic?"
  npm query "Extract all company names" --type entities
  npm query "Explain the process in detail" --type full --sources
`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
