import { PDFDocument as PDFLibDocument, PDFDict, PDFName, PDFArray, PDFString } from 'pdf-lib';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import type {
  PDFDocument,
  DocumentMetadata,
  Page,
  PageElement,
  TableOfContents,
  TOCItem,
  HeadingInfo,
} from '../types/index.js';

type PDFParseResult = Awaited<ReturnType<typeof pdfParse>>;

const HEADING_PATTERNS = [
  /^(Chapter|CHAPTER)\s+(\d+|[IVXLCDM]+)[:.\s]*(.*)$/i,
  /^(Part|PART)\s+(\d+|[IVXLCDM]+)[:.\s]*(.*)$/i,
  /^(Section|SECTION)\s+(\d+\.?\d*)[:.\s]*(.*)$/i,
  /^(\d+\.?\d*)\s+([A-Z][A-Za-z\s]+)$/,
  /^([A-Z][A-Z\s]{2,50})$/,
  /^(Abstract|ABSTRACT|Introduction|INTRODUCTION|Conclusion|CONCLUSION|References|REFERENCES|Appendix|APPENDIX)$/i,
];

const LIST_PATTERNS = [
  /^[\s]*[-•*]\s+/,
  /^[\s]*\d+[.)]\s+/,
  /^[\s]*[a-z][.)]\s+/i,
];

export class PDFParser {
  private options: ParserOptions;

  constructor(options: ParserOptions = {}) {
    this.options = {
      extractHeadings: true,
      extractTables: true,
      extractLists: true,
      headingPatterns: HEADING_PATTERNS,
      ...options,
    };
  }

  async parse(source: string | Buffer): Promise<PDFDocument> {
    const buffer = typeof source === 'string' ? await this.loadFile(source) : source;
    const [pdfLibDoc, pdfParseResult] = await Promise.all([
      PDFLibDocument.load(buffer),
      pdfParse(buffer),
    ]);

    const metadata = this.extractMetadata(pdfLibDoc, pdfParseResult);
    const pages = await this.extractPages(pdfLibDoc, pdfParseResult);
    const toc = await this.extractTOC(pdfLibDoc);

    return {
      id: uuidv4(),
      source,
      metadata,
      pages,
      toc,
    };
  }

  private async loadFile(path: string): Promise<Buffer> {
    const fs = await import('fs/promises');
    return fs.readFile(path);
  }

  private extractMetadata(_pdfLibDoc: PDFLibDocument, pdfParseResult: PDFParseResult): DocumentMetadata {
    const info = pdfParseResult.info || {};
    
    return {
      title: info.Title || undefined,
      author: info.Author || undefined,
      subject: info.Subject || undefined,
      creator: info.Creator || undefined,
      producer: info.Producer || undefined,
      creationDate: info.CreationDate ? new Date(info.CreationDate) : undefined,
      pageCount: pdfParseResult.numpages,
    };
  }

  private async extractPages(pdfLibDoc: PDFLibDocument, pdfParseResult: PDFParseResult): Promise<Page[]> {
    const pages: Page[] = [];
    const textContent = pdfParseResult.text;
    const pageTexts = this.splitTextByPages(textContent, pdfLibDoc.getPageCount());

    for (let i = 0; i < pdfLibDoc.getPageCount(); i++) {
      const pdfPage = pdfLibDoc.getPage(i);
      const { width, height } = pdfPage.getSize();
      const pageText = pageTexts[i] || '';

      const elements = this.extractPageElements(pageText, i + 1);

      pages.push({
        number: i + 1,
        text: pageText,
        rawText: pageText,
        width,
        height,
        elements,
      });
    }

    return pages;
  }

  private splitTextByPages(text: string, pageCount: number): string[] {
    const formFeed = '\f';
    const pages = text.split(formFeed);
    
    while (pages.length < pageCount) {
      pages.push('');
    }
    
    return pages.slice(0, pageCount);
  }

  private extractPageElements(text: string, _pageNumber: number): PageElement[] {
    const elements: PageElement[] = [];
    const lines = text.split('\n');
    let currentPosition = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        currentPosition += line.length + 1;
        continue;
      }

