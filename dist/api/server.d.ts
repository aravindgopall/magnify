import { type Express } from 'express';
import { type APIContext } from './routes.js';
export interface ServerConfig {
    port: number;
    host: string;
    llm: {
        provider: 'openai' | 'mock';
        apiKey?: string;
        model?: string;
    };
}
export declare function createServer(config?: Partial<ServerConfig>): {
    app: Express;
    context: APIContext;
};
export declare function startServer(config?: Partial<ServerConfig>): {
    app: Express;
    server: ReturnType<Express['listen']>;
};
//# sourceMappingURL=server.d.ts.map