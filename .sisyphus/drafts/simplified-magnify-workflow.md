# Simplified Magnify Workflow - Planning Draft

## User Requirements Summary

The user wants a simplified PDF ingestion and query system with:

1. **CLI Commands**:
   - `npm ingest <file_path>` - Ingest PDF into 3 SQLite databases
   - `npm query "question"` - Query the ingested documents

2. **Three SQLite Databases**:
   - `fixed_chunks.db` - 10 pages per chunk
   - `heading_chunks.db` - Each heading/subheading = one chunk
   - `toc_chunks.db` - Each TOC entry = one chunk

3. **Ingestion Flow**:
   - PDF → Python extractor → Tables as markdown, images flagged (ignored)
   - Store chunks in all 3 databases in parallel

4. **Query Flow**:
   - Main agent classifies query into extractionType (summary/entities/full/custom)
   - Spawn subagents: 3 per database = 9 parallel at a time
   - Each subagent checks if chunk is relevant to query
   - Relevant chunks returned to main agent
   - Main agent synthesizes answer based on extractionType

5. **Agent Architecture**:
   - Use pi-mono with system-prompt (NOT tools)
   - Main agent + N subagents (N = total chunks across all 3 DBs)

---

## Existing Codebase Analysis

### Already Implemented ✓

| Component | File | Status |
|-----------|------|--------|
| SQLite Database Layer | `src/db/database.ts` | ✓ Complete |
| Fixed/Heading/TOC DB factory | `src/db/database.ts` | ✓ Complete |
| Ingestion Pipeline | `src/ingest/pipeline.ts` | ✓ Complete |
| Python PDF Extractor | `scripts/pdf_extractor.py` | ✓ Complete |
| Table to Markdown | `src/ingest/pipeline.ts` | ✓ Complete |
| pi-mono Agent Setup | `src/query/pi-mono-agent.ts` | ✓ Exists (needs modification) |
| Subagent Relevance Check | `src/query/sub-agent.ts` | ✓ Exists (needs modification) |
| API Routes | `src/api/routes.ts` | ✓ Exists |

### Needs Creation/Modification

| Component | Action | Priority |
|-----------|--------|----------|
| CLI Ingest Command | CREATE `src/cli/ingest.ts` | HIGH |
| CLI Query Command | CREATE `src/cli/query.ts` | HIGH |
| Query Pipeline | MODIFY to read from SQLite DBs | HIGH |
| Subagent Spawning | MODIFY to spawn 3 per DB | HIGH |
| Document Store | REMOVE or deprecate | MEDIUM |
| Query Classification | ADD to main agent flow | HIGH |

---

## Gap Analysis

### Gap 1: CLI Commands Missing
- `package.json` has scripts: `"ingest": "tsx src/cli/ingest.ts"` but file doesn't exist
- Same for query command
- **Action**: Create both CLI entry points

### Gap 2: Query Pipeline Reads Wrong Source
- Current `PiMonoQueryAgent` reads from `DocumentStore` (in-memory)
- User wants it to read from SQLite databases
- **Action**: Modify to query SQLite databases directly

### Gap 3: Subagent Spawning Logic
- Current: Spawns 1 subagent per "group" from DocumentStore
- Required: Spawn subagents by database (3 per DB = 9 parallel)
- **Action**: Restructure spawning logic

### Gap 4: Query Classification
- Current: extractionType passed as parameter
- Required: Main agent should classify query automatically
- **Action**: Add classification step before spawning subagents

---

## Proposed Architecture Changes

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Interface                            │
│   npm ingest <file_path>          npm query "question"          │
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

## Open Questions

1. **Document Store**: Should we remove `src/store/document-store.ts` entirely, or keep it for backward compatibility?

2. **Query Classification**: Should classification happen:
   - a) In main agent (current proposal)
   - b) As a separate LLM call before spawning subagents
   - c) Via keyword matching (no LLM)

3. **Subagent Batch Size**: User specified 3 per DB = 9 parallel. Is this a fixed number or configurable?

4. **API Endpoints**: Should we keep the HTTP API (`/api/query-agents`) or only use CLI?

---

## Draft Tasks

### Phase 1: CLI Implementation
- [ ] Create `src/cli/ingest.ts` - CLI entry for `npm ingest`
- [ ] Create `src/cli/query.ts` - CLI entry for `npm query`
- [ ] Add command-line argument parsing

### Phase 2: Query Pipeline Modification
- [ ] Modify `PiMonoQueryAgent` to read from SQLite databases
- [ ] Add query classification step
- [ ] Restructure subagent spawning (3 per DB = 9 parallel)

### Phase 3: Subagent Logic Update
- [ ] Modify `GroupContextAgent` to work with SQLite chunks
- [ ] Update relevance checking prompt
- [ ] Implement batch processing (9 at a time)

### Phase 4: Testing
- [ ] Test ingestion CLI
- [ ] Test query CLI with different extractionTypes
- [ ] Verify parallel subagent spawning

---

*Draft updated: 2026-04-14*
