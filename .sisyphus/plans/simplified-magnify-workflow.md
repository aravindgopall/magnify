# Simplified Magnify Workflow - Work Plan

**Created**: 2026-04-14
**Status**: Ready for Implementation
**Estimated Tasks**: 18

---

## Overview

Simplify Magnify to use CLI commands for PDF ingestion and querying, with 3 SQLite databases for different chunking strategies and pi-mono based agent orchestration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Interface                            │
│   npm ingest <file_path>          npm query "question"          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HTTP API (Keep Both)                       │
│            POST /api/ingest         POST /api/query-agents      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Python PDF Extractor                         │
│         (extracts text, tables → markdown, flags images)       │
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  fixed_chunks   │  │ heading_chunks  │  │   toc_chunks    │
│      .db        │  │      .db        │  │      .db        │
│   (10 pages)    │  │  (by headings)  │  │   (by TOC)      │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Query Processing                             │
│  1. Classify query → extractionType (LLM)                       │
│  2. Load chunks from all 3 DBs                                  │
│  3. Spawn 9 subagents (3 per DB, parallel batches)             │
│  4. Each subagent: check relevance → return chunk or skip       │
│  5. Main agent: collect relevant chunks → synthesize answer     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API vs CLI | Keep Both | Flexibility for different use cases |
| Query Classification | LLM-based | More accurate than keyword matching |
| DocumentStore | Remove | Simplify to SQLite only |
| Subagent Parallelism | 3 per DB = 9 total | Balance between speed and load |
| pi-mono Usage | System-prompt only | No tools, just prompt ingestion |

---

## Scope

### IN Scope
- CLI commands: `npm ingest <file_path>` and `npm query "question"`
- 3 SQLite databases for chunking strategies
- LLM-based query classification
- Parallel subagent spawning (9 at a time)
- HTTP API endpoints for `/api/query` and `/api/query-agents`
- Remove DocumentStore entirely

### OUT of Scope
- Image extraction (just flag, ignore content)
- Vector embeddings
- Multi-document queries
- Authentication/authorization

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/cli/ingest.ts` | CLI entry for `npm ingest` |
| `src/cli/query.ts` | CLI entry for `npm query` |

## Files to Modify

| File | Changes |
|------|---------|
| `src/query/pi-mono-agent.ts` | Read from SQLite DBs, add query classification |
| `src/query/sub-agent.ts` | Work with SQLite chunks instead of DocumentGroup |
| `src/api/routes.ts` | Update to use new query pipeline |
| `src/api/server.ts` | Remove DocumentStore initialization |

## Files to Delete

| File/Diretory | Reason |
|---------------|--------|
| `src/store/` | Replaced by SQLite databases |
| `src/orchestrator/query-orchestrator.ts` | Replaced by new query pipeline |

---

## Final Verification Wave

After all tasks complete, the following must be verified:

1. **Ingestion Test**: Run `npm ingest <sample.pdf>` and verify:
   - 3 SQLite databases created in `data/` directory
   - Fixed chunks contain 10 pages each
   - Heading chunks based on detected headings
   - TOC chunks based on PDF's table of contents
   - Tables converted to markdown format
   - Images flagged but not stored

2. **Query Test**: Run `npm query "What is the main topic?"` and verify:
   - Query classified correctly (summary/entities/full/custom)
   - Subagents spawned (3 per DB = 9 parallel batches)
   - Relevant chunks returned
   - Answer synthesized based on extractionType

3. **API Test**: Verify HTTP endpoints still work:
   - `POST /api/query-agents` returns correct response
   - Health check passes

4. **User Confirmation**: Ask user to verify results before marking complete

---

## Tasks

### Phase 1: CLI Implementation

#### Task 1: Create CLI Ingest Command
**File**: `src/cli/ingest.ts` (NEW)
**Description**: Create CLI entry point for `npm ingest <file_path>`

**Implementation**:
1. Parse command-line arguments using process.argv
2. Validate file path exists
3. Call `ingestPDF(filePath)` from `src/ingest/pipeline.ts`
4. Print results to console (documentId, chunk counts)
5. Handle errors gracefully with exit code 1

**Code Pattern**:
```typescript
// src/cli/ingest.ts
import { ingestPDF } from '../ingest/pipeline.js';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm ingest <file_path>');
    process.exit(1);
  }
  const result = await ingestPDF(filePath);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(console.error);
