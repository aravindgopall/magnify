import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createLLMClient, type LLMClient } from '../llm/index.js';
import { createRouter, createAPIContext, initializeAPIContext, type APIContext } from './routes.js';
import { createAgentRoutes } from './agent-routes.js';
import { createPiMonoRoutes } from './pi-mono-routes.js';

export interface ServerConfig {
  port: number;
  host: string;
  llm: {
    provider: 'openai' | 'litellm' | 'mock';
    apiKey?: string;
    model?: string;
    baseURL?: string;
  };
  dataDir?: string;
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
    baseURL: finalConfig.llm.baseURL,
  });
  
  const context = createAPIContext(llmClient);
  
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use('/api', createRouter(context));
  app.use('/api', createAgentRoutes(context));
  app.use('/api', createPiMonoRoutes(context));

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Magnify - Semantic PDF Scraper',
      version: '2.1.0',
      description: 'Upload once, query many times with LLM-powered orchestration',
      features: {
        persistentStorage: true,
        llmConfigured: !!llmClient,
      },
      workflow: {
        '1. Upload': 'POST /api/documents/upload - Upload and group PDF',
        '2a. Query (Native)': 'POST /api/query - Query using native Magnify orchestrator',
        '2b. Query (Pi-Mono)': 'POST /api/query-agents - Query using pi-mono multi-agent pipeline',
      },
      endpoints: {
        'POST /api/documents/upload': 'Upload PDF, returns document ID and groups',
        'GET /api/documents': 'List all uploaded documents',
        'GET /api/documents/:id': 'Get document details and groups',
        'GET /api/documents/:id/groups': 'Get all groups for a document',
        'GET /api/documents/:id/groups/:groupId': 'Get specific group details',
        'DELETE /api/documents/:id': 'Delete a document',
        'POST /api/query': 'Query any document (native Magnify)',
        'POST /api/query-agents': 'Query using pi-mono multi-agent pipeline',
        'POST /api/documents/:id/query': 'Query a specific document (native)',
        'POST /api/documents/:id/query-agents': 'Query using pi-mono agents',
        'GET /api/health': 'Health check with storage stats',
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

export async function startServer(config?: Partial<ServerConfig>): Promise<{ app: Express; server: ReturnType<Express['listen']> }> {
  const finalConfig = { ...defaultServerConfig, ...config };
  const { app, context } = createServer(finalConfig);

  // Initialize document store (load persisted documents)
  await initializeAPIContext(context);

  return new Promise((resolve) => {
    const server = app.listen(finalConfig.port, finalConfig.host, () => {
      console.log(`Magnify PDF Scraper API running at http://${finalConfig.host}:${finalConfig.port}`);
      console.log(`LLM Provider: ${finalConfig.llm.provider}`);
      resolve({ app, server });
    });
  });
}