"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubagentConfigSchema = exports.OutputFormatSchema = exports.GroupingStrategySchema = void 0;
const zod_1 = require("zod");
exports.GroupingStrategySchema = zod_1.z.enum(['fixed', 'heading', 'toc', 'hybrid']);
exports.OutputFormatSchema = zod_1.z.enum(['json', 'markdown', 'summary', 'search-index']);
exports.SubagentConfigSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    maxRetries: zod_1.z.number().default(3),
    timeout: zod_1.z.number().default(60000),
    extractionSchema: zod_1.z.record(zod_1.z.unknown()).optional(),
    customPrompt: zod_1.z.string().optional(),
});
//# sourceMappingURL=index.js.map