```

**Acceptance Criteria**:
- [ ] Command `npm ingest sample.pdf` successfully ingests PDF
- [ ] Console output shows documentId and chunk counts for all 3 DBs
- [ ] Error handling for missing file shows helpful message
- [ ] Exit code 0 on success, 1 on error

---

#### Task 2: Create CLI Query Command
**File**: `src/cli/query.ts` (NEW)
**Description**: Create CLI entry point for `npm query "question"`

**Implementation**:
1. Parse query from command-line arguments
2. Find the latest documentId from SQLite databases
3. Call new query pipeline (to be created in Phase 2)
4. Print answer and sources to console
5. Support optional `--extraction-type` flag

**Code Pattern**:
```typescript
// src/cli/query.ts
import { SQLiteQueryPipeline } from '../query/sqlite-pipeline.js';

async function main() {
  const query = process.argv[2];
  const extractionType = process.argv.includes('--type') 
    ? process.argv[process.argv.indexOf('--type') + 1] 
    : undefined;
  
  const pipeline = new SQLiteQueryPipeline();
  const result = await pipeline.execute({ query, extractionType });
  console.log(result.answer);
}
main().catch(console.error);
```

**Acceptance Criteria**:
- [ ] Command `npm query "What is X?"` returns answer
- [ ] Optional `--type summary|entities|full|custom` works
- [ ] Console output shows answer and relevant sources
- [ ] Error handling for no documents shows helpful message

---

#### Task 3: Add Query Classification to Main Agent
**File**: `src/query/pi-mono-agent.ts` (MODIFY)
**Description**: Add LLM-based query classification before spawning subagents

**Implementation**:
1. Add `classifyQuery(query: string)` method to PiMonoQueryAgent
2. Use main agent to classify query into: summary, entities, full, or custom
3. Call classification at start of `execute()` method
4. Pass classified extractionType to subagents

**Code Pattern**:
```typescript
private async classifyQuery(query: string): Promise<ExtractionType> {
  const prompt = `Classify this query into ONE type:
- summary: asking for overview/brief
- entities: asking to extract/list specific items
- full: asking for detailed explanation
- custom: other/special requests

Query: "${query}"
Type:`;
  
  this.mainAgent.reset();
  await this.mainAgent.prompt(prompt);
  await this.mainAgent.waitForIdle();
  // Extract type from response
}
```

**Acceptance Criteria**:
- [ ] Query "Summarize the document" classified as "summary"
- [ ] Query "Extract all names" classified as "entities"
- [ ] Query "Explain in detail" classified as "full"
- [ ] Classification happens before subagent spawning

---

#### Task 4: Create SQLite Query Pipeline
**File**: `src/query/sqlite-pipeline.ts` (NEW)
**Description**: New query pipeline that reads from SQLite databases directly

**Implementation**:
1. Create `SQLiteQueryPipeline` class
2. Load chunks from all 3 databases using `getDatabase()`
3. Combine chunks into single list with source DB metadata
4. Pass to modified PiMonoQueryAgent
5. Return synthesized answer

**Code Pattern**:
```typescript
// src/query/sqlite-pipeline.ts
import { getDatabase } from '../db/database.js';

export class SQLiteQueryPipeline {
  async execute(config: { query: string; extractionType?: string }) {
    // Load all chunks from 3 DBs
    const fixedDb = getDatabase('fixed');
    const headingDb = getDatabase('heading');
    const tocDb = getDatabase('toc');
    
    const allChunks = [
      ...fixedDb.getAllChunks().map(c => ({ ...c, source: 'fixed' })),
      ...headingDb.getAllChunks().map(c => ({ ...c, source: 'heading' })),
      ...tocDb.getAllChunks().map(c => ({ ...c, source: 'toc' })),
    ];
    
    // Use modified PiMonoQueryAgent with SQLite chunks
    const agent = new SQLiteQueryAgent(allChunks);
    return agent.execute(config);
  }
}
```

**Acceptance Criteria**:
- [ ] Loads chunks from all 3 SQLite databases
- [ ] Each chunk has source metadata (fixed/heading/toc)
- [ ] Works with modified PiMonoQueryAgent
- [ ] Returns answer with sources

---

### Phase 2: Subagent Spawning Modification

#### Task 5: Modify Subagent to Work with SQLite Chunks
**File**: `src/query/sub-agent.ts` (MODIFY)
**Description**: Update GroupContextAgent to accept SQLite chunks instead of DocumentGroup

**Implementation**:
1. Change `analyze()` method signature to accept `SQLiteChunk` type
2. Update prompt building to use chunk content directly
3. Keep same relevance checking logic
4. Add chunk source (fixed/heading/toc) to result

**Code Pattern**:
```typescript
interface SQLiteChunk {
  id: number;
  document_id: string;
  chunk_id: string;
  title: string | null;
  content: string;
  start_page: number;
  end_page: number;
  strategy: string;
  source: 'fixed' | 'heading' | 'toc';
}

