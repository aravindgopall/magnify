"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentStore = void 0;
exports.createDocumentStore = createDocumentStore;
const uuid_1 = require("uuid");
const index_js_1 = require("../parser/index.js");
const main_agent_js_1 = require("../llm/main-agent.js");
class DocumentStore {
    documents = new Map();
    llmClient;
    mainAgent;
    constructor(llmClient) {
        this.llmClient = llmClient;
        this.mainAgent = new main_agent_js_1.MainAgent(llmClient);
    }
    async upload(source, options = {}) {
        const parser = (0, index_js_1.createParser)();
        const document = await parser.parse(source);
        const strategy = options.groupingStrategy || 'hybrid';
        let groups;
        if (strategy === 'fixed') {
            groups = this.createFixedGroups(document);
        }
        else {
            groups = await this.mainAgent.identifyGroups(document, strategy);
        }
        const analysis = await this.mainAgent.analyzeDocument(document);
        const stored = {
            id: document.id,
            document,
            groups,
            metadata: {
                uploadedAt: new Date(),
                fileName: options.fileName,
                groupingStrategy: strategy,
                documentType: analysis.documentType,
            },
        };
        this.documents.set(stored.id, stored);
        return stored;
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
    delete(documentId) {
        return this.documents.delete(documentId);
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
function createDocumentStore(llmClient) {
    return new DocumentStore(llmClient);
}
//# sourceMappingURL=document-store.js.map