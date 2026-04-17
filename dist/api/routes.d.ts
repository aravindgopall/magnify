import { type Router } from 'express';
import { SQLiteQueryPipeline } from '../query/sqlite-pipeline.js';
export interface APIContext {
    queryPipeline: SQLiteQueryPipeline;
}
export interface APIConfig {
    maxFileSize: number;
}
export declare function createRouter(context: APIContext): Router;
export declare function createAPIContext(): APIContext;
//# sourceMappingURL=routes.d.ts.map