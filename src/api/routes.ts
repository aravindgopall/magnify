import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { GroupingStrategy } from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
import { DocumentStore, createDocumentStore } from '../store/index.js';
import { QueryOrchestrator, createQueryOrchestrator, type QueryRequest } from '../orchestrator/index.js';

export interface APIContext {
  documentStore: DocumentStore;
  queryOrchestrator: QueryOrchestrator;
  llmClient: LLMClient;
}

export interface APIConfig {
  maxFileSize: number;
}

const defaultAPIConfig: APIConfig = {
  maxFileSize: 50 * 1024 * 1024,
};

export function createRouter(context: APIContext): Router {
  const router = express.Router();

  router.post('/documents/upload', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { source, fileName, groupingStrategy } = req.body as {
        source: string;
        fileName?: string;
        groupingStrategy?: GroupingStrategy;
      };

      if (!source) {
        return res.status(400).json({ error: 'Source is required (file path or base64 encoded PDF)' });
      }

      const stored = await context.documentStore.upload(source, {
        fileName,
        groupingStrategy: groupingStrategy || 'hybrid',
      });

      res.json({
        documentId: stored.id,
        metadata: {
          ...stored.metadata,
          pageCount: stored.document.metadata.pageCount,
          title: stored.document.metadata.title,
        },
        groups: stored.groups.map(g => ({
          id: g.id,
          title: g.title,
          startPage: g.startPage,
          endPage: g.endPage,
          type: g.type,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/documents', (_req: Request, res: Response) => {
    const documents = context.documentStore.list();
    res.json({
      documents: documents.map(d => ({
        id: d.id,
        metadata: {
          ...d.metadata,
          pageCount: d.document.metadata.pageCount,
          title: d.document.metadata.title,
        },
        groupCount: d.groups.length,
      })),
    });
  });

  router.get('/documents/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const stored = context.documentStore.get(id);

    if (!stored) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({
      documentId: stored.id,
      metadata: {
        ...stored.metadata,
        pageCount: stored.document.metadata.pageCount,
        title: stored.document.metadata.title,
        author: stored.document.metadata.author,
      },
      groups: stored.groups.map(g => ({
        id: g.id,
        title: g.title,
        startPage: g.startPage,
        endPage: g.endPage,
        type: g.type,
      })),
      toc: stored.document.toc,
    });
  });

  router.get('/documents/:id/groups', (req: Request, res: Response) => {
    const { id } = req.params;
    const stored = context.documentStore.get(id);

    if (!stored) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({
      documentId: id,
      groups: stored.groups.map(g => ({
        id: g.id,
        title: g.title,
        startPage: g.startPage,
        endPage: g.endPage,
        type: g.type,
        pageCount: g.pages.length,
      })),
    });
  });

  router.get('/documents/:id/groups/:groupId', (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const group = context.documentStore.getGroup(id, groupId);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({
      id: group.id,
      title: group.title,
      startPage: group.startPage,
      endPage: group.endPage,
      type: group.type,
      pageCount: group.pages.length,
      preview: group.pages.map(p => ({
        number: p.number,
        textPreview: p.text.substring(0, 200) + (p.text.length > 200 ? '...' : ''),
      })),
    });
  });

  router.delete('/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const deleted = await context.documentStore.delete(id);

      if (!deleted) {
        return res.status(404).json({ error: 'Document not found' });
      }

      res.json({ message: 'Document deleted', documentId: id });
    } catch (error) {
      next(error);
    }
  });

  router.post('/query', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId, query, groupIds, extractionType, customPrompt } = req.body as QueryRequest;

      if (!documentId || !query) {
        return res.status(400).json({ error: 'documentId and query are required' });
      }

      const response = await context.queryOrchestrator.execute({
        documentId,
        query,
        groupIds,
        extractionType,
        customPrompt,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/documents/:id/query', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { query, groupIds, extractionType, customPrompt } = req.body as Omit<QueryRequest, 'documentId'>;

      if (!query) {
        return res.status(400).json({ error: 'query is required' });
      }

      const response = await context.queryOrchestrator.execute({
        documentId: id,
        query,
        groupIds,
        extractionType,
        customPrompt,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', async (_req: Request, res: Response) => {
    const stats = await context.documentStore.getStats();
    res.json({
      status: 'healthy',
      documentsStored: stats.documentCount,
      persistence: stats.persistence,
      llmConfigured: !!context.llmClient,
    });
  });

  return router;
}

export function createAPIContext(llmClient: LLMClient): APIContext {
  const documentStore = createDocumentStore(llmClient);
  const queryOrchestrator = createQueryOrchestrator(llmClient, documentStore);

  return {
    documentStore,
    queryOrchestrator,
    llmClient,
  };
}

/**
 * Initialize the API context by loading persisted documents
 */
export async function initializeAPIContext(context: APIContext): Promise<void> {
  await context.documentStore.initialize();
}