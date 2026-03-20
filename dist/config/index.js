"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESETS = exports.PipelineConfigSchema = exports.ExecutionConfigSchema = exports.OutputConfigSchema = exports.ExtractionConfigSchema = exports.GroupingConfigSchema = void 0;
exports.validateConfig = validateConfig;
exports.createDefaultConfig = createDefaultConfig;
exports.createConfig = createConfig;
exports.getPreset = getPreset;
const zod_1 = require("zod");
exports.GroupingConfigSchema = zod_1.z.object({
    strategy: zod_1.z.enum(['fixed', 'heading', 'toc', 'hybrid']),
    fixedPagesPerGroup: zod_1.z.number().min(1).optional(),
    headingLevels: zod_1.z.array(zod_1.z.number().min(1).max(6)).optional(),
    minGroupSize: zod_1.z.number().min(1).optional(),
    maxGroupSize: zod_1.z.number().min(1).optional(),
    fallbackStrategy: zod_1.z.enum(['fixed', 'heading', 'toc', 'hybrid']).optional(),
});
exports.ExtractionConfigSchema = zod_1.z.object({
    schema: zod_1.z.record(zod_1.z.unknown()).optional(),
    prompts: zod_1.z.record(zod_1.z.string()).optional(),
    defaultPrompt: zod_1.z.string().optional(),
});
exports.OutputConfigSchema = zod_1.z.object({
    format: zod_1.z.enum(['json', 'markdown', 'summary', 'search-index']),
    includeMetadata: zod_1.z.boolean().default(true),
    includeSourcePages: zod_1.z.boolean().default(false),
    prettyPrint: zod_1.z.boolean().default(true),
});
exports.ExecutionConfigSchema = zod_1.z.object({
    maxConcurrency: zod_1.z.number().min(1).max(20).default(4),
    retryAttempts: zod_1.z.number().min(0).max(10).default(3),
    retryDelay: zod_1.z.number().min(100).default(1000),
    timeout: zod_1.z.number().min(5000).default(60000),
    continueOnError: zod_1.z.boolean().default(true),
});
exports.PipelineConfigSchema = zod_1.z.object({
    grouping: exports.GroupingConfigSchema,
    extraction: exports.ExtractionConfigSchema.optional(),
    output: exports.OutputConfigSchema,
    execution: exports.ExecutionConfigSchema,
});
function validateConfig(config) {
    return exports.PipelineConfigSchema.parse(config);
}
function createDefaultConfig() {
    return {
        grouping: {
            strategy: 'hybrid',
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
function createConfig(overrides = {}) {
    const defaults = createDefaultConfig();
    return {
        grouping: { ...defaults.grouping, ...overrides.grouping },
        extraction: { ...defaults.extraction, ...overrides.extraction },
        output: { ...defaults.output, ...overrides.output },
        execution: { ...defaults.execution, ...overrides.execution },
    };
}
exports.PRESETS = {
    fast: createConfig({
        grouping: { strategy: 'hybrid', fixedPagesPerGroup: 10, minGroupSize: 1, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'json', includeMetadata: true, includeSourcePages: false, prettyPrint: true },
        execution: { maxConcurrency: 8, retryAttempts: 1, timeout: 30000, continueOnError: true, retryDelay: 500 },
    }),
    thorough: createConfig({
        grouping: { strategy: 'hybrid', fixedPagesPerGroup: 10, minGroupSize: 1, maxGroupSize: 50 },
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
        grouping: { strategy: 'hybrid', fixedPagesPerGroup: 5, minGroupSize: 1, maxGroupSize: 50 },
        extraction: { defaultPrompt: 'Extract structured information from this document section.' },
        output: { format: 'search-index', includeMetadata: true, includeSourcePages: true, prettyPrint: false },
        execution: { maxConcurrency: 4, retryAttempts: 3, timeout: 60000, continueOnError: true, retryDelay: 1000 },
    }),
};
function getPreset(name) {
    return { ...exports.PRESETS[name] };
}
//# sourceMappingURL=index.js.map