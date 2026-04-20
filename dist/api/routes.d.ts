import { type Router } from 'express';
import { SQLiteQueryPipeline } from '../query/sqlite-pipeline.js';
import { ParallelQueryPipeline } from '../query/parallel-query-pipeline.js';
export interface APIContext {
    queryPipeline: SQLiteQueryPipeline;
    parallelQueryPipeline: ParallelQueryPipeline;
}
export interface APIConfig {
    maxFileSize: number;
}
export declare function createRouter(context: APIContext): Router;
export declare function createAPIContext(): APIContext;
//# sourceMappingURL=routes.d.ts.map