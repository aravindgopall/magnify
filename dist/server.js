"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("./api/index.js");
const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const llmProvider = (process.env.LLM_PROVIDER || 'mock');
const { server } = (0, index_js_1.startServer)({
    port,
    host,
    llm: {
        provider: llmProvider,
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.LLM_MODEL || 'gpt-4',
    },
});
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
//# sourceMappingURL=server.js.map