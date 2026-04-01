# Hybrid Search System

A multi-hop retrieval system with parallel subagents, implementing the architecture from research on agentic document retrieval.

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **Python** >= 3.9 (optional, for local BGE-M3 embeddings)

### Installation

#### 1. Clone and Install Node.js Dependencies

```bash
cd test_hybrid
npm install
```

This creates:
- `node_modules/` - Node.js dependencies
- `dist/` - Compiled TypeScript (after `npm run build`)

#### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
```env
# For Grid LLM (synthesis)
GRID_API_KEY=your_grid_api_key

# For local BGE-M3 embeddings (optional)
LOCAL_BGE_M3_URL=http://localhost:8000/embed
```

#### 3. (Optional) Set Up Local BGE-M3 Embedding Server

For faster embeddings without API calls:

```bash
# Install Python dependencies
pip install -r requirements.txt

# Start the embedding server
python3 scripts/embedding_server.py
```

The server will run on `http://localhost:8000`

### Usage

#### Ingest a Document

```bash
# Using local BGE-M3 (recommended if server is running)
npm run ingest -- "/path/to/document.pdf" --provider local-bge-m3

# Using BM25 only (no embeddings needed)
npm run ingest -- "/path/to/document.pdf" --provider bm25-only
```

#### Query the Document

```bash
# Using local BGE-M3
npm run query -- "What is the main topic?" --provider local-bge-m3

# Using BM25 only
npm run query -- "What is the main topic?" --provider bm25-only

# With options
npm run query -- "Summarize the key findings" --provider local-bge-m3 --max-hops 5 --format json
```

#### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--provider` | Embedding provider: `local-bge-m3`, `bm25-only`, `mock` | `bm25-only` |
| `--max-hops` | Maximum multi-hop iterations | 3 |
| `--subagents` | Number of parallel subagents | 4 |
| `--top-k` | Top K results | 50 |
| `--format` | Output format: `text`, `json` | `text` |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Ingestion                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Chunking (512 tokens) → Dense Index + BM25 Index       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Query Processing                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │            Spawn 4 Parallel Subagents                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         ▼                    ▼                    ▼            │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐     │
│  │  Subagent 1 │      │  Subagent 2 │ ...  │  Subagent 4 │     │
│  │             │      │             │      │             │     │
│  │ Observe-    │      │ Observe-    │      │ Observe-    │     │
│  │ Reason-Act  │      │ Reason-Act  │      │ Reason-Act  │     │
│  │    Loop     │      │    Loop     │      │    Loop     │     │
│  └─────────────┘      └─────────────┘      └─────────────┘     │
│         │                    │                    │            │
│         └────────────────────┼────────────────────┘            │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Master RRF Fusion                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Main Agent Synthesis                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │     Generate Final Answer with Citations                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Document Ingestion & Indexing

- **Granular Chunking**: Documents are split into ~512 token chunks to prevent "vector dilution"
- **Dual Indexing**: Each chunk is stored as:
  - Dense vector embedding (for semantic search)
  - BM25 sparse index (for keyword matching)

### 2. Query Processing

- **Parallel Subagents**: 4 subagents process the query independently in an "embarrassingly parallel" fashion
- **Observe-Reason-Act Loop**: Each subagent:
  1. Decomposes the query
  2. Executes hybrid search (dense + BM25)
  3. Applies RRF fusion internally
  4. Reranks results with cross-encoder
  5. Reads and evaluates chunks
  6. Prunes irrelevant chunks
  7. Decides whether to hop (search again) or terminate

### 3. RRF Fusion

Reciprocal Rank Fusion formula: `score = Σ 1/(k + rank)` where k=60

This bubbles up chunks that rank highly on both semantic and keyword lists.

### 4. Master RRF Fusion

After all subagents complete, their curated results are combined using Master RRF:
- Chunks found by multiple subagents get higher scores
- Produces a single, deduplicated ranked list

### 5. Main Agent Synthesis

The final ranked list is passed to the Main Agent (LLM) to generate a comprehensive answer with citations.

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `chunkSize` | 512 | Target tokens per chunk |
| `chunkOverlap` | 50 | Token overlap between chunks |
| `rrfK` | 60 | RRF constant for fusion |
| `topKCandidates` | 50 | Top K candidates for reranking |
| `rerankTopK` | 20 | Top K after reranking |
| `subagentCount` | 4 | Number of parallel subagents |
| `maxHops` | 3 | Maximum multi-hop iterations |
| `tokenBudget` | 8000 | Token budget per subagent |
| `embeddingModel` | BAAI/bge-m3 | Embedding model name |
| `embeddingDimensions` | 1024 | Embedding vector dimensions |
| `bm25K1` | 1.5 | BM25 k1 parameter |
| `bm25B` | 0.75 | BM25 b parameter |

## File Structure

```
test_hybrid/
├── src/
│   ├── agent/              # Agent implementations
│   │   ├── hybrid-search-agent.ts
│   │   └── retrieval-subagent.ts
│   ├── cli/                # CLI commands
│   │   ├── ingest.ts
│   │   └── query.ts
│   ├── indexing/           # Indexing components
│   │   ├── bm25-index.ts
│   │   ├── chunker.ts
│   │   ├── dense-index.ts
│   │   └── hybrid-index.ts
│   ├── logger/             # Session logging
│   ├── search/             # Reranking
│   ├── store/              # Persistence
│   └── types/              # TypeScript types
├── scripts/
│   └── embedding_server.py # Local BGE-M3 server
├── data/                   # Indexed documents (gitignored)
├── logs/                   # Session logs (gitignored)
├── package.json
├── requirements.txt        # Python dependencies
├── tsconfig.json
├── .env.example
└── README.md
```

## How `dist/` and `node_modules/` are Created

- **`node_modules/`**: Created by `npm install` - contains all Node.js dependencies
- **`dist/`**: Created by `npm run build` (runs `tsc`) - contains compiled TypeScript JavaScript files

Both directories are gitignored and should not be committed.

## Dependencies

### Node.js (package.json)
- `@mariozechner/pi-agent-core`: Agent framework
- `@mariozechner/pi-ai`: AI model interfaces
- `@mariozechner/pi-coding-agent`: Coding agent utilities
- `natural`: NLP utilities for BM25
- `pdf-parse`: PDF parsing
- `uuid`: Unique IDs
- `zod`: Schema validation

### Python (requirements.txt)
- `fastapi`: Web framework for embedding server
- `uvicorn`: ASGI server
- `sentence-transformers`: BGE-M3 embedding model
- `torch`: PyTorch backend

## License

MIT