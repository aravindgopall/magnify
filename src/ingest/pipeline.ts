import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getDatabase, Chunk, Document } from '../db/database.js';
import type { TableData, TOCItem } from '../types/index.js';

// Internal types for Python extraction result (used only in this file)
interface PageData {
  page_number: number;
  text: string;
  tables: TableData[];
  has_images: boolean;
}

interface GroupData {
  group_id: string;
  doc_id: string;
  strategy: 'toc' | 'heading' | 'range';
  title: string;
  start_page: number;
  end_page: number;
  full_text: string;
  tables: TableData[];
}

interface PythonExtractionResult {
  doc_id: string;
  pdf_type: string;
  metadata: Record<string, any>;
  pages: PageData[];
  groups: GroupData[];
  toc?: TOCItem[];
}

/**
 * Convert a table to markdown format
 */
function tableToMarkdown(table: TableData): string {
  if (!table.headers || table.headers.length === 0) {
    return '';
  }

  let markdown = '';
  
  // Add caption if present
  if (table.caption) {
    markdown += `**${table.caption}**\n\n`;
  }

  // Header row
  markdown += '| ' + table.headers.map(h => String(h)).join(' | ') + ' |\n';
  
  // Separator row
  markdown += '| ' + table.headers.map(() => '---').join(' | ') + ' |\n';
  
  // Data rows
  for (const row of table.rows) {
    markdown += '| ' + row.map(cell => String(cell || '')).join(' | ') + ' |\n';
  }

  return markdown;
  
}

/**
 * Run the Python PDF extractor
 */
