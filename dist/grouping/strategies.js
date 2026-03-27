import { v4 as uuidv4 } from 'uuid';
import { MainAgent } from '../llm/main-agent.js';
export class FixedPageGrouper {
    async group(document, config) {
        const pagesPerGroup = config.fixedPagesPerGroup || 10;
        const pages = document.pages;
        const groups = [];
        for (let i = 0; i < pages.length; i += pagesPerGroup) {
            const groupPages = pages.slice(i, Math.min(i + pagesPerGroup, pages.length));
            const startPage = i + 1;
            const endPage = Math.min(i + pagesPerGroup, pages.length);
            groups.push({
                id: uuidv4(),
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
export class LLMGrouper {
    llmClient;
    constructor(llmClient) {
        this.llmClient = llmClient;
    }
    async group(document, config) {
        const mainAgent = new MainAgent(this.llmClient);
        return mainAgent.identifyGroups(document, config.strategy);
    }
}
export class HeadingGrouper {
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
            let endPage = nextHeading ? nextHeading.pageNumber - 1 : pages.length;
            // Fix: Ensure endPage is not before startPage (handles multiple headings on same page)
            if (endPage < startPage) {
                endPage = startPage;
            }
            if (endPage - startPage + 1 < minGroupSize && i < headings.length - 1) {
                continue;
            }
            const groupPages = pages.slice(startPage - 1, endPage);
            groups.push({
                id: uuidv4(),
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
export class TOCGrouper {
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
            let endPage = nextItem ? nextItem.pageNumber - 1 : pages.length;
            // Ensure endPage is not before startPage
            if (endPage < startPage) {
                endPage = startPage;
            }
            const groupPages = pages.slice(startPage - 1, endPage);
            groups.push({
                id: uuidv4(),
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
export class GroupingStrategyFactory {
    llmClient;
    setLLMClient(client) {
        this.llmClient = client;
    }
    getHandler(strategy) {
        switch (strategy) {
            case 'fixed':
                return new FixedPageGrouper();
            case 'heading':
                return new HeadingGrouper();
            case 'toc':
                return new TOCGrouper();
            default:
                return new FixedPageGrouper();
        }
    }
    async group(document, config) {
        const handler = this.getHandler(config.strategy);
        return handler.group(document, config);
    }
}
export const groupingFactory = new GroupingStrategyFactory();
//# sourceMappingURL=strategies.js.map