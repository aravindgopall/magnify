import { z } from 'zod';
import type { PipelineConfig } from '../types/index.js';
export declare const GroupingConfigSchema: z.ZodObject<{
    strategy: z.ZodEnum<["fixed", "heading", "toc", "hybrid"]>;
    fixedPagesPerGroup: z.ZodOptional<z.ZodNumber>;
    headingLevels: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    minGroupSize: z.ZodOptional<z.ZodNumber>;
    maxGroupSize: z.ZodOptional<z.ZodNumber>;
    fallbackStrategy: z.ZodOptional<z.ZodEnum<["fixed", "heading", "toc", "hybrid"]>>;
}, "strip", z.ZodTypeAny, {
    strategy: "fixed" | "heading" | "toc" | "hybrid";
    fixedPagesPerGroup?: number | undefined;
    headingLevels?: number[] | undefined;
    minGroupSize?: number | undefined;
    maxGroupSize?: number | undefined;
    fallbackStrategy?: "fixed" | "heading" | "toc" | "hybrid" | undefined;
}, {
    strategy: "fixed" | "heading" | "toc" | "hybrid";
    fixedPagesPerGroup?: number | undefined;
    headingLevels?: number[] | undefined;
    minGroupSize?: number | undefined;
    maxGroupSize?: number | undefined;
    fallbackStrategy?: "fixed" | "heading" | "toc" | "hybrid" | undefined;
}>;
export declare const ExtractionConfigSchema: z.ZodObject<{
    schema: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    prompts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    defaultPrompt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    schema?: Record<string, unknown> | undefined;
    prompts?: Record<string, string> | undefined;
    defaultPrompt?: string | undefined;
}, {
    schema?: Record<string, unknown> | undefined;
    prompts?: Record<string, string> | undefined;
    defaultPrompt?: string | undefined;
}>;
export declare const OutputConfigSchema: z.ZodObject<{
    format: z.ZodEnum<["json", "markdown", "summary", "search-index"]>;
    includeMetadata: z.ZodDefault<z.ZodBoolean>;
    includeSourcePages: z.ZodDefault<z.ZodBoolean>;
    prettyPrint: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    format: "json" | "markdown" | "summary" | "search-index";
    includeMetadata: boolean;
    includeSourcePages: boolean;
    prettyPrint: boolean;
}, {
    format: "json" | "markdown" | "summary" | "search-index";
    includeMetadata?: boolean | undefined;
    includeSourcePages?: boolean | undefined;
    prettyPrint?: boolean | undefined;
}>;
export declare const ExecutionConfigSchema: z.ZodObject<{
    maxConcurrency: z.ZodDefault<z.ZodNumber>;
    retryAttempts: z.ZodDefault<z.ZodNumber>;
    retryDelay: z.ZodDefault<z.ZodNumber>;
    timeout: z.ZodDefault<z.ZodNumber>;
    continueOnError: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    timeout: number;
    maxConcurrency: number;
    retryAttempts: number;
    retryDelay: number;
    continueOnError: boolean;
}, {
    timeout?: number | undefined;
    maxConcurrency?: number | undefined;
    retryAttempts?: number | undefined;
    retryDelay?: number | undefined;
    continueOnError?: boolean | undefined;
}>;
export declare const PipelineConfigSchema: z.ZodObject<{
    grouping: z.ZodObject<{
        strategy: z.ZodEnum<["fixed", "heading", "toc", "hybrid"]>;
        fixedPagesPerGroup: z.ZodOptional<z.ZodNumber>;
        headingLevels: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
        minGroupSize: z.ZodOptional<z.ZodNumber>;
        maxGroupSize: z.ZodOptional<z.ZodNumber>;
        fallbackStrategy: z.ZodOptional<z.ZodEnum<["fixed", "heading", "toc", "hybrid"]>>;
    }, "strip", z.ZodTypeAny, {
        strategy: "fixed" | "heading" | "toc" | "hybrid";
        fixedPagesPerGroup?: number | undefined;
        headingLevels?: number[] | undefined;
        minGroupSize?: number | undefined;
        maxGroupSize?: number | undefined;
        fallbackStrategy?: "fixed" | "heading" | "toc" | "hybrid" | undefined;
    }, {
        strategy: "fixed" | "heading" | "toc" | "hybrid";
        fixedPagesPerGroup?: number | undefined;
        headingLevels?: number[] | undefined;
        minGroupSize?: number | undefined;
        maxGroupSize?: number | undefined;
        fallbackStrategy?: "fixed" | "heading" | "toc" | "hybrid" | undefined;
    }>;
    extraction: z.ZodOptional<z.ZodObject<{
        schema: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        prompts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        defaultPrompt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        schema?: Record<string, unknown> | undefined;
        prompts?: Record<string, string> | undefined;
        defaultPrompt?: string | undefined;
    }, {
        schema?: Record<string, unknown> | undefined;
        prompts?: Record<string, string> | undefined;
        defaultPrompt?: string | undefined;
    }>>;
    output: z.ZodObject<{
        format: z.ZodEnum<["json", "markdown", "summary", "search-index"]>;
        includeMetadata: z.ZodDefault<z.ZodBoolean>;
        includeSourcePages: z.ZodDefault<z.ZodBoolean>;
        prettyPrint: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        format: "json" | "markdown" | "summary" | "search-index";
        includeMetadata: boolean;
        includeSourcePages: boolean;
        prettyPrint: boolean;
    }, {
        format: "json" | "markdown" | "summary" | "search-index";
        includeMetadata?: boolean | undefined;
        includeSourcePages?: boolean | undefined;
        prettyPrint?: boolean | undefined;
    }>;
    execution: z.ZodObject<{
        maxConcurrency: z.ZodDefault<z.ZodNumber>;
        retryAttempts: z.ZodDefault<z.ZodNumber>;
        retryDelay: z.ZodDefault<z.ZodNumber>;
        timeout: z.ZodDefault<z.ZodNumber>;
        continueOnError: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        timeout: number;
        maxConcurrency: number;
        retryAttempts: number;
        retryDelay: number;
        continueOnError: boolean;
    }, {
        timeout?: number | undefined;
        maxConcurrency?: number | undefined;
        retryAttempts?: number | undefined;
        retryDelay?: number | undefined;
        continueOnError?: boolean | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    grouping: {
        strategy: "fixed" | "heading" | "toc" | "hybrid";
        fixedPagesPerGroup?: number | undefined;
        headingLevels?: number[] | undefined;
        minGroupSize?: number | undefined;
        maxGroupSize?: number | undefined;
        fallbackStrategy?: "fixed" | "heading" | "toc" | "hybrid" | undefined;
    };
    output: {
        format: "json" | "markdown" | "summary" | "search-index";
        includeMetadata: boolean;
        includeSourcePages: boolean;
        prettyPrint: boolean;
    };
    execution: {
        timeout: number;
        maxConcurrency: number;
        retryAttempts: number;
        retryDelay: number;
        continueOnError: boolean;
    };
    extraction?: {
        schema?: Record<string, unknown> | undefined;
        prompts?: Record<string, string> | undefined;
        defaultPrompt?: string | undefined;
    } | undefined;
}, {
    grouping: {
        strategy: "fixed" | "heading" | "toc" | "hybrid";
        fixedPagesPerGroup?: number | undefined;
        headingLevels?: number[] | undefined;
        minGroupSize?: number | undefined;
        maxGroupSize?: number | undefined;
        fallbackStrategy?: "fixed" | "heading" | "toc" | "hybrid" | undefined;
    };
    output: {
        format: "json" | "markdown" | "summary" | "search-index";
        includeMetadata?: boolean | undefined;
        includeSourcePages?: boolean | undefined;
        prettyPrint?: boolean | undefined;
    };
    execution: {
        timeout?: number | undefined;
        maxConcurrency?: number | undefined;
        retryAttempts?: number | undefined;
        retryDelay?: number | undefined;
        continueOnError?: boolean | undefined;
    };
    extraction?: {
        schema?: Record<string, unknown> | undefined;
        prompts?: Record<string, string> | undefined;
        defaultPrompt?: string | undefined;
    } | undefined;
}>;
export declare function validateConfig(config: unknown): PipelineConfig;
export declare function createDefaultConfig(): PipelineConfig;
export declare function createConfig(overrides?: Partial<PipelineConfig>): PipelineConfig;
export declare const PRESETS: {
    readonly fast: PipelineConfig;
    readonly thorough: PipelineConfig;
    readonly largeDocument: PipelineConfig;
    readonly structured: PipelineConfig;
    readonly searchIndex: PipelineConfig;
};
export type PresetName = keyof typeof PRESETS;
export declare function getPreset(name: PresetName): PipelineConfig;
//# sourceMappingURL=index.d.ts.map