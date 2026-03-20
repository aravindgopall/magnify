import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createLLMClient, type LLMClient } from '../llm/index.js';
import { createRouter, createAPIContext, type APIContext } from './routes.js';

export interface ServerConfig {
  port: number;
  host: string;
  llm: {
    provider: 'openai' | 'mock';
    apiKey?: string;
    model?: string;
  };
}

const defaultServerConfig: ServerConfig = {
  port: 3000,
  host: '0.0.0.0',
  llm: {
    provider: 'mock',
  },
};

export function createServer(config?: Partial<ServerConfig>): { app: Express; context: APIContext } {
  const finalConfig = { ...defaultServerConfig, ...config };
  
  const llmClient = createLLMClient({
    provider: finalConfig.llm.provider,
    apiKey: finalConfig.llm.apiKey,
    model: finalConfig.llm.model,
  });
  
  const context = createAPIContext(llmClient);
  
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use('/api', createRouter(context));

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Magnify - Semantic PDF Scraper',
      version: '2.0.0',
      description: 'Upload once, query many times with LLM-powered orchestration',
      llmConfigured: !!llmClient,
      workflow: {
        '1. Upload': 'POST /api/documents/upload - Upload and group PDF',
        '2. Query': 'POST /api/query or POST /api/documents/:id/query - Query the document',
      },
      endpoints: {
        'POST /api/documents/upload': 'Upload PDF, returns document ID and groups',
        'GET /api/documents': 'List all uploaded documents',
        'GET /api/documents/:id': 'Get document details and groups',
        'GET /api/documents/:id/groups': 'Get all groups for a document',
        'GET /api/documents/:id/groups/:groupId': 'Get specific group details',
        'DELETE /api/documents/:id': 'Delete a document',
        'POST /api/query': 'Query any document (requires documentId in body)',
        'POST /api/documents/:id/query': 'Query a specific document',
        'GET /api/health': 'Health check',
      },
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  });

  return { app, context };
}

export function startServer(config?: Partial<ServerConfig>): { app: Express; server: ReturnType<Express['listen']> } {
  const finalConfig = { ...defaultServerConfig, ...config };
  const { app } = createServer(finalConfig);

  const server = app.listen(finalConfig.port, finalConfig.host, () => {
    console.log(`Magnify PDF Scraper API running at http://${finalConfig.host}:${finalConfig.port}`);
    console.log(`LLM Provider: ${finalConfig.llm.provider}`);
  });

  return { app, server };
}