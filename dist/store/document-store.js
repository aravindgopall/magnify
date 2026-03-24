"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentStore = void 0;
exports.createDocumentStore = createDocumentStore;
const uuid_1 = require("uuid");
const index_js_1 = require("../parser/index.js");
const main_agent_js_1 = require("../llm/main-agent.js");
const persistence_js_1 = require("./persistence.js");
class DocumentStore {
    documents = new Map();
    llmClient;
    mainAgent;
    persistence;
    initialized = false;
    usePythonExtractor;
    constructor(llmClient, options) {
        this.llmClient = llmClient;
        this.mainAgent = new main_agent_js_1.MainAgent(llmClient);
        this.persistence = (0, persistence_js_1.createDocumentPersistence)(options?.dataDir);
        this.usePythonExtractor = options?.usePythonExtractor !== false; // Default to true
    }
    /**
     * Initialize the store by loading persisted documents
     * Must be called before the store is ready for use
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        console.log('Initializing document store...');
        const persistedDocs = await this.persistence.loadAllDocuments();
        for (const doc of persistedDocs) {
            this.documents.set(doc.id, doc);
        }
        this.initialized = true;
        console.log(`Document store initialized with ${this.documents.size} documents`);
    }
    /**
     * Check if the store is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    async upload(source, options = {}) {
        // Use Python extractor for enhanced extraction
        const parser = (0, index_js_1.createParser)({
            usePythonExtractor: this.usePythonExtractor,
            outputDir: this.persistence.getDataDir(),
        });
        // Parse PDF - Python extractor returns all 3 grouping strategies
        const document = await parser.parse(source);
        // Get the Python extraction result with all groups
        let pythonResult;
        let groups;
        if (this.usePythonExtractor && parser.lastPythonResult) {
            // For Python extractor, we get all groups from the result
            pythonResult = parser.lastPythonResult;
            // Convert Python groups to DocumentGroup[]
            groups = this.convertPythonGroups(pythonResult.groups, document);
        }
        else {
            // Fallback: Use old grouping logic
            const strategy = options.groupingStrategy || 'hybrid';
            if (strategy === 'fixed') {
                groups = this.createFixedGroups(document);
            }
            else {
                try {
                    groups = await this.mainAgent.identifyGroups(document, strategy);
                }
                catch (error) {
                    console.warn('LLM grouping failed, falling back to fixed groups:', error);
                    groups = this.createFixedGroups(document);
                }
            }
        }
        // Analyze document type (optional, can fail gracefully)
        let documentType;
        try {
            const analysis = await this.mainAgent.analyzeDocument(document);
            documentType = analysis.documentType;
        }
        catch (error) {
            console.warn('Document analysis failed:', error);
        }
        const stored = {
            id: document.id,
            document,
            groups,
            metadata: {
                uploadedAt: new Date(),
                fileName: options.fileName,
                groupingStrategy: options.groupingStrategy || 'hybrid',
                documentType,
                pdfType: document.pdfType,
            },
            pythonResult,
        };
        this.documents.set(stored.id, stored);
        // Persist to disk
        await this.persistence.saveDocument(stored);
        return stored;
    }
    /**
     * Convert Python group objects to TypeScript DocumentGroup[]
     */
    convertPythonGroups(pythonGroups, document) {
        return pythonGroups.map((pg) => {
            // Get pages for this group
            const groupPages = document.pages.filter((p) => p.number >= pg.start_page && p.number <= pg.end_page);
            return {
                id: pg.group_id,
                type: this.mapStrategy(pg.strategy),
                title: pg.title,
                startPage: pg.start_page,
                endPage: pg.end_page,
                pages: groupPages,
                fullText: pg.full_text,
                tables: pg.tables,
                imagePaths: pg.image_paths,
                metadata: {
                    strategy: pg.strategy,
                },
            };
        });
    }
    /**
     * Map Python strategy string to TypeScript GroupingStrategy
     */
    mapStrategy(strategy) {
        const strategyMap = {
            toc: 'toc',
            heading: 'heading',
            range: 'fixed',
        };
        return strategyMap[strategy] || 'fixed';
    }
    /**
     * Get groups filtered by strategy
     */
    getGroupsByStrategy(documentId, strategy) {
        const doc = this.documents.get(documentId);
        if (!doc)
            return [];
        return doc.groups.filter((g) => {
            if (strategy === 'range') {
                return g.type === 'fixed';
            }
            return g.type === strategy;
        });
    }
    /**
     * Get all available strategies for a document
     */
    getAvailableStrategies(documentId) {
        const doc = this.documents.get(documentId);
        if (!doc)
            return [];
        const strategies = new Set();
        for (const group of doc.groups) {
            strategies.add(group.type);
        }
        return Array.from(strategies);
    }
    get(documentId) {
        return this.documents.get(documentId);
    }
    getGroup(documentId, groupId) {
        const doc = this.documents.get(documentId);
        return doc?.groups.find(g => g.id === groupId);
    }
    list() {
        return Array.from(this.documents.values());
    }
    async delete(documentId) {
        const existed = this.documents.delete(documentId);
        if (existed) {
            // Remove from persistence
            await this.persistence.deleteDocument(documentId);
        }
        return existed;
    }
    /**
     * Get storage statistics
     */
    async getStats() {
        const persistenceStats = await this.persistence.getStats();
        return {
            documentCount: this.documents.size,
            persistence: persistenceStats,
        };
    }
    createFixedGroups(document) {
        const pagesPerGroup = 10;
        const groups = [];
        const pages = document.pages;
        for (let i = 0; i < pages.length; i += pagesPerGroup) {
            const groupPages = pages.slice(i, Math.min(i + pagesPerGroup, pages.length));
            const startPage = i + 1;
            const endPage = Math.min(i + pagesPerGroup, pages.length);
            groups.push({
                id: (0, uuid_1.v4)(),
                type: 'fixed',
                title: `Pages ${startPage}-${endPage}`,
                startPage,
                endPage,
                pages: groupPages,
                metadata: {
                    groupIndex: Math.floor(i / pagesPerGroup),
                },
            });
        }
        return groups;
    }
}
exports.DocumentStore = DocumentStore;
function createDocumentStore(llmClient, options) {
    return new DocumentStore(llmClient, options);
}
//# sourceMappingURL=document-store.js.map