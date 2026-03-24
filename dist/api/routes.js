"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = createRouter;
exports.createAPIContext = createAPIContext;
exports.initializeAPIContext = initializeAPIContext;
const express_1 = __importDefault(require("express"));
const index_js_1 = require("../store/index.js");
const index_js_2 = require("../orchestrator/index.js");
const defaultAPIConfig = {
    maxFileSize: 50 * 1024 * 1024,
};
function createRouter(context) {
    const router = express_1.default.Router();
    router.post('/documents/upload', async (req, res, next) => {
        try {
            const { source, fileName, groupingStrategy } = req.body;
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
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/documents', (_req, res) => {
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
    router.get('/documents/:id', (req, res) => {
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
    router.get('/documents/:id/groups', (req, res) => {
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
    router.get('/documents/:id/groups/:groupId', (req, res) => {
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
    router.delete('/documents/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const deleted = await context.documentStore.delete(id);
            if (!deleted) {
                return res.status(404).json({ error: 'Document not found' });
            }
            res.json({ message: 'Document deleted', documentId: id });
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/query', async (req, res, next) => {
        try {
            const { documentId, query, groupIds, extractionType, customPrompt } = req.body;
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
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/documents/:id/query', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { query, groupIds, extractionType, customPrompt } = req.body;
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
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/health', async (_req, res) => {
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
function createAPIContext(llmClient) {
    const documentStore = (0, index_js_1.createDocumentStore)(llmClient);
    const queryOrchestrator = (0, index_js_2.createQueryOrchestrator)(llmClient, documentStore);
    return {
        documentStore,
        queryOrchestrator,
        llmClient,
    };
}
/**
 * Initialize the API context by loading persisted documents
 */
async function initializeAPIContext(context) {
    await context.documentStore.initialize();
}
//# sourceMappingURL=routes.js.map