import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { spawn } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  PDFDocument,
  DocumentMetadata,
  Page,
  PageElement,
  TableOfContents,
  TOCItem,
  TextBlock,
  TableData,
  ImageData,
  PythonExtractionResult,
  PythonPageObject,
  PythonGroupObject,
} from '../types/index.js';

export interface ParserOptions {
  extractHeadings?: boolean;
  extractTables?: boolean;
  extractLists?: boolean;
  headingPatterns?: RegExp[];
  usePythonExtractor?: boolean;
  pythonScriptPath?: string;
  outputDir?: string;
  groupingStrategy?: 'toc' | 'heading' | 'fixed' | 'hybrid' | 'all';
  // Performance optimization flags
  skipTables?: boolean;      // Skip table extraction (5-10x faster)
  skipImages?: boolean;      // Skip image extraction
  skipOCR?: boolean;         // Skip OCR for scanned PDFs (3-5x faster)
  skipFontInfo?: boolean;    // Skip detailed font metadata
}

export class PDFParser {
  private options: ParserOptions;
  private _lastPythonResult: PythonExtractionResult | null = null;

  constructor(options: ParserOptions = {}) {
    this.options = {
      extractHeadings: true,
      extractTables: true,
      extractLists: true,
      usePythonExtractor: true,
      ...options,
    };
  }

  async parse(source: string | Buffer): Promise<PDFDocument> {
    // Determine if we should use Python extractor
    if (this.options.usePythonExtractor) {
      return this.parseWithPython(source);
    }
    
    // Fallback to JavaScript-based extraction (original PDF.js method)
    return this.parseWithPDFJS(source);
  }