async analyze(chunk: SQLiteChunk, query: string): Promise<SubAgentResult> {
  const prompt = this.buildPrompt(chunk, query);
  // ... same relevance checking logic
}
```

**Acceptance Criteria**:
- [ ] Subagent accepts SQLiteChunk type
- [ ] Relevance checking works with new chunk format
- [ ] Result includes chunk source (fixed/heading/toc)
- [ ] NOT_RELEVANT marker still works correctly

---

#### Task 6: Implement 3-Per-DB Parallel Spawning
**File**: `src/query/sqlite-query-agent.ts` (NEW - based on pi-mono-agent.ts)
**Description**: Spawn subagents 3 per database = 9 parallel at a time

**Implementation**:
1. Group chunks by source database (fixed, heading, toc)
2. Create 3 subagent instances per database
3. Distribute chunks evenly among the 3 subagents per DB
4. Process all 9 subagents in parallel
5. Collect results as they complete

**Code Pattern**:
```typescript
async processChunksInParallel(chunks: SQLiteChunk[], query: string) {
  // Group by source
  const bySource = {
    fixed: chunks.filter(c => c.source === 'fixed'),
    heading: chunks.filter(c => c.source === 'heading'),
    toc: chunks.filter(c => c.source === 'toc'),
  };
  
  // Create 3 subagents per source
  const subagents = {
    fixed: [new SubAgent(), new SubAgent(), new SubAgent()],
    heading: [new SubAgent(), new SubAgent(), new SubAgent()],
    toc: [new SubAgent(), new SubAgent(), new SubAgent()],
  };
  
  // Distribute chunks and run in parallel
  const promises: Promise<SubAgentResult>[] = [];
  
  for (const [source, agents] of Object.entries(subagents)) {
    const sourceChunks = bySource[source];
    const chunkSize = Math.ceil(sourceChunks.length / 3);
    
    agents.forEach((agent, i) => {
      const myChunks = sourceChunks.slice(i * chunkSize, (i + 1) * chunkSize);
      myChunks.forEach(chunk => {
        promises.push(agent.analyze(chunk, query));
      });
    });
  }
  
  // Process in batches of 9
  const results = [];
  for (let i = 0; i < promises.length; i += 9) {
    const batch = promises.slice(i, i + 9);
    results.push(...await Promise.all(batch));
  }
  
  return results.filter(r => r.hasRelevantContext);
}
```

**Acceptance Criteria**:
- [ ] Exactly 3 subagents spawned per database (9 total parallel)
- [ ] Chunks distributed evenly among subagents
- [ ] All 9 run concurrently
- [ ] Results collected and filtered for relevance

---

### Phase 3: Remove DocumentStore

#### Task 7: Remove DocumentStore Directory
**File**: `src/store/` (DELETE)
**Description**: Remove entire DocumentStore directory and all references

**Implementation**:
1. Delete `src/store/` directory and all files
2. Remove imports from `src/api/routes.ts`
3. Remove imports from `src/api/server.ts`
4. Remove from `src/index.ts` exports
5. Update any remaining references

**Files to Delete**:
- `src/store/document-store.ts`
- `src/store/persistence.ts`
- `src/store/query-log.ts`
- `src/store/index.ts`

**Acceptance Criteria**:
- [ ] `src/store/` directory completely removed
- [ ] No import errors after removal
- [ ] Build succeeds without DocumentStore

---

#### Task 8: Remove Query Orchestrator
**File**: `src/orchestrator/` (DELETE)
**Description**: Remove old query orchestrator that used DocumentStore

**Implementation**:
1. Delete `src/orchestrator/query-orchestrator.ts`
2. Delete `src/orchestrator/index.ts`
3. Update `src/api/routes.ts` to use new SQLiteQueryPipeline
4. Remove orchestrator references from other files

**Acceptance Criteria**:
- [ ] `src/orchestrator/` directory removed
- [ ] API routes use new SQLiteQueryPipeline
- [ ] No import errors

---

#### Task 9: Update API Routes
**File**: `src/api/routes.ts` (MODIFY)
**Description**: Update API routes to use new query pipeline

**Implementation**:
1. Remove DocumentStore and QueryOrchestrator imports
2. Add SQLiteQueryPipeline import
3. Update `POST /api/query` to use new pipeline
4. Update `POST /api/query-agents` to use new pipeline
5. Update health check to check SQLite DBs instead

**Code Pattern**:
```typescript
// Updated createAPIContext
export function createAPIContext(): APIContext {
  const queryPipeline = new SQLiteQueryPipeline();
  return { queryPipeline };
}

