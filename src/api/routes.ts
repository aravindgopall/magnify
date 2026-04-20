import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { SQLiteQueryPipeline, createSQLiteQueryPipeline } from '../query/sqlite-pipeline.js';
import { ParallelQueryPipeline, createParallelQueryPipeline } from '../query/parallel-query-pipeline.js';
import { ingestPDF } from '../ingest/pipeline.js';
import { getDatabase } from '../db/database.js';
import type { ExtractionType } from '../types/index.js';

export interface APIContext {
  queryPipeline: SQLiteQueryPipeline;
  parallelQueryPipeline: ParallelQueryPipeline;
}

export interface APIConfig {
  maxFileSize: number;
}

const defaultAPIConfig: APIConfig = {
  maxFileSize: 50 * 1024 * 1024,
};

export function createRouter(context: APIContext): Router {
  const router = express.Router();

  router.post('/ingest', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { filePath } = req.body as { filePath: string };

      if (!filePath) {
        return res.status(400).json({ error: 'filePath is required' });
      }

      const result = await ingestPDF(filePath);

      res.json({
        documentId: result.documentId,
        totalPages: result.totalPages,
        chunks: {
          fixed: result.fixedChunks,
          heading: result.headingChunks,
          toc: result.tocChunks,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/query', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { query, extractionType } = req.body as {
        query: string;
        extractionType?: ExtractionType;
      };

      if (!query) {
        return res.status(400).json({ error: 'query is required' });
      }

      const result = await context.queryPipeline.execute({ query, extractionType });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/query-agents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { query, extractionType } = req.body as {
        query: string;
        extractionType?: ExtractionType;
      };

      if (!query) {
        return res.status(400).json({ error: 'query is required' });
      }

      const result = await context.queryPipeline.execute({ query, extractionType });

      res.json({
        query,
        result,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/query-parallel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { query, extractionType } = req.body as {
        query: string;
        extractionType?: ExtractionType;
      };

      if (!query) {
        return res.status(400).json({ error: 'query is required' });
      }

      const result = await context.parallelQueryPipeline.execute({ query, extractionType });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const fixedDb = getDatabase('fixed');
      const headingDb = getDatabase('heading');
      const tocDb = getDatabase('toc');
      
      const fixedCount = fixedDb.getChunkCount();
      const headingCount = headingDb.getChunkCount();
      const tocCount = tocDb.getChunkCount();

      res.json({
        status: 'healthy',
        databases: {
          fixed_chunks: { count: fixedCount },
          heading_chunks: { count: headingCount },
          toc_chunks: { count: tocCount },
        },
        totalChunks: fixedCount + headingCount + tocCount,
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const fixedDb = getDatabase('fixed');
      const headingDb = getDatabase('heading');
      const tocDb = getDatabase('toc');

      const fixedDocs = fixedDb.getDocuments();
      const headingDocs = headingDb.getDocuments();
      const tocDocs = tocDb.getDocuments();

      const allDocs = [...fixedDocs, ...headingDocs, ...tocDocs];
      const uniqueDocs = [...new Map(allDocs.map(d => [d.id, d])).values()];

      res.json({
        documents: uniqueDocs.map(d => ({
          id: d.id,
          fileName: d.file_name,
          totalPages: d.total_pages,
          createdAt: d.created_at,
        })),
        chunks: {
          fixed: fixedDb.getChunkCount(),
          heading: headingDb.getChunkCount(),
          toc: tocDb.getChunkCount(),
        },
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

export function createAPIContext(): APIContext {
  const queryPipeline = createSQLiteQueryPipeline();
  const parallelQueryPipeline = createParallelQueryPipeline();
  return { queryPipeline, parallelQueryPipeline };
}
