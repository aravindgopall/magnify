"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupingFactory = exports.GroupingStrategyFactory = exports.HybridGrouper = exports.TOCGrouper = exports.HeadingGrouper = exports.LLMGrouper = exports.FixedPageGrouper = void 0;
const uuid_1 = require("uuid");
const main_agent_js_1 = require("../llm/main-agent.js");
class FixedPageGrouper {
    async group(document, config) {
        const pagesPerGroup = config.fixedPagesPerGroup || 10;
        const pages = document.pages;
        const groups = [];
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
exports.FixedPageGrouper = FixedPageGrouper;
class LLMGrouper {
    llmClient;
    constructor(llmClient) {
        this.llmClient = llmClient;
    }
    async group(document, config) {
        const mainAgent = new main_agent_js_1.MainAgent(this.llmClient);
        return mainAgent.identifyGroups(document, config.strategy === 'hybrid' ? undefined : config.strategy);
    }
}
exports.LLMGrouper = LLMGrouper;
class HeadingGrouper {
    async group(document, config) {
        const pages = document.pages;
        const headingLevels = config.headingLevels || [1, 2];
        const minGroupSize = config.minGroupSize || 1;
        const headings = this.extractHeadings(pages, headingLevels);
        if (headings.length === 0) {
            return new FixedPageGrouper().group(document, {
                ...config,
                strategy: 'fixed',
            });
        }
        const groups = [];
        for (let i = 0; i < headings.length; i++) {
            const currentHeading = headings[i];
            const nextHeading = headings[i + 1];
            const startPage = currentHeading.pageNumber;
            const endPage = nextHeading ? nextHeading.pageNumber - 1 : pages.length;
            if (endPage - startPage + 1 < minGroupSize && i < headings.length - 1) {
                continue;
            }
            const groupPages = pages.slice(startPage - 1, endPage);
            groups.push({
                id: (0, uuid_1.v4)(),
                type: 'heading',
                title: currentHeading.text,
                startPage,
                endPage,
                pages: groupPages,
                metadata: {
                    headingLevel: currentHeading.level,
                    headingText: currentHeading.text,
                },
            });
        }
        return this.mergeSmallGroups(groups, config);
    }
    extractHeadings(pages, levels) {
        const headings = [];
        for (const page of pages) {
            for (const element of page.elements) {
                if (element.type === 'heading' && element.level !== undefined && levels.includes(element.level)) {
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
    mergeSmallGroups(groups, config) {
        const minSize = config.minGroupSize || 1;
        const maxSize = config.maxGroupSize || 50;
        const merged = [];
        let current = null;
        for (const group of groups) {
            if (!current) {
                current = { ...group };
                continue;
            }
            if (current.pages.length + group.pages.length <= maxSize && group.pages.length < minSize) {
                current.endPage = group.endPage;
                current.pages = [...current.pages, ...group.pages];
                current.title = `${current.title} / ${group.title}`;
            }
            else {
                if (current.pages.length >= minSize) {
                    merged.push(current);
                }
                current = { ...group };
            }
        }
        if (current) {
            merged.push(current);
        }
        return merged;
    }
}
exports.HeadingGrouper = HeadingGrouper;
class TOCGrouper {
    async group(document, config) {
        const toc = document.toc;
        if (!toc || toc.items.length === 0) {
            return new HeadingGrouper().group(document, {
                ...config,
                strategy: 'heading',
            });
        }
        const pages = document.pages;
        const flatItems = this.flattenTOC(toc.items);
        const groups = [];
        for (let i = 0; i < flatItems.length; i++) {
            const currentItem = flatItems[i];
            const nextItem = flatItems[i + 1];
            const startPage = currentItem.pageNumber;
            const endPage = nextItem ? nextItem.pageNumber - 1 : pages.length;
            const groupPages = pages.slice(startPage - 1, endPage);
            groups.push({
                id: (0, uuid_1.v4)(),
                type: 'toc',
                title: currentItem.title,
                startPage,
                endPage,
                pages: groupPages,
                metadata: {
                    tocLevel: currentItem.level,
                    tocTitle: currentItem.title,
                },
            });
        }
        return groups;
    }
    flattenTOC(items, level = 0) {
        const flat = [];
        for (const item of items) {
            flat.push({ ...item, level });
            if (item.children && item.children.length > 0) {
                flat.push(...this.flattenTOC(item.children, level + 1));
            }
        }
        return flat;
    }
}
exports.TOCGrouper = TOCGrouper;
class HybridGrouper {
    tocGrouper = new TOCGrouper();
    headingGrouper = new HeadingGrouper();
    fixedGrouper = new FixedPageGrouper();
    async group(document, config) {
        if (document.toc && document.toc.items.length > 0) {
            const groups = await this.tocGrouper.group(document, config);
            if (groups.length > 0) {
                return groups;
            }
        }
        const headings = this.hasHeadings(document);
        if (headings) {
            const groups = await this.headingGrouper.group(document, config);
            if (groups.length > 0) {
                return groups;
            }
        }
        return this.fixedGrouper.group(document, {
            ...config,
            strategy: 'fixed',
        });
    }
    hasHeadings(document) {
        for (const page of document.pages) {
            for (const element of page.elements) {
                if (element.type === 'heading') {
                    return true;
                }
            }
        }
        return false;
    }
}
exports.HybridGrouper = HybridGrouper;
class GroupingStrategyFactory {
    llmClient;
    setLLMClient(client) {
        this.llmClient = client;
    }
    getHandler(strategy) {
        if (strategy !== 'fixed' && this.llmClient) {
            return new LLMGrouper(this.llmClient);
        }
        switch (strategy) {
            case 'fixed':
                return new FixedPageGrouper();
            case 'heading':
                return new HeadingGrouper();
            case 'toc':
                return new TOCGrouper();
            case 'hybrid':
                return new HybridGrouper();
            default:
                return new FixedPageGrouper();
        }
    }
    async group(document, config) {
        const handler = this.getHandler(config.strategy);
        return handler.group(document, config);
    }
}
exports.GroupingStrategyFactory = GroupingStrategyFactory;
exports.groupingFactory = new GroupingStrategyFactory();
//# sourceMappingURL=strategies.js.map