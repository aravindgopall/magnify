/**
 * PDF Extraction Module
 * 
 * This module provides functionality to extract text, tables, and images from PDFs.
 * It uses a Python-based extraction server (PyMuPDF) for the actual extraction.
 */

export {
  PDFExtractorClient,
  createPDFExtractor,
  createDefaultPDFExtractor,
  type ExtractedContent,
  type ExtractionResult,
  type PDFExtractorConfig,
} from './pdf-extractor-client.js';