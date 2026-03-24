import type { PDFDocument, PythonExtractionResult, PythonGroupObject } from '../types/index.js';
export interface ParserOptions {
    extractHeadings?: boolean;
    extractTables?: boolean;
    extractLists?: boolean;
    headingPatterns?: RegExp[];
    usePythonExtractor?: boolean;
    pythonScriptPath?: string;
    outputDir?: string;
}
export declare class PDFParser {
    private options;
    private _lastPythonResult;
    constructor(options?: ParserOptions);
    parse(source: string | Buffer): Promise<PDFDocument>;
    /**
     * Parse PDF using Python extraction pipeline (PyMuPDF + camelot + OCR)
     */
    private parseWithPython;
    /**
     * Get a file path from source (handles both file paths and buffers)
     */
    private getFilePath;
    /**
     * Run the Python extraction script
     */
    private runPythonExtractor;
    /**
     * Convert Python extraction result to TypeScript PDFDocument
     */
    private convertPythonResult;
    /**
     * Convert Python page object to TypeScript Page
     */
    private convertPythonPage;
    /**
     * Convert Python TOC items to TypeScript TOCItem[]
     */
    private convertPythonTOC;
    /**
     * Fallback: Parse PDF using PDF.js (JavaScript only)
     * This is used when Python extractor is not available
     */
    private parseWithPDFJS;
    private loadFile;
    private extractMetadataPDFJS;
    private extractPagePDFJS;
    private buildPageText;
    private extractPageElements;
    /**
     * Get all groups from a parsed document (extracted by Python)
     * This returns groups for all 3 strategies: toc, heading, range
     */
    getGroupsFromPythonResult(result: PythonExtractionResult): PythonGroupObject[];
    /**
     * Get the last Python extraction result
     */
    get lastPythonResult(): PythonExtractionResult | null;
}
export declare function createParser(options?: ParserOptions): PDFParser;
//# sourceMappingURL=pdf-parser.d.ts.map