  /**
   * Parse PDF using Python extraction pipeline (PyMuPDF + camelot + OCR)
   */
  private async parseWithPython(source: string | Buffer): Promise<PDFDocument> {
    const { filePath, cleanup } = await this.getFilePath(source);
    
    try {
      const result = await this.runPythonExtractor(filePath);
      this._lastPythonResult = result; // Store for later access
      return this.convertPythonResult(result);
    } finally {
      if (cleanup) {
        const fs = await import('fs/promises');
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  /**
   * Get a file path from source (handles both file paths and buffers)
   */
  private async getFilePath(source: string | Buffer): Promise<{ filePath: string; cleanup: boolean }> {
    if (typeof source === 'string') {
      return { filePath: source, cleanup: false };
    }
    
    // Write buffer to temp file
    const fs = await import('fs/promises');
    const os = await import('os');
    const tempFile = path.join(os.tmpdir(), `pdf-${uuidv4()}.pdf`);
    await fs.writeFile(tempFile, source);
    return { filePath: tempFile, cleanup: true };
  }

  /**
   * Run the Python extraction script
   */
  private async runPythonExtractor(pdfPath: string): Promise<PythonExtractionResult> {
    const scriptPath = this.options.pythonScriptPath || 
      path.join(__dirname, '../../scripts/pdf_extractor.py');
    
    const args = [scriptPath, pdfPath];
    
    // Add output directory if specified
    if (this.options.outputDir) {
      args.push('--output-dir', this.options.outputDir);
    }
    
    // Add grouping strategy if specified
    if (this.options.groupingStrategy) {
      args.push('--strategy', this.options.groupingStrategy);
      console.log(`[PDFParser] Using grouping strategy: ${this.options.groupingStrategy}`);
    }
    
    // Add performance optimization flags
    if (this.options.skipTables) {
      args.push('--skip-tables');
      console.log('[PDFParser] Skipping table extraction for performance');
    }
    
    if (this.options.skipImages) {
      args.push('--skip-images');
      console.log('[PDFParser] Skipping image extraction for performance');
    }
    
    if (this.options.skipOCR) {
      args.push('--skip-ocr');
      console.log('[PDFParser] Skipping OCR for performance');
    }
    
    if (this.options.skipFontInfo) {
      args.push('--no-font-info');
      console.log('[PDFParser] Skipping font metadata for performance');
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
        // Log Python stderr for debugging
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
   * Convert Python extraction result to TypeScript PDFDocument
   */
  private convertPythonResult(result: PythonExtractionResult): PDFDocument {
    // Convert pages
    const pages: Page[] = result.pages.map((p) => this.convertPythonPage(p));

    // Convert TOC
    let toc: TableOfContents | undefined;
    if (result.toc && result.toc.length > 0) {
      toc = {
        items: this.convertPythonTOC(result.toc),
      };
    }

    // Convert metadata
    const metadata: DocumentMetadata = {
      title: result.metadata.title,
      author: result.metadata.author,
      subject: result.metadata.subject,
      creator: result.metadata.creator,
      producer: result.metadata.producer,
      creationDate: result.metadata.creationDate ? new Date(result.metadata.creationDate) : undefined,
      pageCount: result.metadata.pageCount,
    };

    return {
      id: result.doc_id,
      source: result.doc_id,
      metadata,
      pages,
      toc,
      pdfType: result.pdf_type,
    };
  }

  /**
   * Convert Python page object to TypeScript Page
   */
  private convertPythonPage(p: PythonPageObject): Page {
    // Convert text blocks to page elements
    const elements: PageElement[] = [];
    
    if (p.text_blocks) {
      for (const block of p.text_blocks) {
        const isHeading = block.is_bold || block.font_size >= 14;
        elements.push({
          type: isHeading ? 'heading' : 'text',
          text: block.text,
          bbox: block.bbox,
          level: isHeading ? 1 : undefined,
        });
      }
    }

    // Add table elements
    if (p.tables) {
      for (const table of p.tables) {
        elements.push({
          type: 'table',
          text: table.caption || 'Table',
        });
      }
    }

    return {
      number: p.page_number,
      text: p.text,
      rawText: p.text,
      width: p.width,
      height: p.height,
      elements,
      textBlocks: p.text_blocks,
      tables: p.tables,
      images: p.images,
    };
  }

  /**
   * Convert Python TOC items to TypeScript TOCItem[]
   */
  private convertPythonTOC(items: Array<{ level: number; title: string; pageNumber: number }>): TOCItem[] {
    const result: TOCItem[] = [];
    const stack: TOCItem[] = [];

    for (const item of items) {
      const tocItem: TOCItem = {
        title: item.title,
        level: item.level,
        pageNumber: item.pageNumber,
      };

      // Find parent based on level
      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(tocItem);
      } else {
        result.push(tocItem);
      }

      stack.push(tocItem);
    }

    return result;
  }

  /**
   * Fallback: Parse PDF using PDF.js (JavaScript only)
   * This is used when Python extractor is not available
   */
  private async parseWithPDFJS(source: string | Buffer): Promise<PDFDocument> {
    // Import pdfjs-dist dynamically
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    const buffer = typeof source === 'string' ? await this.loadFile(source) : source;
    
    const pdfJsDoc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pages: Page[] = [];
    for (let i = 1; i <= pdfJsDoc.numPages; i++) {
      const page = await this.extractPagePDFJS(pdfJsDoc, i);
      pages.push(page);
    }

    const metadata = await this.extractMetadataPDFJS(pdfJsDoc);

    return {
      id: uuidv4(),
      source,
      metadata,
      pages,
    };
  }

  private async loadFile(path: string): Promise<Buffer> {
    const fs = await import('fs/promises');
    return fs.readFile(path);
  }

  private async extractMetadataPDFJS(pdfJsDoc: any): Promise<DocumentMetadata> {
    const pdfJsMetadata = await pdfJsDoc.getMetadata();
    const info = pdfJsMetadata.info as Record<string, any> || {};
    
    return {
      title: info.Title || info.title || undefined,
      author: info.Author || info.author || undefined,
      subject: info.Subject || info.subject || undefined,
      creator: info.Creator || info.creator || undefined,
      producer: info.Producer || info.producer || undefined,
      creationDate: info.CreationDate || info.creationDate ? new Date(info.CreationDate || info.creationDate) : undefined,
      pageCount: pdfJsDoc.numPages,
    };
  }

  private async extractPagePDFJS(pdfJsDoc: any, pageNumber: number): Promise<Page> {
    const pdfJsPage = await pdfJsDoc.getPage(pageNumber);
    const textContent = await pdfJsPage.getTextContent();
    
    const textItems = textContent.items as Array<{ str: string; transform: number[] }>;
    const pageText = this.buildPageText(textItems);
    
    const viewport = pdfJsPage.getViewport({ scale: 1 });
    
    const elements = this.extractPageElements(pageText);

    return {
      number: pageNumber,
      text: pageText,
      rawText: pageText,
      width: viewport.width,
      height: viewport.height,
      elements,
    };
  }

  private buildPageText(items: Array<{ str: string; transform: number[] }>): string {
    if (!items || items.length === 0) {
      return '';
    }

    const lines: { y: number; text: string }[] = [];
    const lineMap = new Map<number, string[]>();
    const yTolerance = 2;

    for (const item of items) {
      if (!item.str || item.str.trim() === '') continue;
      
      const y = item.transform[5];
      let foundKey: number | null = null;
      
      for (const key of lineMap.keys()) {
        if (Math.abs(key - y) < yTolerance) {
          foundKey = key;
          break;
        }
      }

      if (foundKey !== null) {
        lineMap.get(foundKey)!.push(item.str);
      } else {
        lineMap.set(y, [item.str]);
      }
    }

    for (const [y, texts] of lineMap) {
      lines.push({ y, text: texts.join(' ') });
    }

    lines.sort((a, b) => b.y - a.y);
    return lines.map(l => l.text).join('\n');
  }

  private extractPageElements(text: string): PageElement[] {
    const elements: PageElement[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      elements.push({
        type: 'text',
        text: trimmedLine,
      });
    }

    return elements;
  }

  /**
   * Get all groups from a parsed document (extracted by Python)
   * This returns groups for all 3 strategies: toc, heading, range
   */
  getGroupsFromPythonResult(result: PythonExtractionResult): PythonGroupObject[] {
    return result.groups;
  }

  /**
   * Get the last Python extraction result
   */
  get lastPythonResult(): PythonExtractionResult | null {
    return this._lastPythonResult;
  }
}

export function createParser(options?: ParserOptions): PDFParser {
  return new PDFParser(options);
}