      const headingInfo = this.detectHeading(trimmedLine);
      if (headingInfo) {
        elements.push({
          type: 'heading',
          text: trimmedLine,
          level: headingInfo.level,
          bbox: { x: 0, y: currentPosition, width: trimmedLine.length, height: 1 },
        });
      } else if (this.detectList(trimmedLine)) {
        elements.push({
          type: 'list',
          text: trimmedLine,
          bbox: { x: 0, y: currentPosition, width: trimmedLine.length, height: 1 },
        });
      } else {
        elements.push({
          type: 'text',
          text: trimmedLine,
          bbox: { x: 0, y: currentPosition, width: trimmedLine.length, height: 1 },
        });
      }

      currentPosition += line.length + 1;
    }

    return elements;
  }

  private detectHeading(line: string): { level: number; text: string } | null {
    if (!this.options.extractHeadings) return null;

    for (let i = 0; i < (this.options.headingPatterns?.length || 0); i++) {
      const pattern = this.options.headingPatterns![i];
      const match = line.match(pattern);
      if (match) {
        let level = 1;
        
        if (/^(Chapter|CHAPTER)/i.test(line)) level = 1;
        else if (/^(Part|PART)/i.test(line)) level = 1;
        else if (/^(Section|SECTION)/i.test(line)) level = 2;
        else if (/^\d+\.\d+/.test(line)) level = 3;
        else if (/^(Abstract|Introduction|Conclusion|References|Appendix)/i.test(line)) level = 1;
        else level = Math.min(i + 1, 4);

        return { level, text: line };
      }
    }

    if (/^[A-Z][A-Z\s]{5,50}$/.test(line) && line.split(' ').length <= 8) {
      return { level: 2, text: line };
    }

    return null;
  }

  private detectList(line: string): boolean {
    if (!this.options.extractLists) return false;
    return LIST_PATTERNS.some(pattern => pattern.test(line));
  }

  private async extractTOC(pdfLibDoc: PDFLibDocument): Promise<TableOfContents | undefined> {
    try {
      const outlines = pdfLibDoc.catalog.lookup(PDFName.of('Outlines'));
      if (!outlines || !(outlines instanceof PDFDict)) {
        return undefined;
      }

      const items = await this.extractOutlineItems(outlines, pdfLibDoc);
      return items.length > 0 ? { items } : undefined;
    } catch {
      return undefined;
    }
  }

  private async extractOutlineItems(
    outlineDict: PDFDict,
    pdfLibDoc: PDFLibDocument,
    level: number = 0
  ): Promise<TOCItem[]> {
    const items: TOCItem[] = [];
    
    try {
      const first = outlineDict.lookup(PDFName.of('First'));
      if (!first || !(first instanceof PDFDict)) {
        return items;
      }

      let current: PDFDict | undefined = first;
      let iterations = 0;
      const maxIterations = 1000;

      while (current && iterations < maxIterations) {
        iterations++;
        
        const titleObj = current.lookup(PDFName.of('Title'));
        const title = titleObj instanceof PDFString ? titleObj.decodeText() : 'Untitled';
        
        const dest = current.lookup(PDFName.of('Dest'));
        let pageNumber = 1;
        
        if (dest instanceof PDFArray && dest.size() > 0) {
          const pageRef = dest.get(0);
          if (pageRef) {
            const pages = pdfLibDoc.getPages();
            for (let i = 0; i < pages.length; i++) {
              if (pages[i].ref === pageRef) {
                pageNumber = i + 1;
                break;
              }
            }
          }
        }

        const children = await this.extractOutlineItems(current, pdfLibDoc, level + 1);
        
        items.push({
          title,
          level,
          pageNumber,
          children: children.length > 0 ? children : undefined,
        });

        const nextRef: unknown = current.lookup(PDFName.of('Next'));
        current = nextRef instanceof PDFDict ? nextRef : undefined;
      }
    } catch {
      // Silently handle errors in TOC extraction
    }

    return items;
  }

  extractHeadings(pages: Page[]): HeadingInfo[] {
    const headings: HeadingInfo[] = [];

    for (const page of pages) {
      for (const element of page.elements) {
        if (element.type === 'heading' && element.level !== undefined) {
          headings.push({
            text: element.text,
            level: element.level,
            pageNumber: page.number,
            position: element.bbox?.y || 0,
          });
        }
      }
    }

    return headings;
  }
}

export interface ParserOptions {
  extractHeadings?: boolean;
  extractTables?: boolean;
  extractLists?: boolean;
  headingPatterns?: RegExp[];
}

export function createParser(options?: ParserOptions): PDFParser {
  return new PDFParser(options);
}