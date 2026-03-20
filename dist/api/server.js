"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const index_js_1 = require("../llm/index.js");
const routes_js_1 = require("./routes.js");
const defaultServerConfig = {
    port: 3000,
    host: '0.0.0.0',
    llm: {
        provider: 'mock',
    },
};
function createServer(config) {
    const finalConfig = { ...defaultServerConfig, ...config };
    const llmClient = (0, index_js_1.createLLMClient)({
        provider: finalConfig.llm.provider,
        apiKey: finalConfig.llm.apiKey,
        model: finalConfig.llm.model,
    });
    const context = (0, routes_js_1.createAPIContext)(llmClient);
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '50mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
    app.use('/api', (0, routes_js_1.createRouter)(context));
    app.get('/', (_req, res) => {
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
    app.use((err, _req, res, _next) => {
        console.error('Error:', err.message);
        res.status(500).json({
            error: 'Internal server error',
            message: err.message,
        });
    });
    return { app, context };
}
function startServer(config) {
    const finalConfig = { ...defaultServerConfig, ...config };
    const { app } = createServer(finalConfig);
    const server = app.listen(finalConfig.port, finalConfig.host, () => {
        console.log(`Magnify PDF Scraper API running at http://${finalConfig.host}:${finalConfig.port}`);
        console.log(`LLM Provider: ${finalConfig.llm.provider}`);
    });
    return { app, server };
}
//# sourceMappingURL=server.js.map