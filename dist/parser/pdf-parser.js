"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PDFParser = void 0;
exports.createParser = createParser;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
class PDFParser {
    options;
    _lastPythonResult = null;
    constructor(options = {}) {
        this.options = {
            extractHeadings: true,
            extractTables: true,
            extractLists: true,
            usePythonExtractor: true,
            ...options,
        };
    }
    async parse(source) {
        // Determine if we should use Python extractor
        if (this.options.usePythonExtractor) {
            return this.parseWithPython(source);
        }
        // Fallback to JavaScript-based extraction (original PDF.js method)
        return this.parseWithPDFJS(source);
    }
    /**
     * Parse PDF using Python extraction pipeline (PyMuPDF + camelot + OCR)
     */
    async parseWithPython(source) {
        const { filePath, cleanup } = await this.getFilePath(source);
        try {
            const result = await this.runPythonExtractor(filePath);
            this._lastPythonResult = result; // Store for later access
            return this.convertPythonResult(result);
        }
        finally {
            if (cleanup) {
                const fs = await import('fs/promises');
                await fs.unlink(filePath).catch(() => { });
            }
        }
    }
    /**
     * Get a file path from source (handles both file paths and buffers)
     */
    async getFilePath(source) {
        if (typeof source === 'string') {
            return { filePath: source, cleanup: false };
        }
        // Write buffer to temp file
        const fs = await import('fs/promises');
        const os = await import('os');
        const tempFile = path_1.default.join(os.tmpdir(), `pdf-${(0, uuid_1.v4)()}.pdf`);
        await fs.writeFile(tempFile, source);
        return { filePath: tempFile, cleanup: true };
    }
    /**
     * Run the Python extraction script
     */
    async runPythonExtractor(pdfPath) {
        const scriptPath = this.options.pythonScriptPath ||
            path_1.default.join(__dirname, '../../scripts/pdf_extractor.py');
        const args = [scriptPath, pdfPath];
        if (this.options.outputDir) {
            args.push(this.options.outputDir);
        }
        return new Promise((resolve, reject) => {
            const pythonProcess = (0, child_process_1.spawn)('python3', args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
                // Log Python stderr for debugging
                console.error('[Python Extractor]', data.toString().trim());
            });
            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Python extractor failed with code ${code}: ${stderr}`));
                    return;
                }
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                }
                catch (err) {
                    reject(new Error(`Failed to parse Python output: ${err}\nOutput: ${stdout.substring(0, 500)}`));
                }
            });
            pythonProcess.on('error', (err) => {
                reject(new Error(`Failed to start Python process: ${err}`));
            });
        });
    }
    /**
     * Convert Python extraction result to TypeScript PDFDocument
     */
    convertPythonResult(result) {
        // Convert pages
        const pages = result.pages.map((p) => this.convertPythonPage(p));
        // Convert TOC
        let toc;
        if (result.toc && result.toc.length > 0) {
            toc = {
                items: this.convertPythonTOC(result.toc),
            };
        }
        // Convert metadata
        const metadata = {
            title: result.metadata.title,
            author: result.metadata.author,
            subject: result.metadata.subject,
            creator: result.metadata.creator,
            producer: result.metadata.producer,
            creationDate: result.metadata.creationDate ? new Date(result.metadata.creationDate) : undefined,
            pageCount: result.metadata.pageCount,
        };
        return {
            id: result.doc_id,
            source: result.doc_id,
            metadata,
            pages,
            toc,
            pdfType: result.pdf_type,
        };
    }
    /**
     * Convert Python page object to TypeScript Page
     */
    convertPythonPage(p) {
        // Convert text blocks to page elements
        const elements = [];
        if (p.text_blocks) {
            for (const block of p.text_blocks) {
                const isHeading = block.is_bold || block.font_size >= 14;
                elements.push({
                    type: isHeading ? 'heading' : 'text',
                    text: block.text,
                    bbox: block.bbox,
                    level: isHeading ? 1 : undefined,
                });
            }
        }
        // Add table elements
        if (p.tables) {
            for (const table of p.tables) {
                elements.push({
                    type: 'table',
                    text: table.caption || 'Table',
                });
            }
        }
        return {
            number: p.page_number,
            text: p.text,
            rawText: p.text,
            width: p.width,
            height: p.height,
            elements,
            textBlocks: p.text_blocks,
            tables: p.tables,
            images: p.images,
        };
    }
    /**
     * Convert Python TOC items to TypeScript TOCItem[]
     */
    convertPythonTOC(items) {
        const result = [];
        const stack = [];
        for (const item of items) {
            const tocItem = {
                title: item.title,
                level: item.level,
                pageNumber: item.pageNumber,
            };
            // Find parent based on level
            while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
                stack.pop();
            }
            if (stack.length > 0) {
                const parent = stack[stack.length - 1];
                if (!parent.children) {
                    parent.children = [];
                }
                parent.children.push(tocItem);
            }
            else {
                result.push(tocItem);
            }
            stack.push(tocItem);
        }
        return result;
    }
    /**
     * Fallback: Parse PDF using PDF.js (JavaScript only)
     * This is used when Python extractor is not available
     */
    async parseWithPDFJS(source) {
        // Import pdfjs-dist dynamically
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const buffer = typeof source === 'string' ? await this.loadFile(source) : source;
        const pdfJsDoc = await pdfjs.getDocument({
            data: new Uint8Array(buffer),
            useWorkerFetch: false,
            isEvalSupported: false,
            useSystemFonts: true,
        }).promise;
        const pages = [];
        for (let i = 1; i <= pdfJsDoc.numPages; i++) {
            const page = await this.extractPagePDFJS(pdfJsDoc, i);
            pages.push(page);
        }
        const metadata = await this.extractMetadataPDFJS(pdfJsDoc);
        return {
            id: (0, uuid_1.v4)(),
            source,
            metadata,
            pages,
        };
    }
    async loadFile(path) {
        const fs = await import('fs/promises');
        return fs.readFile(path);
    }
    async extractMetadataPDFJS(pdfJsDoc) {
        const pdfJsMetadata = await pdfJsDoc.getMetadata();
        const info = pdfJsMetadata.info || {};
        return {
            title: info.Title || info.title || undefined,
            author: info.Author || info.author || undefined,
            subject: info.Subject || info.subject || undefined,
            creator: info.Creator || info.creator || undefined,
            producer: info.Producer || info.producer || undefined,
            creationDate: info.CreationDate || info.creationDate ? new Date(info.CreationDate || info.creationDate) : undefined,
            pageCount: pdfJsDoc.numPages,
        };
    }
    async extractPagePDFJS(pdfJsDoc, pageNumber) {
        const pdfJsPage = await pdfJsDoc.getPage(pageNumber);
        const textContent = await pdfJsPage.getTextContent();
        const textItems = textContent.items;
        const pageText = this.buildPageText(textItems);
        const viewport = pdfJsPage.getViewport({ scale: 1 });
        const elements = this.extractPageElements(pageText);
        return {
            number: pageNumber,
            text: pageText,
            rawText: pageText,
            width: viewport.width,
            height: viewport.height,
            elements,
        };
    }
    buildPageText(items) {
        if (!items || items.length === 0) {
            return '';
        }
        const lines = [];
        const lineMap = new Map();
        const yTolerance = 2;
        for (const item of items) {
            if (!item.str || item.str.trim() === '')
                continue;
            const y = item.transform[5];
            let foundKey = null;
            for (const key of lineMap.keys()) {
                if (Math.abs(key - y) < yTolerance) {
                    foundKey = key;
                    break;
                }
            }
            if (foundKey !== null) {
                lineMap.get(foundKey).push(item.str);
            }
            else {
                lineMap.set(y, [item.str]);
            }
        }
        for (const [y, texts] of lineMap) {
            lines.push({ y, text: texts.join(' ') });
        }
        lines.sort((a, b) => b.y - a.y);
        return lines.map(l => l.text).join('\n');
    }
    extractPageElements(text) {
        const elements = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine)
                continue;
            elements.push({
                type: 'text',
                text: trimmedLine,
            });
        }
        return elements;
    }
    /**
     * Get all groups from a parsed document (extracted by Python)
     * This returns groups for all 3 strategies: toc, heading, range
     */
    getGroupsFromPythonResult(result) {
        return result.groups;
    }
    /**
     * Get the last Python extraction result
     */
    get lastPythonResult() {
        return this._lastPythonResult;
    }
}
exports.PDFParser = PDFParser;
function createParser(options) {
    return new PDFParser(options);
}
//# sourceMappingURL=pdf-parser.js.map