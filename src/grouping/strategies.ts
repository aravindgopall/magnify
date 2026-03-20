import { v4 as uuidv4 } from 'uuid';
import type {
  PDFDocument,
  Page,
  DocumentGroup,
  GroupingConfig,
  GroupingStrategy,
  HeadingInfo,
  TOCItem,
} from '../types/index.js';
import type { LLMClient } from '../llm/client.js';
import { MainAgent } from '../llm/main-agent.js';

export interface GroupingStrategyHandler {
  group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]>;
}

export class FixedPageGrouper implements GroupingStrategyHandler {
  async group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]> {
    const pagesPerGroup = config.fixedPagesPerGroup || 10;
    const pages = document.pages;
    const groups: DocumentGroup[] = [];

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

export class LLMGrouper implements GroupingStrategyHandler {
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  async group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]> {
    const mainAgent = new MainAgent(this.llmClient);
    return mainAgent.identifyGroups(document, config.strategy === 'hybrid' ? undefined : config.strategy);
  }
}

export class HeadingGrouper implements GroupingStrategyHandler {
  async group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]> {
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

    const groups: DocumentGroup[] = [];

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

  private extractHeadings(pages: Page[], levels: number[]): HeadingInfo[] {
    const headings: HeadingInfo[] = [];

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

  private mergeSmallGroups(groups: DocumentGroup[], config: GroupingConfig): DocumentGroup[] {
    const minSize = config.minGroupSize || 1;
    const maxSize = config.maxGroupSize || 50;
    
    const merged: DocumentGroup[] = [];
    let current: DocumentGroup | null = null;

    for (const group of groups) {
      if (!current) {
        current = { ...group };
        continue;
      }

      if (current.pages.length + group.pages.length <= maxSize && group.pages.length < minSize) {
        current.endPage = group.endPage;
        current.pages = [...current.pages, ...group.pages];
        current.title = `${current.title} / ${group.title}`;
      } else {
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

export class TOCGrouper implements GroupingStrategyHandler {
  async group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]> {
    const toc = document.toc;
    
    if (!toc || toc.items.length === 0) {
      return new HeadingGrouper().group(document, {
        ...config,
        strategy: 'heading',
      });
    }

    const pages = document.pages;
    const flatItems = this.flattenTOC(toc.items);
    const groups: DocumentGroup[] = [];

    for (let i = 0; i < flatItems.length; i++) {
      const currentItem = flatItems[i];
      const nextItem = flatItems[i + 1];
      
      const startPage = currentItem.pageNumber;
      const endPage = nextItem ? nextItem.pageNumber - 1 : pages.length;
      
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

  private flattenTOC(items: TOCItem[], level: number = 0): TOCItem[] {
    const flat: TOCItem[] = [];

    for (const item of items) {
      flat.push({ ...item, level });
      if (item.children && item.children.length > 0) {
        flat.push(...this.flattenTOC(item.children, level + 1));
      }
    }

    return flat;
  }
}

export class HybridGrouper implements GroupingStrategyHandler {
  private tocGrouper = new TOCGrouper();
  private headingGrouper = new HeadingGrouper();
  private fixedGrouper = new FixedPageGrouper();

  async group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]> {
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

  private hasHeadings(document: PDFDocument): boolean {
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

export class GroupingStrategyFactory {
  private llmClient?: LLMClient;

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  getHandler(strategy: GroupingStrategy): GroupingStrategyHandler {
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

  async group(document: PDFDocument, config: GroupingConfig): Promise<DocumentGroup[]> {
    const handler = this.getHandler(config.strategy);
    return handler.group(document, config);
  }
}

export const groupingFactory = new GroupingStrategyFactory();