/**
 * Shared utility functions.
 */

import { removeStopwords, eng } from 'stopword';

/**
 * Tokenize text for BM25 indexing/searching.
 * Lowercases, removes punctuation, splits on whitespace, filters empty tokens,
 * and removes English stop words.
 */
export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Remove English stop words
  return removeStopwords(tokens, eng);
}

/**
 * Tokenize text without stop word removal (for cases where stop words matter).
 */
export function tokenizeWithStopwords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Extract text content from an LLM message object.
 * Handles both string content and array content (e.g., from multi-modal messages).
 */
export function extractTextFromMessage(message: any): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}