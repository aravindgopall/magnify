"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PDFParser = void 0;
exports.createParser = createParser;
const pdf_lib_1 = require("pdf-lib");
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const uuid_1 = require("uuid");
const HEADING_PATTERNS = [
    /^(Chapter|CHAPTER)\s+(\d+|[IVXLCDM]+)[:.\s]*(.*)$/i,
    /^(Part|PART)\s+(\d+|[IVXLCDM]+)[:.\s]*(.*)$/i,
    /^(Section|SECTION)\s+(\d+\.?\d*)[:.\s]*(.*)$/i,
    /^(\d+\.?\d*)\s+([A-Z][A-Za-z\s]+)$/,
    /^([A-Z][A-Z\s]{2,50})$/,
    /^(Abstract|ABSTRACT|Introduction|INTRODUCTION|Conclusion|CONCLUSION|References|REFERENCES|Appendix|APPENDIX)$/i,
];
const LIST_PATTERNS = [
    /^[\s]*[-•*]\s+/,
    /^[\s]*\d+[.)]\s+/,
    /^[\s]*[a-z][.)]\s+/i,
];
class PDFParser {
    options;
    constructor(options = {}) {
        this.options = {
            extractHeadings: true,
            extractTables: true,
            extractLists: true,
            headingPatterns: HEADING_PATTERNS,
            ...options,
        };
    }
    async parse(source) {
        const buffer = typeof source === 'string' ? await this.loadFile(source) : source;
        const [pdfLibDoc, pdfParseResult] = await Promise.all([
            pdf_lib_1.PDFDocument.load(buffer),
            (0, pdf_parse_1.default)(buffer),
        ]);
        const metadata = this.extractMetadata(pdfLibDoc, pdfParseResult);
        const pages = await this.extractPages(pdfLibDoc, pdfParseResult);
        const toc = await this.extractTOC(pdfLibDoc);
        return {
            id: (0, uuid_1.v4)(),
            source,
            metadata,
            pages,
            toc,
        };
    }
    async loadFile(path) {
        const fs = await import('fs/promises');
        return fs.readFile(path);
    }
    extractMetadata(_pdfLibDoc, pdfParseResult) {
        const info = pdfParseResult.info || {};
        return {
            title: info.Title || undefined,
            author: info.Author || undefined,
            subject: info.Subject || undefined,
            creator: info.Creator || undefined,
            producer: info.Producer || undefined,
            creationDate: info.CreationDate ? new Date(info.CreationDate) : undefined,
            pageCount: pdfParseResult.numpages,
        };
    }
    async extractPages(pdfLibDoc, pdfParseResult) {
        const pages = [];
        const textContent = pdfParseResult.text;
        const pageTexts = this.splitTextByPages(textContent, pdfLibDoc.getPageCount());
        for (let i = 0; i < pdfLibDoc.getPageCount(); i++) {
            const pdfPage = pdfLibDoc.getPage(i);
            const { width, height } = pdfPage.getSize();
            const pageText = pageTexts[i] || '';
            const elements = this.extractPageElements(pageText, i + 1);
            pages.push({
                number: i + 1,
                text: pageText,
                rawText: pageText,
                width,
                height,
                elements,
            });
        }
        return pages;
    }
    splitTextByPages(text, pageCount) {
        const formFeed = '\f';
        const pages = text.split(formFeed);
        while (pages.length < pageCount) {
            pages.push('');
        }
        return pages.slice(0, pageCount);
    }
    extractPageElements(text, _pageNumber) {
        const elements = [];
        const lines = text.split('\n');
        let currentPosition = 0;
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) {
                currentPosition += line.length + 1;
                continue;
            }
            const headingInfo = this.detectHeading(trimmedLine);
            if (headingInfo) {
                elements.push({
                    type: 'heading',
                    text: trimmedLine,
                    level: headingInfo.level,
                    bbox: { x: 0, y: currentPosition, width: trimmedLine.length, height: 1 },
                });
            }
            else if (this.detectList(trimmedLine)) {
                elements.push({
                    type: 'list',
                    text: trimmedLine,
                    bbox: { x: 0, y: currentPosition, width: trimmedLine.length, height: 1 },
                });
            }
            else {
                elements.push({
                    type: 'text',
                    text: trimmedLine,
                    bbox: { x: 0, y: currentPosition, width: trimmedLine.length, height: 1 },
                });
            }
            currentPosition += line.length + 1;
        }
        return elements;
    }
    detectHeading(line) {
        if (!this.options.extractHeadings)
            return null;
        for (let i = 0; i < (this.options.headingPatterns?.length || 0); i++) {
            const pattern = this.options.headingPatterns[i];
            const match = line.match(pattern);
            if (match) {
                let level = 1;
                if (/^(Chapter|CHAPTER)/i.test(line))
                    level = 1;
                else if (/^(Part|PART)/i.test(line))
                    level = 1;
                else if (/^(Section|SECTION)/i.test(line))
                    level = 2;
                else if (/^\d+\.\d+/.test(line))
                    level = 3;
                else if (/^(Abstract|Introduction|Conclusion|References|Appendix)/i.test(line))
                    level = 1;
                else
                    level = Math.min(i + 1, 4);
                return { level, text: line };
            }
        }
        if (/^[A-Z][A-Z\s]{5,50}$/.test(line) && line.split(' ').length <= 8) {
            return { level: 2, text: line };
        }
        return null;
    }
    detectList(line) {
        if (!this.options.extractLists)
            return false;
        return LIST_PATTERNS.some(pattern => pattern.test(line));
    }
    async extractTOC(pdfLibDoc) {
        try {
            const outlines = pdfLibDoc.catalog.lookup(pdf_lib_1.PDFName.of('Outlines'));
            if (!outlines || !(outlines instanceof pdf_lib_1.PDFDict)) {
                return undefined;
            }
            const items = await this.extractOutlineItems(outlines, pdfLibDoc);
            return items.length > 0 ? { items } : undefined;
        }
        catch {
            return undefined;
        }
    }
    async extractOutlineItems(outlineDict, pdfLibDoc, level = 0) {
        const items = [];
        try {
            const first = outlineDict.lookup(pdf_lib_1.PDFName.of('First'));
            if (!first || !(first instanceof pdf_lib_1.PDFDict)) {
                return items;
            }
            let current = first;
            let iterations = 0;
            const maxIterations = 1000;
            while (current && iterations < maxIterations) {
                iterations++;
                const titleObj = current.lookup(pdf_lib_1.PDFName.of('Title'));
                const title = titleObj instanceof pdf_lib_1.PDFString ? titleObj.decodeText() : 'Untitled';
                const dest = current.lookup(pdf_lib_1.PDFName.of('Dest'));
                let pageNumber = 1;
                if (dest instanceof pdf_lib_1.PDFArray && dest.size() > 0) {
                    const pageRef = dest.get(0);
                    if (pageRef) {
                        const pages = pdfLibDoc.getPages();
                        for (let i = 0; i < pages.length; i++) {
                            if (pages[i].ref === pageRef) {
                                pageNumber = i + 1;
                                break;
                            }
                        }
                    }
                }
                const children = await this.extractOutlineItems(current, pdfLibDoc, level + 1);
                items.push({
                    title,
                    level,
                    pageNumber,
                    children: children.length > 0 ? children : undefined,
                });
                const nextRef = current.lookup(pdf_lib_1.PDFName.of('Next'));
                current = nextRef instanceof pdf_lib_1.PDFDict ? nextRef : undefined;
            }
        }
        catch {
            // Silently handle errors in TOC extraction
        }
        return items;
    }
    extractHeadings(pages) {
        const headings = [];
        for (const page of pages) {
            for (const element of page.elements) {
                if (element.type === 'heading' && element.level !== undefined) {
                    headings.push({
                        text: element.text,
                        level: element.level,
                        pageNumber: page.number,
                        position: element.bbox?.y || 0,
                    });
                }
            }
        }
        return headings;
    }
}
exports.PDFParser = PDFParser;
function createParser(options) {
    return new PDFParser(options);
}
//# sourceMappingURL=pdf-parser.js.map