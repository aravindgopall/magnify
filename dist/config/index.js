import { z } from 'zod';
export const GroupingConfigSchema = z.object({
    strategy: z.enum(['fixed', 'heading', 'toc']),
    fixedPagesPerGroup: z.number().min(1).optional(),
    headingLevels: z.array(z.number().min(1).max(6)).optional(),
    minGroupSize: z.number().min(1).optional(),
    maxGroupSize: z.number().min(1).optional(),
    fallbackStrategy: z.enum(['fixed', 'heading', 'toc']).optional(),
});
export const ExtractionConfigSchema = z.object({
    schema: z.record(z.unknown()).optional(),
    prompts: z.record(z.string()).optional(),
    defaultPrompt: z.string().optional(),
});
export const OutputConfigSchema = z.object({
    format: z.enum(['json', 'markdown', 'summary', 'search-index']),
    includeMetadata: z.boolean().default(true),
    includeSourcePages: z.boolean().default(false),
    prettyPrint: z.boolean().default(true),
});
export const ExecutionConfigSchema = z.object({
    maxConcurrency: z.number().min(1).max(20).default(4),
    retryAttempts: z.number().min(0).max(10).default(3),
    retryDelay: z.number().min(100).default(1000),
    timeout: z.number().min(5000).default(60000),
    continueOnError: z.boolean().default(true),
});
export const PipelineConfigSchema = z.object({
    grouping: GroupingConfigSchema,
    extraction: ExtractionConfigSchema.optional(),
    output: OutputConfigSchema,
    execution: ExecutionConfigSchema,
});
export function validateConfig(config) {
    return PipelineConfigSchema.parse(config);
}
export function createDefaultConfig() {
    return {
        grouping: {
            strategy: 'toc',
            fixedPagesPerGroup: 10,
            minGroupSize: 1,
            maxGroupSize: 50,
        },
        extraction: {
            defaultPrompt: 'Extract structured information from this document section.',
        },
        output: {
            format: 'json',
            includeMetadata: true,
            includeSourcePages: false,
            prettyPrint: true,
        },
        execution: {
            maxConcurrency: 4,
            retryAttempts: 3,
            retryDelay: 1000,
            timeout: 60000,
            continueOnError: true,
        },
    };
}
export function createConfig(overrides = {}) {
    const defaults = createDefaultConfig();
    return {
        grouping: { ...defaults.grouping, ...overrides.grouping },
        extraction: { ...defaults.extraction, ...overrides.extraction },
        output: { ...defaults.output, ...overrides.output },
        execution: { ...defaults.execution, ...overrides.execution },
    };
}
export const PRESETS = {
    fast: createConfig({
        grouping: { strategy: 'toc', fixedPagesPerGroup: 10, minGroupSize: 1, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'json', includeMetadata: true, includeSourcePages: false, prettyPrint: true },
        execution: { maxConcurrency: 8, retryAttempts: 1, timeout: 30000, continueOnError: true, retryDelay: 500 },
    }),
    thorough: createConfig({
        grouping: { strategy: 'toc', fixedPagesPerGroup: 10, minGroupSize: 1, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'json', includeMetadata: true, includeSourcePages: false, prettyPrint: true },
        execution: { maxConcurrency: 2, retryAttempts: 5, timeout: 120000, continueOnError: false, retryDelay: 2000 },
    }),
    largeDocument: createConfig({
        grouping: { strategy: 'fixed', fixedPagesPerGroup: 20, minGroupSize: 1, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'json', includeMetadata: true, includeSourcePages: false, prettyPrint: true },
        execution: { maxConcurrency: 6, retryAttempts: 3, timeout: 90000, continueOnError: true, retryDelay: 1000 },
    }),
    structured: createConfig({
        grouping: { strategy: 'heading', headingLevels: [1, 2, 3], minGroupSize: 2, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'markdown', includeMetadata: true, includeSourcePages: false, prettyPrint: true },
        execution: { maxConcurrency: 4, retryAttempts: 3, timeout: 60000, continueOnError: true, retryDelay: 1000 },
    }),
    searchIndex: createConfig({
        grouping: { strategy: 'toc', fixedPagesPerGroup: 5, minGroupSize: 1, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'search-index', includeMetadata: true, includeSourcePages: true, prettyPrint: false },
        execution: { maxConcurrency: 4, retryAttempts: 3, timeout: 60000, continueOnError: true, retryDelay: 1000 },
    }),
};
export function getPreset(name) {
    return { ...PRESETS[name] };
}
//# sourceMappingURL=index.js.map