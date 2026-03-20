# Magnify - Semantic PDF Scraper

A configurable PDF scraping pipeline with LLM-powered orchestration. Upload once, query many times.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Upload    │────▶│  Main Agent     │────▶│  Document Store │
│   PDF       │     │  (Grouping)     │     │  (Groups + IDs) │
└─────────────┘     └─────────────────┘     └────────┬────────┘
                                                    
┌─────────────┐                                     
│   Query     │──────────────────────────────────────┘ User
│   Request   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌─────────────────┐
│  Query          │────▶│  Main Agent     │
│  Orchestrator   │     │  (Route Query)  │
└────────--───────┘     └───────┬-────────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
    ┌────────────┐         ┌────────────┐    ┌────────────┐
    │ Subagent 1 │         │ Subagent 2 │    │ Subagent N │
    │ (Group A)  │         │ (Group B)  │    │ (Group N)  │
    └─────┬──────┘         └─────┬──────┘    └─────┬──────┘
          │                      │                 │
          └──────────────────────┼─────────────────┘
                                 │
                                 ▼
                         ┌───────────────┐
                         │  Merge &      │
                         │  Respond      │
                         └───────────────┘
```

## Workflow

1. **Upload**: POST `/api/documents/upload` - Upload PDF, main agent groups it
2. **Query**: POST `/api/query` - Query any uploaded document
3. **Orchestrate**: Main agent routes query to relevant subagents
4. **Respond**: Subagents process and return structured results

## Quick Start

```bash
npm install
npm run build

# With OpenAI
OPENAI_API_KEY=sk-... LLM_PROVIDER=openai npm run dev

# With mock LLM (for testing)
npm run dev
```

## API Endpoints

### Upload & Manage Documents

```bash
# Upload PDF
curl -X POST http://localhost:3000/api/documents/upload \
  -H "Content-Type: application/json" \
  -d '{"source": "./document.pdf", "groupingStrategy": "hybrid"}'

# Response: documentId, groups with IDs

# List documents
curl http://localhost:3000/api/documents

# Get document details
curl http://localhost:3000/api/documents/{documentId}

# Get groups
curl http://localhost:3000/api/documents/{documentId}/groups
```

### Query Documents

```bash
# Query a document
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "doc-123",
    "query": "What are the main findings?",
    "extractionType": "summary"
  }'

# Query specific groups
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "doc-123",
    "query": "Extract all monetary amounts",
    "groupIds": ["group-1", "group-3"],
    "extractionType": "entities"
  }'

# Query document directly
curl -X POST http://localhost:3000/api/documents/{documentId}/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Summarize the conclusions"}'
```

## Query Types

| extractionType | Description |
|----------------|-------------|
| `summary` | Concise summary relevant to query |
| `entities` | Extract entities (people, dates, amounts, etc.) |
| `full` | Comprehensive answer with all details |
| `custom` | Use custom prompt |

## Grouping Strategies

| Strategy | Description | LLM-Powered |
|----------|-------------|-------------|
| `fixed` | Fixed page ranges | No |
| `heading` | Split by headings | Yes |
| `toc` | Use table of contents | Yes |
| `hybrid` | Auto-detect best method | Yes |

## Temperature
closer to 0 means return fast.
closer to 1 means return right.

## Programmatic Usage

```typescript
import { createLLMClient, DocumentStore, QueryOrchestrator } from 'magnify';

const llmClient = createLLMClient({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
});

const documentStore = new DocumentStore(llmClient);
const orchestrator = new QueryOrchestrator(llmClient, documentStore);

// Upload
const doc = await documentStore.upload('./report.pdf', {
  groupingStrategy: 'hybrid',
});
console.log('Groups:', doc.groups);

// Query
const result = await orchestrator.execute({
  documentId: doc.id,
  query: 'What are the key recommendations?',
});

console.log('Answer:', result.result.answer);
console.log('Sources:', result.result.sources);
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `HOST` | Server host | 0.0.0.0 |
| `LLM_PROVIDER` | LLM provider (openai/mock) | mock |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `LLM_MODEL` | Model to use | gpt-4 |

## Development

```bash
npm run dev        # Development server
npm run build      # Build for production
npm run typecheck  # Type check
npm run test       # Run tests
```

## License

MIT

## Example Flow
Flow :
  - accept query 
  - find all groupings (10 + 100 + 50) for this pdf (group by flow (10), group by heading (100), group by toc (50))
  - based on temperature, recalculate the groups (100 -> x (x <=100))
  - based on tagging/vector embedding of the group against the query, sort the group.
  - for each group, start a sub agent process
                   agent name (context)
      Main Agent -> s1 (f1) -> s1a (i don't have knowledge about them, documentreferences)
                 -> s2 (f2) -> s2a (this is what flowA is about, documentreferences)
                 -> s3 (f3) -> s3a (this is what flowB is about, documentreferences)
                 -> s4 ...
                 -> s5 ...

            Merge answers (s1a, s2a, s3a) (the difference between flowA and flowB)