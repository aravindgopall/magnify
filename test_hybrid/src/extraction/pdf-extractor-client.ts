/**
 * Client for the PDF Extractor Service
 * 
 * This client communicates with the Python-based PDF extraction server
 * that uses PyMuPDF for extracting text, tables, and images.
 */

import type { ChunkType } from '../types/index.js';
import FormData from 'form-data';
import fetch from 'node-fetch';

/**
 * Extracted content from a PDF.
 */
export interface ExtractedContent {
  type: ChunkType;
  text: string;
  page_number: number;
  position: number;
  metadata: Record<string, unknown>;
}

/**
 * Result of PDF extraction.
 */
export interface ExtractionResult {
  contents: ExtractedContent[];
  total_pages: number;
  file_name: string;
  metadata: {
    total_contents: number;
    text_count: number;
    table_count: number;
    image_count: number;
  };
}

/**
 * Configuration for the PDF extractor client.
 */
export interface PDFExtractorConfig {
  baseUrl: string;
  timeout?: number;
  extractImages?: boolean;
  extractTables?: boolean;
}

/**
 * Client for the PDF Extractor Service.
 */
export class PDFExtractorClient {
  private baseUrl: string;
  private timeout: number;
  private extractImages: boolean;
  private extractTables: boolean;

  constructor(config: PDFExtractorConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 300000; // 5 minutes default (large PDFs with images can be slow)
    this.extractImages = config.extractImages ?? true;
    this.extractTables = config.extractTables ?? true;
  }

  /**
   * Check if the extraction service is healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract content from a PDF file.
   * 
   * @param pdfBytes - Raw PDF file bytes
   * @param fileName - Name of the file
   * @returns Extraction result with all content
   */
  async extractPdf(pdfBytes: Buffer, fileName: string): Promise<ExtractionResult> {
    const formData = new FormData();
    formData.append('file', pdfBytes, {
      filename: fileName,
      contentType: 'application/pdf',
    });
    
    const params = new URLSearchParams({
      extract_images: String(this.extractImages),
      extract_tables: String(this.extractTables),
    });

    const headers = formData.getHeaders();
    const response = await fetch(`${this.baseUrl}/extract?${params}`, {
      method: 'POST',
      body: formData,
      headers: headers as Record<string, string>,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PDF extraction failed: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<ExtractionResult>;
  }

  /**
   * Extract content from a PDF file at a given path.
   * 
   * @param filePath - Path to the PDF file
   * @returns Extraction result with all content
   */
  async extractPdfFromPath(filePath: string): Promise<ExtractionResult> {
    const fs = await import('fs');
    const path = await import('path');
    
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    
    const pdfBytes = fs.readFileSync(absolutePath);
    const fileName = path.basename(absolutePath);
    
    return this.extractPdf(pdfBytes, fileName);
  }
}

/**
 * Create a PDF extractor client.
 */
export function createPDFExtractor(config: PDFExtractorConfig): PDFExtractorClient {
  return new PDFExtractorClient(config);
}

/**
 * Default PDF extractor using local extraction server.
 */
export function createDefaultPDFExtractor(options?: { 
  extractImages?: boolean; 
  extractTables?: boolean;
}): PDFExtractorClient {
  return createPDFExtractor({
    baseUrl: process.env.PDF_EXTRACTOR_URL || 'http://localhost:8001',
    timeout: parseInt(process.env.PDF_EXTRACT_TIMEOUT || '300000', 10),
    extractImages: options?.extractImages ?? process.env.PDF_EXTRACT_IMAGES !== 'false',
    extractTables: options?.extractTables ?? process.env.PDF_EXTRACT_TABLES !== 'false',
  });
}
