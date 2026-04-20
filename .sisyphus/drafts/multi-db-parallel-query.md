# Draft: Enhanced Parallel Query Pipeline

## Goal
Enhance Magnify's query pipeline with per-chunk parallel relevance checking across all 3 SQLite databases, using in-process Agent class with 2-pass batch-summarize synthesis.

## Final Architecture

### Pass 1: Relevance Check (Per-Chunk Parallel)
- Load ALL chunks from 3 SQLite databases (fixed, heading, toc)
- Spawn one Agent per chunk (using @mariozechner/pi-agent-core Agent class)
- Cap concurrency at 9 parallel agents
- Each agent returns: relevant (with context) or NOT_RELEVANT
- Results stored in intermediate file (data/query-results/)

### Pass 2: Batch Summarize (Iterative)
- Collect all relevant chunks from Pass 1
- Group into batches (e.g., 5-10 chunks per batch)
- Summarize each batch via LLM
- Merge all batch summaries into final answer via main LLM call

## User Decisions (ALL confirmed)
1. ✅ Per-chunk parallelism — every chunk gets its own parallel LLM call (capped at 9)
2. ✅ In-process Agent class from @mariozechner/pi-agent-core (NOT OS-level processes)
3. ✅ 9 parallel agents concurrency cap
4. ✅ All 3 databases queried in parallel
5. ✅ Results stored in files (intermediate)
6. ✅ 2-pass synthesis: relevance check → batch summarize → merge
7. ✅ New endpoint alongside existing SQLiteQueryPipeline
8. ✅ Keep existing ingest pipeline (no changes)
9. ✅ Large documents (90+ chunks typical)
10. ✅ Chunk data accessible via existing SQLite databases / grid endpoint

## Key Changes from Current SQLiteQueryPipeline
1. processChunkBatch: chunks processed SEQUENTIALLY → ALL chunks in PARALLEL
2. Synthesis: per-DB→cross-DB → batch-summarize→merge
3. Result storage: in-memory → file-based intermediate results
4. New API endpoint (e.g., /api/query-parallel)
5. Agent reuse optimization (current creates new Agent per chunk — can be optimized)

## Existing Code to Reuse
- SQLiteQueryPipeline.loadAllChunks() — already loads from 3 DBs
- SQLiteQueryPipeline.buildSubAgentSystemPrompt() — relevance check prompts
- SQLiteQueryPipeline.buildAnalysisPrompt() — per-chunk analysis prompts
- getDatabase() factory from src/db/database.ts
- Agent class from @mariozechner/pi-agent-core
- QueryLogger for observability
