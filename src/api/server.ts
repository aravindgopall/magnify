import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createRouter, createAPIContext, type APIContext } from './routes.js';

export interface ServerConfig {
  port: number;
  host: string;
  dataDir?: string;
}

const defaultServerConfig: ServerConfig = {
  port: 3000,
  host: '0.0.0.0',
};

export function createServer(config?: Partial<ServerConfig>): { app: Express; context: APIContext } {
  const finalConfig = { ...defaultServerConfig, ...config };
  
  const context = createAPIContext();
  
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use('/api', createRouter(context));

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Magnify - Semantic PDF Scraper',
      version: '3.0.0',
      description: 'Ingest PDFs, query with AI-powered multi-agent orchestration',
      features: {
        sqliteDatabases: true,
        parallelSubagents: true,
        llmClassification: true,
      },
      cli: {
        'npm ingest <file_path>': 'Ingest a PDF into SQLite databases',
        'npm query "question"': 'Query ingested documents',
      },
      endpoints: {
        'POST /api/ingest': 'Ingest a PDF file',
        'POST /api/query': 'Query documents (auto-classified)',
        'POST /api/query-agents': 'Query using pi-mono multi-agent pipeline',
        'GET /api/health': 'Health check with database stats',
        'GET /api/stats': 'Get ingestion statistics',
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
  const { app } = createServer(finalConfig);

  return new Promise((resolve) => {
    const server = app.listen(finalConfig.port, finalConfig.host, () => {
      console.log(`Magnify PDF Scraper API running at http://${finalConfig.host}:${finalConfig.port}`);
      console.log('');
      console.log('CLI Commands:');
      console.log('  npm ingest <file_path>  - Ingest a PDF');
      console.log('  npm query "question"    - Query documents');
      console.log('');
      resolve({ app, server });
    });
  });
}
