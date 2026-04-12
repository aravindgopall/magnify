import { v4 as uuidv4 } from 'uuid';
import type { Chunk, ChunkMetadata, ChunkType, Document, DocumentMetadata } from '../types/index.js';

/**
 * Simple tokenizer for estimating token count.
 * Uses whitespace and punctuation-based tokenization as an approximation.
 * For production, consider using a proper tokenizer like tiktoken.
 */
export function estimateTokenCount(text: string): number {
  // Simple heuristic: ~4 characters per token on average
  // This is a rough approximation; actual token count varies by tokenizer
  return Math.ceil(text.length / 4);
}

/**
 * Split text into sentences.
 */
function splitIntoSentences(text: string): string[] {
  // Match sentence boundaries: period, exclamation, question mark followed by space or end
  const sentenceEndings = /[.!?]+\s+/g;
  const sentences: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = sentenceEndings.exec(text)) !== null) {
    const sentence = text.slice(lastIndex, match.index + match[0].length).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text as last sentence
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    sentences.push(remaining);
  }

  return sentences.length > 0 ? sentences : [text];
}

/**
 * Split text into chunks of approximately targetTokenCount tokens.
 * Respects sentence boundaries to maintain semantic coherence.
 */
export function chunkText(
  text: string,
  targetTokenCount: number = 512,
  overlapTokens: number = 50,
  metadata?: Partial<ChunkMetadata>,
  chunkType: ChunkType = 'text'
): Omit<Chunk, 'id' | 'documentId' | 'position'>[] {
  const sentences = splitIntoSentences(text);
  const chunks: Omit<Chunk, 'id' | 'documentId' | 'position'>[] = [];
  
  let currentChunk: string[] = [];
  let currentTokenCount = 0;
  const overlapSentences: string[] = [];

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokenCount(sentence);

    // If single sentence exceeds target, split it further
    if (sentenceTokens > targetTokenCount) {
      // Flush current chunk if any
      if (currentChunk.length > 0) {
        const chunkText = currentChunk.join(' ');
        chunks.push({
          text: chunkText,
          tokenCount: estimateTokenCount(chunkText),
          pageNumber: metadata?.pageNumber,
          chunkType,
          metadata: {
            ...metadata,
            heading: metadata?.heading,
          },
        });
        currentChunk = [];
        currentTokenCount = 0;
      }

      // Split long sentence by clauses/commas
      const clauses = sentence.split(/,\s*|;\s*/);
      let clauseChunk: string[] = [];
      let clauseTokens = 0;

      for (const clause of clauses) {
        const clauseTokenCount = estimateTokenCount(clause);
        
        if (clauseTokens + clauseTokenCount > targetTokenCount && clauseChunk.length > 0) {
          const chunkText = clauseChunk.join(', ');
          chunks.push({
            text: chunkText,
            tokenCount: estimateTokenCount(chunkText),
            pageNumber: metadata?.pageNumber,
            chunkType,
            metadata: { ...metadata },
          });
          clauseChunk = [clause];
          clauseTokens = clauseTokenCount;
        } else {
          clauseChunk.push(clause);
          clauseTokens += clauseTokenCount;
        }
      }

      if (clauseChunk.length > 0) {
        const chunkText = clauseChunk.join(', ');
        chunks.push({
          text: chunkText,
          tokenCount: estimateTokenCount(chunkText),
          pageNumber: metadata?.pageNumber,
          chunkType,
          metadata: { ...metadata },
        });
      }
      continue;
    }

    // Check if adding this sentence would exceed target
    if (currentTokenCount + sentenceTokens > targetTokenCount && currentChunk.length > 0) {
      // Save current chunk
      const chunkText = currentChunk.join(' ');
      chunks.push({
        text: chunkText,
        tokenCount: estimateTokenCount(chunkText),
        pageNumber: metadata?.pageNumber,
        chunkType,
        metadata: { ...metadata },
      });

      // Start new chunk with overlap
      if (overlapTokens > 0) {
        // Find sentences that fit within overlap budget
        const overlapChunk: string[] = [];
        let overlapTokenCount = 0;
        
        for (let i = currentChunk.length - 1; i >= 0; i--) {
          const s = currentChunk[i];
          const sTokens = estimateTokenCount(s);
          if (overlapTokenCount + sTokens <= overlapTokens) {
            overlapChunk.unshift(s);
            overlapTokenCount += sTokens;
          } else {
            break;
          }
        }
        
        currentChunk = [...overlapChunk, sentence];
        currentTokenCount = overlapTokenCount + sentenceTokens;
      } else {
        currentChunk = [sentence];
        currentTokenCount = sentenceTokens;
      }
    } else {
      currentChunk.push(sentence);
      currentTokenCount += sentenceTokens;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join(' ');
    chunks.push({
      text: chunkText,
      tokenCount: estimateTokenCount(chunkText),
      pageNumber: metadata?.pageNumber,
      chunkType,
      metadata: { ...metadata },
    });
  }

  return chunks;
}

/**
 * Chunk a document into smaller pieces.
 * Processes the document text and creates chunks with proper metadata.
 */
