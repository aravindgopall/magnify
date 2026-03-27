export interface SubAgentResult {
  groupId: string;
  groupTitle: string;
  hasRelevantContext: boolean;
  context?: string;
  relevantExcerpt?: string;
}

export interface QueryAgentResult {
  answer: string;
  sources: Array<{
    groupId: string;
    groupTitle: string;
    startPage: number;
    endPage: number;
    relevantExcerpt?: string;
  }>;
  confidence: number;
  metadata?: {
    totalGroups: number;
    relevantGroups: number;
    processingTimeMs: number;
  };
}

export interface QueryAgentConfig {
  documentId: string;
  query: string;
  maxParallelSubAgents?: number;
  relevanceThreshold?: number;
  extractionType?: 'summary' | 'entities' | 'full' | 'custom';
  customPrompt?: string;
}