async function runPythonExtractor(pdfPath: string, batchSize?: number): Promise<PythonExtractionResult> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'pdf_extractor.py');
  
  const args = [scriptPath, pdfPath, '--strategy', 'all'];
  if (batchSize) {
    args.push('--batch-size', String(batchSize));
  }
  
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('[Python Extractor]', data.toString().trim());
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python extractor failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout) as PythonExtractionResult;
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse Python output: ${err}\nOutput: ${stdout.substring(0, 500)}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to start Python process: ${err}`));
    });
  });
}

/**
 * Build content from page text and tables (in markdown)
 */
function buildChunkContent(pages: PageData[]): string {
  let content = '';
  
  for (const page of pages) {
    // Add page text
    if (page.text) {
      content += page.text + '\n\n';
    }
    
    // Add tables in markdown format
    for (const table of page.tables) {
      content += tableToMarkdown(table) + '\n\n';
    }
  }
  
  return content.trim();
}

/**
 * Create fixed page chunks (10 pages per chunk)
 */
function createFixedChunks(result: PythonExtractionResult, pagesPerChunk: number = 10): Omit<Chunk, 'id' | 'created_at'>[] {
  const chunks: Omit<Chunk, 'id' | 'created_at'>[] = [];
  const totalPages = result.pages.length;
  
  for (let start = 1; start <= totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk - 1, totalPages);
    const pageData = result.pages.slice(start - 1, end);
    
    const content = buildChunkContent(pageData);
    const hasTables = pageData.some(p => p.tables && p.tables.length > 0);
    const hasImages = pageData.some(p => p.has_images);
    
    chunks.push({
      document_id: result.doc_id,
      chunk_id: `fixed-${start}-${end}`,
      title: `Pages ${start}-${end}`,
      content,
      start_page: start,
      end_page: end,
      strategy: 'fixed',
      has_tables: hasTables,
      has_images: false, // Ignoring images as per requirement
    });
  }
  
  return chunks;
}

/**
 * Create heading-based chunks
 */
function createHeadingChunks(result: PythonExtractionResult): Omit<Chunk, 'id' | 'created_at'>[] {
  const chunks: Omit<Chunk, 'id' | 'created_at'>[] = [];
  
  // Filter for heading strategy groups
  const headingGroups = result.groups.filter(g => g.strategy === 'heading');
  
  for (const group of headingGroups) {
    const hasTables = group.tables && group.tables.length > 0;
    
    // Convert tables to markdown
    let content = group.full_text;
    if (group.tables) {
      for (const table of group.tables) {
        content += '\n\n' + tableToMarkdown(table);
      }
    }
    
    chunks.push({
      document_id: result.doc_id,
      chunk_id: group.group_id,
      title: group.title,
      content: content.trim(),
      start_page: group.start_page,
      end_page: group.end_page,
      strategy: 'heading',
      has_tables: hasTables,
      has_images: false, // Ignoring images as per requirement
    });
  }
  
  return chunks;
}

/**
 * Create TOC-based chunks
 */
function createTOCChunks(result: PythonExtractionResult): Omit<Chunk, 'id' | 'created_at'>[] {
  const chunks: Omit<Chunk, 'id' | 'created_at'>[] = [];
  
  // Filter for TOC strategy groups
  const tocGroups = result.groups.filter(g => g.strategy === 'toc');
  
  for (const group of tocGroups) {
    const hasTables = group.tables && group.tables.length > 0;
    
    // Convert tables to markdown
    let content = group.full_text;
    if (group.tables) {
      for (const table of group.tables) {
        content += '\n\n' + tableToMarkdown(table);
      }
    }
    
    chunks.push({
      document_id: result.doc_id,
      chunk_id: group.group_id,
      title: group.title,
      content: content.trim(),
      start_page: group.start_page,
      end_page: group.end_page,
      strategy: 'toc',
      has_tables: hasTables,
      has_images: false, // Ignoring images as per requirement
    });
  }
  
  return chunks;
}

/**
 * Main ingestion pipeline - processes PDF and stores chunks in all 3 databases
 */
export async function ingestPDF(filePath: string, batchSize?: number): Promise<{
  documentId: string;
  totalPages: number;
  fixedChunks: number;
  headingChunks: number;
  tocChunks: number;
}> {
  console.log(`[Ingest] Starting ingestion for: ${filePath}`);
  
  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const fileName = path.basename(filePath);
  
  // Step 1: Extract PDF content using Python
  console.log('[Ingest] Running Python extractor...');
  const result = await runPythonExtractor(filePath, batchSize);
  
  console.log(`[Ingest] Extracted ${result.pages.length} pages`);
  
  // Step 2: Create document record
  const totalPages = result.pages.length;
  const docId = result.doc_id;
  
  // Step 3: Create chunks for each strategy
  console.log('[Ingest] Creating fixed chunks (10 pages each)...');
  const fixedChunks = createFixedChunks(result);
  console.log(`[Ingest] Created ${fixedChunks.length} fixed chunks`);
  
  console.log('[Ingest] Creating heading-based chunks...');
  const headingChunks = createHeadingChunks(result);
  console.log(`[Ingest] Created ${headingChunks.length} heading chunks`);
  
  console.log('[Ingest] Creating TOC-based chunks...');
  const tocChunks = createTOCChunks(result);
  console.log(`[Ingest] Created ${tocChunks.length} TOC chunks`);
  
  // Step 4: Store in parallel to all 3 databases
  console.log('[Ingest] Storing chunks in databases (parallel)...');
  
  await Promise.all([
    // Store fixed chunks
    (async () => {
      const fixedDb = getDatabase('fixed');
      const doc: Document = {
        id: docId,
        file_path: filePath,
        file_name: fileName,
        total_pages: totalPages,
        total_chunks: fixedChunks.length,
        created_at: new Date().toISOString(),
      };
      fixedDb.insertDocument(doc);
      
      for (const chunk of fixedChunks) {
        fixedDb.insertChunk(chunk);
      }
      console.log(`[Ingest] Stored ${fixedChunks.length} fixed chunks`);
    })(),
    
    // Store heading chunks
    (async () => {
      const headingDb = getDatabase('heading');
      const doc: Document = {
        id: docId,
        file_path: filePath,
        file_name: fileName,
        total_pages: totalPages,
        total_chunks: headingChunks.length,
        created_at: new Date().toISOString(),
      };
      headingDb.insertDocument(doc);
      
      for (const chunk of headingChunks) {
        headingDb.insertChunk(chunk);
      }
      console.log(`[Ingest] Stored ${headingChunks.length} heading chunks`);
    })(),
    
    // Store TOC chunks
    (async () => {
      const tocDb = getDatabase('toc');
      const doc: Document = {
        id: docId,
        file_path: filePath,
        file_name: fileName,
        total_pages: totalPages,
        total_chunks: tocChunks.length,
        created_at: new Date().toISOString(),
      };
      tocDb.insertDocument(doc);
      
      for (const chunk of tocChunks) {
        tocDb.insertChunk(chunk);
      }
      console.log(`[Ingest] Stored ${tocChunks.length} TOC chunks`);
    })(),
  ]);
  
  console.log('[Ingest] ✓ Ingestion complete!');
  
  return {
    documentId: docId,
    totalPages,
    fixedChunks: fixedChunks.length,
    headingChunks: headingChunks.length,
    tocChunks: tocChunks.length,
  };
}
