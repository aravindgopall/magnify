import { z } from 'zod';
export const GroupingStrategySchema = z.enum(['fixed', 'heading', 'toc']);
export const OutputFormatSchema = z.enum(['json', 'markdown', 'summary', 'search-index']);
export const SubagentConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    maxRetries: z.number().default(3),
    timeout: z.number().default(60000),
    extractionSchema: z.record(z.unknown()).optional(),
    customPrompt: z.string().optional(),
});
//# sourceMappingURL=index.js.map