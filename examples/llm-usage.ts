import { createLLMClient, LLMPipeline, createLLMPipeline } from '../src/index.js';

async function llmPipelineExample() {
  const llmClient = createLLMClient({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
    model: 'gpt-4',
    temperature: 0.3,
  });

  const pipeline = createLLMPipeline({
    llmClient,
    groupingStrategy: 'hybrid',
    extractionPrompt: `Extract structured information from this document section.
Focus on:
- Key entities (people, organizations, dates, amounts)
- Main topics and themes
- Important data points
- Relationships between entities`,
    execution: {
      maxConcurrency: 4,
      retryAttempts: 3,
      timeout: 60000,
      continueOnError: true,
    },
    output: {
      format: 'json',
      includeMetadata: true,
      prettyPrint: true,
    },
  }, {
    onParseComplete: (doc) => {
      console.log(`Parsed: ${doc.metadata.pageCount} pages`);
    },
    onAnalysisComplete: (groups, docType) => {
      console.log(`Document type: ${docType}`);
      console.log(`Identified ${groups.length} groups`);
      groups.forEach(g => {
        console.log(`  - ${g.title} (pages ${g.startPage}-${g.endPage})`);
      });
    },
    onExtractionProgress: (completed, total, groupId) => {
      console.log(`Progress: ${completed}/${total} - ${groupId}`);
    },
  });

  const result = await pipeline.execute('./document.pdf');

  console.log('\n=== Result ===');
  console.log('Status:', result.status);
  console.log('Statistics:', result.statistics);
  console.log('\nMerged Output:');
  console.log(pipeline.formatOutput(result));
}

async function fixedGroupsWithLLMExtraction() {
  const llmClient = createLLMClient({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key',
  });

  const pipeline = createLLMPipeline({
    llmClient,
    groupingStrategy: 'fixed',
    execution: {
      maxConcurrency: 6,
    },
  });

  const result = await pipeline.execute('./large-document.pdf');
  console.log(result.mergedOutput);
}

async function mockLLMExample() {
  const llmClient = createLLMClient({
    provider: 'mock',
  });

  const pipeline = createLLMPipeline({
    llmClient,
    groupingStrategy: 'hybrid',
  });

  const result = await pipeline.execute('./sample.pdf');
  console.log('Result:', result.status);
}

llmPipelineExample().catch(console.error);