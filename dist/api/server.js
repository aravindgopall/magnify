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
const agent_routes_js_1 = require("./agent-routes.js");
const pi_mono_routes_js_1 = require("./pi-mono-routes.js");
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
        baseURL: finalConfig.llm.baseURL,
    });
    const context = (0, routes_js_1.createAPIContext)(llmClient);
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '50mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
    app.use('/api', (0, routes_js_1.createRouter)(context));
    app.use('/api', (0, agent_routes_js_1.createAgentRoutes)(context));
    app.use('/api', (0, pi_mono_routes_js_1.createPiMonoRoutes)(context));
    app.get('/', (_req, res) => {
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
    app.use((err, _req, res, _next) => {
        console.error('Error:', err.message);
        res.status(500).json({
            error: 'Internal server error',
            message: err.message,
        });
    });
    return { app, context };
}
async function startServer(config) {
    const finalConfig = { ...defaultServerConfig, ...config };
    const { app, context } = createServer(finalConfig);
    // Initialize document store (load persisted documents)
    await (0, routes_js_1.initializeAPIContext)(context);
    return new Promise((resolve) => {
        const server = app.listen(finalConfig.port, finalConfig.host, () => {
            console.log(`Magnify PDF Scraper API running at http://${finalConfig.host}:${finalConfig.port}`);
            console.log(`LLM Provider: ${finalConfig.llm.provider}`);
            resolve({ app, server });
        });
    });
}
//# sourceMappingURL=server.js.map