// Updated /api/query-agents
router.post('/query-agents', async (req, res) => {
  const { query, extractionType } = req.body;
  const result = await context.queryPipeline.execute({ query, extractionType });
  res.json(result);
});
```

**Acceptance Criteria**:
- [ ] `POST /api/query-agents` returns correct response
- [ ] `POST /api/query` returns correct response
- [ ] Health check reports SQLite DB status
- [ ] No DocumentStore references remain

---

#### Task 10: Update API Server
**File**: `src/api/server.ts` (MODIFY)
**Description**: Update server initialization without DocumentStore

**Implementation**:
1. Remove DocumentStore initialization
2. Initialize SQLite databases on startup
3. Update context creation

**Acceptance Criteria**:
- [ ] Server starts without DocumentStore
- [ ] SQLite databases initialized on startup
- [ ] Health endpoint works

---

### Phase 4: Testing & Verification

#### Task 11: Test Ingestion CLI
**File**: Manual testing
**Description**: Verify `npm ingest` works correctly

**Test Cases**:
1. Ingest a sample PDF with text content
2. Ingest a PDF with tables
3. Ingest a PDF with images
4. Ingest a PDF with TOC
5. Ingest a PDF without TOC

**Acceptance Criteria**:
- [ ] `npm ingest sample.pdf` succeeds
- [ ] `data/fixed_chunks.db` created with correct chunks
- [ ] `data/heading_chunks.db` created with heading-based chunks
- [ ] `data/toc_chunks.db` created (or empty if no TOC)
- [ ] Tables appear as markdown in chunk content
- [ ] Images flagged with `has_images=true` but not stored

---

#### Task 12: Test Query CLI
**File**: Manual testing
**Description**: Verify `npm query` works correctly

**Test Cases**:
1. Query: "Summarize the document" (should classify as summary)
2. Query: "Extract all names mentioned" (should classify as entities)
3. Query: "Explain the main topic in detail" (should classify as full)
4. Query: "What is [specific term]?" (should find relevant chunks)

**Acceptance Criteria**:
- [ ] Query classification works correctly
- [ ] Subagents spawn (check console logs for 9 parallel)
- [ ] Relevant chunks returned
- [ ] Answer synthesized based on extractionType
- [ ] Sources cited in response

---

#### Task 13: Test HTTP API Endpoints
**File**: Manual testing
**Description**: Verify HTTP API still works

**Test Cases**:
1. `POST /api/query-agents` with valid query
2. `GET /api/health` returns healthy status

**Acceptance Criteria**:
- [ ] `POST /api/query-agents` returns correct response
- [ ] `GET /api/health` returns SQLite DB status
- [ ] Error handling returns proper HTTP codes

---

#### Task 14: Update Index Exports
**File**: `src/index.ts` (MODIFY)
**Description**: Update main exports to reflect new architecture

**Implementation**:
1. Remove DocumentStore exports
2. Remove QueryOrchestrator exports
3. Add SQLiteQueryPipeline export
4. Add CLI command exports (if needed)

**Acceptance Criteria**:
- [ ] Build succeeds
- [ ] No broken imports
- [ ] Library consumers can import new classes

---

### Phase 5: Documentation & Cleanup

#### Task 15: Update README
**File**: `README.md` (MODIFY)
**Description**: Update documentation for new workflow

**Implementation**:
1. Update Quick Start section with new CLI commands
2. Update Architecture diagram
3. Remove DocumentStore references
4. Add SQLite database documentation
5. Update API examples

**Acceptance Criteria**:
- [ ] README reflects new CLI workflow
- [ ] Architecture diagram updated
- [ ] API examples work correctly

---

#### Task 16: Add TypeScript Types for SQLite Chunks
**File**: `src/types/index.ts` (MODIFY)
**Description**: Add type definitions for SQLite chunk structures

**Implementation**:
1. Add `SQLiteChunk` interface
2. Add `ChunkSource` type
3. Add `QueryClassification` type
4. Export all new types

**Acceptance Criteria**:
- [ ] Types defined for SQLite chunks
- [ ] Types used consistently across codebase
- [ ] Build succeeds with new types

---

#### Task 17: Add Error Handling for Empty Databases
**File**: `src/query/sqlite-pipeline.ts` (MODIFY)
**Description**: Handle case when no documents have been ingested

**Implementation**:
1. Check if any chunks exist in databases
2. Return helpful error message if empty
3. Suggest running `npm ingest` first

**Acceptance Criteria**:
- [ ] Query on empty DBs returns helpful message
- [ ] No crashes when databases don't exist
- [ ] Suggests ingestion command

---

#### Task 18: Final Integration Test
**File**: Manual testing
**Description**: End-to-end test of complete workflow

**Test Workflow**:
1. Delete all existing databases
2. Run `npm ingest sample.pdf`
3. Run `npm query "What is the main topic?"`
4. Verify answer and sources
5. Test HTTP API endpoint
6. Verify health check

**Acceptance Criteria**:
- [ ] Complete workflow works end-to-end
- [ ] No errors in console
- [ ] Results are accurate
- [ ] User confirms results are acceptable

---