export function chunkDocument(
  documentId: string,
  text: string,
  options: {
    chunkSize?: number;
    chunkOverlap?: number;
    fileName?: string;
    metadata?: DocumentMetadata;
    pageTexts?: string[]; // Optional: array of page texts for page number tracking
  } = {}
): Chunk[] {
  const {
    chunkSize = 512,
    chunkOverlap = 50,
    fileName,
    metadata,
    pageTexts,
  } = options;

  const chunks: Chunk[] = [];
  
  if (pageTexts && pageTexts.length > 0) {
    // Process page by page for page number tracking
    let globalPosition = 0;
    
    for (let pageNum = 0; pageNum < pageTexts.length; pageNum++) {
      const pageText = pageTexts[pageNum];
      if (!pageText.trim()) continue;

      const pageChunks = chunkText(pageText, chunkSize, chunkOverlap, {
        pageNumber: pageNum + 1,
        fileName,
        source: fileName,
      });

      for (const chunk of pageChunks) {
        chunks.push({
          ...chunk,
          id: uuidv4(),
          documentId,
          position: globalPosition++,
        });
      }
    }
  } else {
    // Process entire text as one
    const rawChunks = chunkText(text, chunkSize, chunkOverlap, {
      fileName,
      source: fileName,
    });

    for (let i = 0; i < rawChunks.length; i++) {
      chunks.push({
        ...rawChunks[i],
        id: uuidv4(),
        documentId,
        position: i,
      });
    }
  }

  // Link chunks (previous/next)
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      chunks[i].metadata.previousChunkId = chunks[i - 1].id;
    }
    if (i < chunks.length - 1) {
      chunks[i].metadata.nextChunkId = chunks[i + 1].id;
    }
  }

  return chunks;
}

/**
 * Create a document with chunks from text content.
 */
export function createDocument(
  text: string,
  options: {
    id?: string;
    fileName?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    metadata?: DocumentMetadata;
    pageTexts?: string[];
  } = {}
): Document {
  const documentId = options.id || uuidv4();
  const chunks = chunkDocument(documentId, text, {
    chunkSize: options.chunkSize || 512,
    chunkOverlap: options.chunkOverlap || 50,
    fileName: options.fileName,
    metadata: options.metadata,
    pageTexts: options.pageTexts,
  });

  const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

  return {
    id: documentId,
    fileName: options.fileName || 'unknown',
    source: text,
    metadata: {
      ...options.metadata,
      totalTokens,
      totalChunks: chunks.length,
    },
    chunks,
    indexed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create a single chunk from extracted content (table, image, or text).
 * Tables and images are kept as single chunks to preserve their structure.
 * Internal helper used by createChunksFromExtractedContent.
 */
function createChunkFromContent(
  documentId: string,
  content: {
    type: ChunkType;
    text: string;
    page_number: number;
    position: number;
    metadata?: Record<string, unknown>;
  },
  options: {
    fileName?: string;
  } = {}
): Chunk {
  return {
    id: uuidv4(),
    documentId,
    text: content.text,
    tokenCount: estimateTokenCount(content.text),
    pageNumber: content.page_number,
    position: content.position,
    chunkType: content.type,
    metadata: {
      fileName: options.fileName,
      source: options.fileName,
      pageNumber: content.page_number,
      chunkType: content.type,
      ...content.metadata,
    },
  };
}

/**
 * Create chunks from extracted PDF content.
 * Handles text, tables, and images differently:
 * - Text: Split into chunks by sentence boundaries
 * - Tables: Keep as single chunks (markdown format)
 * - Images: Keep as single chunks (description text)
 */
export function createChunksFromExtractedContent(
  documentId: string,
  extractedContent: Array<{
    type: ChunkType;
    text: string;
    page_number: number;
    position: number;
    metadata?: Record<string, unknown>;
  }>,
  options: {
    chunkSize?: number;
    chunkOverlap?: number;
    fileName?: string;
  } = {}
): Chunk[] {
  const { chunkSize = 512, chunkOverlap = 50, fileName } = options;
  const chunks: Chunk[] = [];
  let globalPosition = 0;

  for (const content of extractedContent) {
    if (content.type === 'text') {
      // For text content, apply regular chunking
      const textChunks = chunkText(
        content.text,
        chunkSize,
        chunkOverlap,
        {
          pageNumber: content.page_number,
          fileName,
          source: fileName,
        },
        'text'
      );

      for (const chunk of textChunks) {
        chunks.push({
          ...chunk,
          id: uuidv4(),
          documentId,
          position: globalPosition++,
        });
      }
    } else {
      // For tables and images, keep as single chunks
      const chunk = createChunkFromContent(documentId, content, { fileName });
      chunk.position = globalPosition++;
      chunks.push(chunk);
    }
  }

  // Link chunks (previous/next)
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      chunks[i].metadata.previousChunkId = chunks[i - 1].id;
    }
    if (i < chunks.length - 1) {
      chunks[i].metadata.nextChunkId = chunks[i + 1].id;
    }
  }

  return chunks;
}

