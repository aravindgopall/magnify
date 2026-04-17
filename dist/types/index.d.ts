import { z } from 'zod';
export declare const GroupingStrategySchema: z.ZodEnum<["fixed", "heading", "toc"]>;
export type GroupingStrategy = z.infer<typeof GroupingStrategySchema>;
export declare const OutputFormatSchema: z.ZodEnum<["json", "markdown", "summary", "search-index"]>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export interface PDFDocument {
    id: string;
    source: string | Buffer;
    metadata: DocumentMetadata;
    pages: Page[];
    toc?: TableOfContents;
    pdfType?: 'digital' | 'scanned' | 'hybrid';
}
export interface DocumentMetadata {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    pageCount: number;
}
export interface Page {
    number: number;
    text: string;
    rawText: string;
    width: number;
    height: number;
    elements: PageElement[];
    textBlocks?: TextBlock[];
    tables?: TableData[];
    images?: ImageData[];
}
export interface TextBlock {
    text: string;
    font_size: number;
    is_bold: boolean;
    bbox: BoundingBox;
}
export interface TableData {
    headers: string[];
    rows: string[][];
    caption?: string;
    pageNumber?: number;
}
export interface ImageData {
    page_number: number;
    image_index: number;
    width: number;
    height: number;
    file_path?: string;
    image_base64?: string;
}
export interface PageElement {
    type: 'text' | 'heading' | 'table' | 'image' | 'list';
    text: string;
    bbox?: BoundingBox;
    level?: number;
}
export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface TableOfContents {
    items: TOCItem[];
}
export interface TOCItem {
    title: string;
    level: number;
    pageNumber: number;
    children?: TOCItem[];
}
export interface DocumentGroup {
    id: string;
    type: GroupingStrategy;
    title?: string;
    startPage: number;
    endPage: number;
    pages: Page[];
    metadata?: Record<string, unknown>;
    fullText?: string;
    tables?: TableData[];
    imagePaths?: string[];
}
export interface HeadingInfo {
    text: string;
    level: number;
    pageNumber: number;
    position: number;
}
export interface GroupingConfig {
    strategy: GroupingStrategy;
    fixedPagesPerGroup?: number;
    headingLevels?: number[];
    minGroupSize?: number;
    maxGroupSize?: number;
    fallbackStrategy?: GroupingStrategy;
}
export interface PythonExtractionResult {
    doc_id: string;
    pdf_type: 'digital' | 'scanned' | 'hybrid';
    metadata: Record<string, any>;
    pages: PythonPageObject[];
    groups: PythonGroupObject[];
    toc?: Array<{
        level: number;
        title: string;
        pageNumber: number;
    }>;
}
export interface PythonPageObject {
    page_number: number;
    text: string;
    text_blocks: TextBlock[];
    tables: TableData[];
    images: ImageData[];
    width: number;
    height: number;
}
export interface PythonGroupObject {
    group_id: string;
    doc_id: string;
    strategy: 'toc' | 'heading' | 'range';
    title: string;
    start_page: number;
    end_page: number;
    full_text: string;
    tables: TableData[];
    image_paths: string[];
}
export declare const SubagentConfigSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    maxRetries: z.ZodDefault<z.ZodNumber>;
    timeout: z.ZodDefault<z.ZodNumber>;
    extractionSchema: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    customPrompt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    maxRetries: number;
    timeout: number;
    description?: string | undefined;
    extractionSchema?: Record<string, unknown> | undefined;
    customPrompt?: string | undefined;
}, {
    id: string;
    name: string;
    description?: string | undefined;
    maxRetries?: number | undefined;
    timeout?: number | undefined;
    extractionSchema?: Record<string, unknown> | undefined;
    customPrompt?: string | undefined;
}>;
export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;
export interface SubagentResult {
    agentId: string;
    groupId: string;
    success: boolean;
    data?: ExtractedData;
    error?: string;
    duration: number;
    tokensUsed?: number;
}
export interface ExtractedData {
    groupId: string;
    title?: string;
    summary?: string;
    entities?: Entity[];
    sections?: Section[];
    tables?: TableData[];
    metadata?: Record<string, unknown>;
    rawContent?: string;
}
export interface Entity {
    type: string;
    name: string;
    value?: string;
    confidence: number;
    location?: Location;
}
export interface Location {
    pageNumber: number;
    bbox?: BoundingBox;
}
export interface Section {
    heading: string;
    content: string;
    level: number;
    subsections?: Section[];
}
export interface PipelineConfig {
    grouping: GroupingConfig;
    extraction?: ExtractionConfig;
    output: OutputConfig;
    execution: ExecutionConfig;
}
export interface ExtractionConfig {
    schema?: Record<string, unknown>;
    prompts?: Record<string, string>;
    defaultPrompt?: string;
}
export interface OutputConfig {
    format: OutputFormat;
    includeMetadata: boolean;
    includeSourcePages: boolean;
    prettyPrint: boolean;
}
export interface ExecutionConfig {
    maxConcurrency: number;
    retryAttempts: number;
    retryDelay: number;
    timeout: number;
    continueOnError: boolean;
}
export interface PipelineResult {
    documentId: string;
    status: 'success' | 'partial' | 'failed';
    groups: GroupResult[];
    mergedOutput: MergedOutput;
    statistics: PipelineStatistics;
    errors: PipelineError[];
}
export interface GroupResult {
    groupId: string;
    status: 'success' | 'failed' | 'skipped';
    extraction?: ExtractedData;
    duration: number;
    error?: string;
}
export interface MergedOutput {
    title?: string;
    summary?: string;
    sections: Section[];
    entities: Entity[];
    tables: TableData[];
    metadata: Record<string, unknown>;
    fullContent?: string;
}
export interface PipelineStatistics {
    totalPages: number;
    totalGroups: number;
    successfulGroups: number;
    failedGroups: number;
    totalDuration: number;
    averageGroupDuration: number;
    totalTokensUsed: number;
}
export interface PipelineError {
    groupId?: string;
    stage: 'parsing' | 'grouping' | 'extraction' | 'merging';
    message: string;
    details?: unknown;
}
export interface Subagent {
    id: string;
    config: SubagentConfig;
    execute(group: DocumentGroup): Promise<SubagentResult>;
}
export interface AgentFactory {
    createAgent(config: SubagentConfig): Subagent;
}
export type ChunkSource = 'fixed' | 'heading' | 'toc';
export type ExtractionType = 'summary' | 'entities' | 'full' | 'custom';
export interface SQLiteChunk {
    id: number;
    document_id: string;
    chunk_id: string;
    title: string | null;
    content: string;
    start_page: number;
    end_page: number;
    strategy: string;
    has_tables: boolean;
    has_images: boolean;
    source: ChunkSource;
}
export interface SQLiteQueryConfig {
    query: string;
    extractionType?: ExtractionType;
    customPrompt?: string;
}
export interface SQLiteQueryResult {
    answer: string;
    sources: Array<{
        chunkId: string;
        title: string | null;
        source: ChunkSource;
        startPage: number;
        endPage: number;
        relevantExcerpt?: string;
    }>;
    extractionType: ExtractionType;
    metadata: {
        totalChunks: number;
        relevantChunks: number;
        processingTimeMs: number;
    };
    logPath?: string;
}
//# sourceMappingURL=index.d.ts.map