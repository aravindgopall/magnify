import type { PDFDocument, Page, HeadingInfo } from '../types/index.js';
export declare class PDFParser {
    private options;
    constructor(options?: ParserOptions);
    parse(source: string | Buffer): Promise<PDFDocument>;
    private loadFile;
    private extractMetadata;
    private extractPages;
    private splitTextByPages;
    private extractPageElements;
    private detectHeading;
    private detectList;
    private extractTOC;
    private extractOutlineItems;
    extractHeadings(pages: Page[]): HeadingInfo[];
}
export interface ParserOptions {
    extractHeadings?: boolean;
    extractTables?: boolean;
    extractLists?: boolean;
    headingPatterns?: RegExp[];
}
export declare function createParser(options?: ParserOptions): PDFParser;
//# sourceMappingURL=pdf-parser.d.ts.map