/**
 * Magnify Extension for Pi-Mono
 * Integrates PDF document querying with multi-agent orchestration
 * 
 * This extension allows pi-mono to query PDF documents stored in the magnify server
 * using a 4-step multi-agent pipeline: Rewriter → Explorer → Reader → Main Agent
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Configuration
const DEFAULT_MAGNIFY_URL = process.env.MAGNIFY_URL || 'http://localhost:3000';

interface MagnifyConfig {
  baseUrl: string;
  agentsPath?: string;
}

interface DocumentInfo {
  id: string;
  title?: string;
  pageCount: number;
  groupCount: number;
}

interface GroupInfo {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  type: 'toc' | 'heading' | 'range';
}

interface QueryResult {
  success: boolean;
  originalQuery: string;
  explorerQuery?: string;
  readerQuery?: string;
  documentId?: string;
  matchedGroups?: Array<{
    groupId: string;
    title: string;
    pages: string;
    relevanceScore: number;
  }>;
  answer: string;
  sources?: Array<{
    groupId: string;
    title: string;
    pages: string;
    excerpt?: string;
  }>;
  tables?: Array<{
    title?: string;
    headers: string[];
    rows: string[][];
  }>;
  images?: Array<{
    description?: string;
    pageNumber: number;
    path: string;
  }>;
  keyEntities?: string[];
  confidence?: number;
  gaps?: string[];
  processingTime?: number;
  error?: string;
}

// API Client for Magnify Backend
class MagnifyClient {
  constructor(private baseUrl: string) {}

  async uploadDocument(pdfPath: string, fileName?: string): Promise<{ documentId: string }> {
    const response = await fetch(`${this.baseUrl}/api/documents/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: pdfPath,
        fileName: fileName || path.basename(pdfPath),
        groupingStrategy: 'hybrid', // Use all grouping strategies
      }),
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const data = await response.json();
    return { documentId: data.documentId };
  }

  async listDocuments(): Promise<DocumentInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/documents`);
    if (!response.ok) {
      throw new Error(`Failed to list documents: ${response.statusText}`);
    }
    const data = await response.json();
    return data.documents.map((d: any) => ({
      id: d.id,
      title: d.metadata?.title,
      pageCount: d.metadata?.pageCount || 0,
      groupCount: d.groupCount || 0,
    }));
  }

  async getGroups(documentId: string): Promise<GroupInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/documents/${documentId}/groups`);
    if (!response.ok) {
      throw new Error(`Failed to get groups: ${response.statusText}`);
    }
    const data = await response.json();
    return data.groups;
  }

  async executeMultiAgentQuery(query: string, documentId?: string, extractionType?: string): Promise<QueryResult> {
    // Step 1: Spawn Rewriter Agent
    const rewriterResult = await this.spawnAgent('rewriter', {
      task: `Transform this query into explorer and reader versions:\n${query}`,
      outputSchema: {
        explorer_query: "string",
        reader_query: "string",
      },
    });

    const { explorer_query, reader_query } = rewriterResult.output;

    // Infer extractionType if not provided
    const finalExtractionType = extractionType || this.inferExtractionType(query);

    // Step 2: Spawn Explorer Agent
    const documents = documentId ? [documentId] : (await this.listDocuments()).map(d => d.id);
    
    if (documents.length === 0) {
      return {
        success: false,
        originalQuery: query,
        answer: '',
        error: 'No documents available. Please upload a PDF document first.',
      };
    }

    const targetDocId = documents[0]; // Use first document or specified one

    const explorerResult = await this.spawnAgent('explorer', {
      task: `Find relevant sections for: ${explorer_query}`,
      context: {
        documentId: targetDocId,
        explorer_query,
        magnifyUrl: this.baseUrl,
      },
    });

    const matchedGroups = explorerResult.output.matchedGroups || [];

    if (matchedGroups.length === 0) {
      return {
        success: false,
        originalQuery: query,
        explorerQuery: explorer_query,
        readerQuery: reader_query,
        answer: '',
        matchedGroups: [],
        error: 'No relevant sections found in the document.',
      };
    }

    // Step 3: Spawn Reader Agent
    const readerResult = await this.spawnAgent('reader', {
      task: `Extract detailed information: ${reader_query}`,
      context: {
        extractionType: finalExtractionType,
        documentId: targetDocId,
        groupIds: matchedGroups.map((g: any) => g.groupId),
        reader_query,
        magnifyUrl: this.baseUrl,
      },
    });

    // Step 4: Main Agent synthesis (done by Reader for now)
    return {
      success: true,
      originalQuery: query,
      explorerQuery: explorer_query,
      readerQuery: reader_query,
      documentId: targetDocId,
      matchedGroups,
      answer: readerResult.output.answer || '',
      sources: readerResult.output.sources || [],
      tables: readerResult.output.tables || [],
      images: readerResult.output.images || [],
      keyEntities: readerResult.output.keyEntities || [],
      confidence: readerResult.output.confidence || 0.8,
      gaps: readerResult.output.gaps || [],
      processingTime: Date.now() - readerResult.startTime,
    };
  }

  private inferExtractionType(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Summary queries
    if (/^(what is|summarize|give me an overview|overview of)/i.test(lowerQuery)) {
      return 'summary';
    }
    
    // Entity extraction queries
    if (/^(list all|what are the|find all|show me all)/i.test(lowerQuery)) {
      return 'entities';
    }
    
    // Comprehensive explanation queries (default)
    if (/^(explain|describe|how does|how do|what are the steps)/i.test(lowerQuery)) {
      return 'full';
    }
    
    return 'full'; // default to comprehensive
  }

  private async spawnAgent(
    agentName: string,
    params: {
      task: string;
      context?: Record<string, any>;
      outputSchema?: Record<string, string>;
    }
  ): Promise<{
    output: any;
    startTime: number;
    messages?: string[];
  }> {
    const startTime = Date.now();

    // Build task with embedded context
    const contextStr = params.context ? JSON.stringify(params.context, null, 2) : '{}';
    const fullTask = `${params.task}\n\n**Context Data:**\n${contextStr}`;

    return new Promise((resolve, reject) => {
      // Spawn pi process with agent
      // Using --mode json to get structured output
      // Using -p for prompt mode
      // Using --no-session to avoid saving history
      const args = [
        '--mode', 'json',
        '-p',
        '--no-session',
        '--agent', agentName,
        fullTask
      ];

      const piProcess = spawn('pi', args, {
        env: {
          ...process.env,
          MAGNIFY_URL: this.baseUrl,
        },
        stdio: ['inherit', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });

      let stdout = '';
      let stderr = '';
      const messages: string[] = [];

      // Capture stdout
      piProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        
        // Try to parse streaming messages
        try {
          const lines = text.split('\n').filter(l => l.trim());
          for (const line of lines) {
            if (line.startsWith('{') && line.includes('"role"')) {
              try {
                const msg = JSON.parse(line);
                messages.push(msg);
              } catch {
                // Not a message object
              }
            }
          }
        } catch {
          // Ignore parse errors during streaming
        }
      });

      // Capture stderr
      piProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      piProcess.on('close', (exitCode) => {
        if (exitCode !== 0) {
          reject(new Error(`Agent ${agentName} failed (exit ${exitCode}):\n${stderr}`));
          return;
        }

        // Parse final output
        try {
          // In JSON mode, pi outputs structured data
          // Try to find the last complete JSON object
          const lines = stdout.split('\n').filter(l => l.trim());
          let output: any = null;

          // Look for JSON objects from the end
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.startsWith('{')) {
              try {
                const parsed = JSON.parse(line);
                // Check if this looks like agent output (not a tool call)
                if (parsed.result || parsed.answer || parsed.explorer_query || parsed.matchedGroups) {
                  output = parsed;
                  break;
                }
              } catch {
                continue;
              }
            }
          }

          if (!output) {
            // Fallback: try to parse entire stdout
            try {
              output = JSON.parse(stdout);
            } catch {
              // Last resort: treat as text response
              output = { result: stdout.trim() };
            }
          }

          resolve({
            output,
            startTime,
            messages,
          });
        } catch (err) {
          reject(new Error(`Failed to parse agent output: ${err}\nStdout: ${stdout.substring(0, 500)}\nStderr: ${stderr}`));
        }
      });

      piProcess.on('error', (err) => {
        reject(new Error(`Failed to spawn pi process: ${err}. Make sure 'pi' is installed and in PATH.`));
      });

      // Timeout after 10 minutes
      const timeout = setTimeout(() => {
        if (!piProcess.killed) {
          piProcess.kill('SIGTERM');
          reject(new Error(`Agent ${agentName} timed out after 10 minutes`));
        }
      }, 10 * 60 * 1000);

      // Clear timeout on completion
      piProcess.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }
}

// Extension Factory
export default function createMagnifyExtension(extensionAPI: ExtensionAPI) {
  // Get home directory for agents path
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  
  const config: MagnifyConfig = {
    baseUrl: DEFAULT_MAGNIFY_URL,
    agentsPath: path.join(homeDir, '.pi', 'agent', 'agents'),
  };

  const client = new MagnifyClient(config.baseUrl);

  // Register tools
  extensionAPI.registerTool({
    name: 'magnify_upload_document',
    description: 'Upload a PDF document to the magnify server for processing. The document will be extracted and stored with all grouping strategies (TOC, heading-based, and fixed page ranges).',
    parameters: Type.Object({
      pdfPath: Type.String({
        description: 'Absolute path to the PDF file to upload',
      }),
      fileName: Type.Optional(Type.String({
        description: 'Optional display name for the document',
      })),
    }),
    execute: async (params: { pdfPath: string; fileName?: string }) => {
      try {
        const result = await client.uploadDocument(params.pdfPath, params.fileName);
        
        return `✓ Document uploaded successfully\nDocument ID: ${result.documentId}\n\nThe document has been processed and is ready for queries.`;
      } catch (error) {
        throw new Error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
  });

  extensionAPI.registerTool({
    name: 'magnify_list_documents',
    description: 'List all PDF documents stored in the magnify server',
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const documents = await client.listDocuments();
        
        if (documents.length === 0) {
          return 'No documents found. Upload a PDF using magnify_upload_document.';
        }

        const docList = documents.map(d => 
          `• ${d.title || 'Untitled'} (${d.id})\n  ${d.pageCount} pages, ${d.groupCount} groups`
        ).join('\n\n');

        return `Found ${documents.length} document(s):\n\n${docList}`;
      } catch (error) {
        throw new Error(`Failed to list documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
  });

  extensionAPI.registerTool({
    name: 'magnify_query',
    description: 'Query PDF documents using the multi-agent pipeline. This will spawn Rewriter, Explorer, and Reader agents to find and extract relevant information from the documents.',
    parameters: Type.Object({
      query: Type.String({
        description: 'The question or query about the PDF document content',
      }),
      documentId: Type.Optional(Type.String({
        description: 'Optional specific document ID to query. If not provided, queries the first available document.',
      })),
      extractionType: Type.Optional(Type.Union([
        Type.Literal('summary'),
        Type.Literal('entities'),
        Type.Literal('full'),
        Type.Literal('custom'),
      ], {
        description: 'Extraction strategy: summary (concise), entities (structured items), full (comprehensive), custom (specific format). Default: inferred from query or "full".',
      })),
    }),
    execute: async (params: { query: string; documentId?: string; extractionType?: string }) => {
      try {
        const result = await client.executeMultiAgentQuery(params.query, params.documentId, params.extractionType);

        if (!result.success) {
          throw new Error(result.error || 'Query failed');
        }

        // Format the response
        let markdown = `# Query Result\n\n`;
        markdown += `**Original Query:** ${result.originalQuery}\n\n`;
        
        if (result.confidence !== undefined) {
          markdown += `**Confidence:** ${(result.confidence * 100).toFixed(1)}%\n\n`;
        }

        markdown += `## Answer\n\n${result.answer}\n\n`;

        if (result.sources && result.sources.length > 0) {
          markdown += `## Sources\n\n`;
          result.sources.forEach(s => {
            markdown += `- **${s.title}** (Pages ${s.pages})\n`;
            if (s.excerpt) {
              markdown += `  > ${s.excerpt}\n`;
            }
          });
          markdown += '\n';
        }

        if (result.tables && result.tables.length > 0) {
          markdown += `## Tables Found\n\n`;
          result.tables.forEach((table, idx) => {
            if (table.title) {
              markdown += `### ${table.title}\n\n`;
            }
            markdown += `| ${table.headers.join(' | ')} |\n`;
            markdown += `| ${table.headers.map(() => '---').join(' | ')} |\n`;
            table.rows.forEach(row => {
              markdown += `| ${row.join(' | ')} |\n`;
            });
            markdown += '\n';
          });
        }

        if (result.keyEntities && result.keyEntities.length > 0) {
          markdown += `## Key Entities\n\n`;
          markdown += result.keyEntities.map(e => `- ${e}`).join('\n');
          markdown += '\n\n';
        }

        if (result.gaps && result.gaps.length > 0) {
          markdown += `## ⚠️ Information Gaps\n\n`;
          result.gaps.forEach(gap => {
            markdown += `- ${gap}\n`;
          });
          markdown += '\n';
        }

        if (result.processingTime) {
          markdown += `\n---\n*Processed in ${(result.processingTime / 1000).toFixed(2)}s*`;
        }

        return markdown;
      } catch (error) {
        throw new Error(`Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
  });

  return {
    name: 'magnify',
    version: '1.0.0',
  };
}
