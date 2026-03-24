/**
 * Agent API Routes for Magnify
 * 
 * These routes provide endpoints for pi-mono agents to interact with the magnify system
 * during the multi-agent pipeline execution.
 */

import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import type { APIContext } from './routes.js';
import type { SourceReference, ExtractedEntity } from '../orchestrator/index.js';

interface AgentRequest {
  task: string;
  context?: Record<string, any>;
  outputSchema?: Record<string, string>;
}

/**
 * Create agent-specific API routes
 */
export function createAgentRoutes(context: APIContext): Router {
  const router = express.Router();

  // Rewriter Agent endpoint
  router.post('/agents/rewriter', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { task, outputSchema } = req.body as AgentRequest;

      if (!task) {
        return res.status(400).json({ error: 'Task is required' });
      }

      // Use LLM to rewrite the query
      const messages = [
        {
          role: 'user' as const,
          content: `You are a query rewriter. Transform this user query into two versions:
1. explorer_query: Short (3-7 words), keyword-focused for matching document section titles
2. reader_query: Detailed, content-focused for deep extraction

User query: "${task}"

Return ONLY valid JSON with exactly these two fields.`
        }
      ];

      const completion = await context.llmClient.complete(messages);

      // Parse the LLM response
      let result;
      try {
        result = JSON.parse(completion.content);
      } catch {
        // Fallback to rule-based rewriting
        result = ruleBasedRewrite(task);
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Explorer Agent endpoint
  router.post('/agents/explorer', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { context: reqContext } = req.body as AgentRequest;

      if (!reqContext?.documentId || !reqContext?.explorer_query) {
        return res.status(400).json({ 
          error: 'documentId and explorer_query are required in context' 
        });
      }

      const { documentId, explorer_query } = reqContext;

      // Get all groups for the document
      const stored = context.documentStore.get(documentId);
      if (!stored) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Match groups against explorer query
      const matchedGroups = matchGroups(explorer_query, stored.groups);

      res.json({
        documentId,
        matchedGroups,
        totalGroupsSearched: stored.groups.length,
        strategy: stored.metadata.groupingStrategy,
      });
    } catch (error) {
      next(error);
    }
  });

  // Reader Agent endpoint
  router.post('/agents/reader', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { context: reqContext } = req.body as AgentRequest;

      if (!reqContext?.documentId || !reqContext?.groupIds || !reqContext?.reader_query) {
        return res.status(400).json({ 
          error: 'documentId, groupIds, and reader_query are required in context' 
        });
      }

      const { documentId, groupIds, reader_query, extractionType } = reqContext;

      // Execute query using orchestrator
      const queryResponse = await context.queryOrchestrator.execute({
        documentId,
        query: reader_query,
        groupIds,
        extractionType: (extractionType as 'summary' | 'entities' | 'full' | 'custom') || 'full',
      });

      const result = queryResponse.result;

      res.json({
        success: true,
        answer: result.answer || '',
        sources: (result.sources || []).map((s: SourceReference) => ({
          groupId: s.groupId,
          title: s.groupTitle || '',
          pages: `${s.startPage}-${s.endPage}`,
          excerpt: s.relevantExcerpt || '',
        })),
        tables: [], // Tables would need to be extracted from the document groups
        images: [], // Images would need to be extracted from the document groups
        keyEntities: (result.entities || []).map((e: ExtractedEntity) => e.name || e.type || ''),
        confidence: result.confidence || 0.8,
        gaps: [],
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Rule-based query rewriting fallback
 */
function ruleBasedRewrite(query: string): { explorer_query: string; reader_query: string } {
  const fillerWords = ['what', 'is', 'the', 'a', 'an', 'how', 'do', 'does', 'can', 'i', 'to', 'for', 'about', 'tell', 'me', 'please'];
  
  // Create explorer query (keywords only)
  const keywords = query
    .toLowerCase()
    .replace(/[?.,!]/g, '')
    .split(/\s+/)
    .filter(word => !fillerWords.includes(word) && word.length > 2)
    .slice(0, 5)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return {
    explorer_query: keywords || query,
    reader_query: query.includes('what') || query.includes('how')
      ? `Explain in detail: ${query}`
      : query,
  };
}

/**
 * Match groups against explorer query
 */
function matchGroups(explorerQuery: string, groups: any[]): any[] {
  const queryTerms = explorerQuery.toLowerCase().split(/\s+/);
  
  const scored = groups.map(group => {
    const title = (group.title || '').toLowerCase();
    let score = 0;
    let matchReason = '';

    // Exact match
    if (title.includes(explorerQuery.toLowerCase())) {
      score = 1.0;
      matchReason = 'Exact title match';
    } else {
      // Keyword matching
      const matchingTerms = queryTerms.filter(term => title.includes(term));
      score = matchingTerms.length / queryTerms.length;
      matchReason = `Matched ${matchingTerms.length} of ${queryTerms.length} keywords`;
    }

    return {
      groupId: group.id,
      title: group.title || `Pages ${group.startPage}-${group.endPage}`,
      pages: `${group.startPage}-${group.endPage}`,
      relevanceScore: Math.min(score, 1.0),
      matchReason,
    };
  });

  // Filter and sort by relevance
  return scored
    .filter(g => g.relevanceScore > 0.2)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
}
