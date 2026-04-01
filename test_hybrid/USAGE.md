# Hybrid Search Agent - Usage Guide

This guide explains how to configure and use the Hybrid Search Agent system.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Configuration](#environment-configuration)
3. [Model Configuration](#model-configuration)
4. [Document Upload](#document-upload)
5. [Querying](#querying)
6. [Advanced Configuration](#advanced-configuration)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Install dependencies
cd test_hybrid
npm install

# 2. Create .env file from example
cp .env.example .env

# 3. Edit .env and add your API keys

# 4. Ingest a document
npm run ingest -- ./your-document.pdf

# 5. Ask a question
npm run query -- "What is the main topic?"
```

---

## Environment Configuration

### Required .env File

Create a `.env` file in the `test_hybrid` directory:

```bash
# Copy from example
cp .env.example .env
```

### Key Environment Variables

#### Embedding Model Configuration

```bash
# Embedding provider type
# Options: 'bge-m3' | 'local-bge-m3' | 'openai' | 'mock'
EMBEDDING_PROVIDER=bge-m3

# HuggingFace API key (for BGE-M3 via HuggingFace Inference API)
# Get your key at: https://huggingface.co/settings/tokens
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxx

# OR: Local BGE-M3 server URL (if running locally)
# LOCAL_BGE_M3_URL=http://localhost:8000/embed

# OR: OpenAI configuration (alternative)
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxx
# OPENAI_EMBEDDING_MODEL=text-embedding-3-small
# OPENAI_EMBEDDING_DIMENSIONS=1536
```

#### Synthesis Model Configuration

The synthesis model (for generating answers) is configured via `~/.pi/agent/models.json`:

```bash
# The synthesis model uses pi-mono's ModelRegistry
# Default: 'grid' provider with 'glm-latest' model
# 
# API key is stored in ~/.pi/agent/ directory
GRID_API_KEY=your_grid_api_key
```

#### Data Storage

```bash
# Directory to store indexed documents
DATA_DIR=./data

# Directory for logs
LOG_DIR=./logs
```

---

## Model Configuration

### Embedding Models

#### BGE-M3 (Default, Recommended)

BGE-M3 is a powerful open-source embedding model with 1024 dimensions.

**Via HuggingFace (Cloud):**
```bash
EMBEDDING_PROVIDER=bge-m3
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxx
```

**Running Locally:**

1. Set up a local inference server:
```python
# server.py
from fastapi import FastAPI
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer('BAAI/bge-m3')

@app.post("/embed")
async def embed(request: dict):
    texts = request.get("texts", [])
    embeddings = model.encode(texts)
    return {"embeddings": embeddings.tolist()}

# Run with: uvicorn server:app --host 0.0.0.0 --port 8000
```

2. Configure .env:
```bash
EMBEDDING_PROVIDER=local-bge-m3
LOCAL_BGE_M3_URL=http://localhost:8000/embed
```

#### OpenAI (Alternative)

```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxx
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
```

### Synthesis Model

The synthesis model generates the final answer from retrieved chunks.

**Location:** `~/.pi/agent/models.json`

**Default Configuration:**
```json
{
  "providers": {
    "grid": {
      "models": {
        "glm-latest": {
          "api": "openai-completions",
          "baseUrl": "https://api.grid.ai/v1",
          "contextWindow": 128000
        }
      }
    }
  }
}
```

**To use a different model:**

Edit `src/agent/hybrid-search-agent.ts`:
```typescript
// Change this line:
const model = modelRegistry.find('grid', 'glm-latest');

// To use OpenAI GPT-4:
const model = modelRegistry.find('openai', 'gpt-4o');

// Or Anthropic Claude:
const model = modelRegistry.find('anthropic', 'claude-3-5-sonnet');
```

---

## Document Upload

### CLI Command

```bash
npm run ingest -- <file-path> [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--name <name>` | Document name | File name |
| `--chunk-size <n>` | Chunk size in tokens | 512 |
| `--overlap <n>` | Chunk overlap in tokens | 50 |
| `--provider <type>` | Embedding provider | bge-m3 |
| `--data-dir <dir>` | Data directory | ./data |

### Examples

```bash
# Basic usage
npm run ingest -- ./documents/report.pdf

# With custom name
npm run ingest -- ./documents/report.pdf --name "Annual Report 2024"

# With custom chunking
npm run ingest -- ./documents/report.pdf --chunk-size 256 --overlap 30

# Using OpenAI embeddings
npm run ingest -- ./documents/report.pdf --provider openai

# Custom data directory
npm run ingest -- ./documents/report.pdf --data-dir ./my-data
```

### Supported File Types

- **PDF**: `.pdf` (requires `pdf-parse` package)
- **Text**: `.txt`
- **Markdown**: `.md`
- **Other**: Read as plain text

### Installing PDF Support

```bash
npm install pdf-parse
```

---

## Querying

### CLI Command

```bash
npm run query -- "your question" [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--provider <type>` | Embedding provider | bge-m3 |
| `--data-dir <dir>` | Data directory | ./data |
| `--max-hops <n>` | Maximum multi-hop iterations | 3 |
| `--subagents <n>` | Number of parallel subagents | 4 |
| `--top-k <n>` | Top K results | 50 |
| `--format <type>` | Output format: text \| json | text |

### Examples

```bash
# Basic query
npm run query -- "What is the main topic of the document?"

# With more subagents for complex queries
npm run query -- "Summarize the key findings and recommendations" --subagents 6

# With more hops for multi-step reasoning
npm run query -- "What are the implications of the proposed changes?" --max-hops 5

# JSON output for programmatic use
npm run query -- "Extract all mentioned dates and deadlines" --format json

# Custom data directory
npm run query -- "What is the budget?" --data-dir ./my-data
```

### Output Format

#### Text Format (default)

```
======================================================================
ANSWER
======================================================================

Based on the document, the main topic is...

======================================================================
SOURCES
======================================================================

[1] Document: doc_1234567890_abc123
    Page: 5
    Relevance: 85.3%
    Excerpt: "The primary focus of this report is..."

[2] Document: doc_1234567890_abc123
    Page: 12
    Relevance: 78.1%
    Excerpt: "Key findings indicate that..."

... and 3 more sources

======================================================================
METADATA
======================================================================
Confidence:      82.7%
Total chunks:    156
Relevant chunks: 8
Subagents:       4
Total hops:      6
Processing time: 2341ms
```

#### JSON Format

```json
{
  "answer": "Based on the document, the main topic is...",
  "sources": [
    {
      "chunkId": "chunk_001",
      "documentId": "doc_1234567890_abc123",
      "text": "The primary focus...",
      "pageNumber": 5,
      "relevanceScore": 0.853
    }
  ],
  "confidence": 0.827,
  "metadata": {
    "totalChunks": 156,
    "relevantChunks": 8,
    "subagentCount": 4,
    "totalHops": 6,
    "processingTimeMs": 2341
  }
}
```

---

## Advanced Configuration

### Hybrid Search Parameters

Edit `src/types/index.ts` to modify defaults:

```typescript
export const DEFAULT_HYBRID_SEARCH_CONFIG: HybridSearchConfig = {
  chunkSize: 512,           // Tokens per chunk
  chunkOverlap: 50,         // Token overlap between chunks
  rrfK: 60,                 // RRF constant (typically 60)
  topKCandidates: 50,       // Top K for initial retrieval
  rerankTopK: 20,           // Top K after reranking
  subagentCount: 4,         // Parallel subagents
  maxHops: 3,               // Maximum multi-hop iterations
  tokenBudget: 8000,        // Token budget per subagent
  embeddingModel: 'BAAI/bge-m3',
  embeddingDimensions: 1024,
  bm25K1: 1.5,              // BM25 k1 parameter
  bm25B: 0.75,              // BM25 b parameter
};
```

### Environment Variable Overrides

```bash
# In .env
SUBAGENT_COUNT=6
MAX_HOPS=5
CHUNK_SIZE=256
CHUNK_OVERLAP=30
RRF_K=60
TOP_K_CANDIDATES=100
```

### Reranking Configuration

```bash
# Reranker type: 'simple' | 'llm' | 'cohere'
RERANKER_TYPE=simple

# For Cohere reranking
COHERE_API_KEY=your_cohere_api_key
```

---

## Troubleshooting

### Common Issues

#### 1. "No indexed documents found"

**Solution:** Run ingest first:
```bash
npm run ingest -- ./your-document.pdf
```

#### 2. "Grid model not found"

**Solution:** Ensure `~/.pi/agent/models.json` exists and contains the grid provider:
```bash
mkdir -p ~/.pi/agent
# Add your models.json configuration
```

#### 3. "API key not found"

**Solution:** Add the required API key to your `.env` file:
```bash
# For HuggingFace/BGE-M3
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxx

# For OpenAI
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxx
```

#### 4. "PDF parsing error"

**Solution:** Install pdf-parse:
```bash
npm install pdf-parse
```

#### 5. "Embedding dimension mismatch"

**Solution:** Ensure the embedding dimensions match the provider:
- BGE-M3: 1024 dimensions
- OpenAI text-embedding-3-small: 1536 dimensions

Clear your data directory and re-ingest if you change embedding models:
```bash
rm -rf ./data
npm run ingest -- ./your-document.pdf
```

### Performance Tips

1. **Use local BGE-M3** for faster embeddings (no API latency)
2. **Increase subagent count** for complex queries
3. **Decrease chunk size** for more granular retrieval
4. **Use mock embeddings** for testing without API costs

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Ingestion                            │
│  PDF/TXT/MD → Chunking (512 tokens) → Dual Indexing            │
│                                     ↓                            │
│                          ┌─────────────────┐                    │
│                          │  Dense Index    │ (BGE-M3, 1024 dim) │
│                          └─────────────────┘                    │
│                          ┌─────────────────┐                    │
│                          │  BM25 Index     │ (Sparse, keywords) │
│                          └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       Query Processing                           │
│                                                                  │
│  Query → Spawn 4 Subagents (parallel)                           │
│          │                                                       │
│          ├── Subagent 1 ──┐                                      │
│          ├── Subagent 2 ──┼── Observe-Reason-Act Loop           │
│          ├── Subagent 3 ──┤    • Decompose query                │
│          └── Subagent 4 ──┘    • Hybrid Search (Dense + BM25)   │
│                               • RRF Fusion                      │
│                               • Reranking                       │
│                               • Multi-hop if needed             │
│                                     ↓                            │
│                          Master RRF Fusion                      │
│                                     ↓                            │
│                          Synthesis (LLM)                        │
│                                     ↓                            │
│                              Answer                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Programmatic Usage

```typescript
import { createHybridSearchAgent } from './agent/hybrid-search-agent.js';
import { createHybridIndexer } from './indexing/hybrid-index.js';
import { createEmbeddingProvider } from './indexing/dense-index.js';

// Create embedding provider
const embeddingProvider = createEmbeddingProvider({
  type: 'bge-m3',
  apiKey: process.env.HUGGINGFACE_API_KEY,
});

// Create indexer
const indexer = createHybridIndexer({}, embeddingProvider);

// Create agent
const agent = createHybridSearchAgent(indexer);

// Index document
const result = await agent.indexDocument(text, { fileName: 'doc.pdf' });
console.log(`Indexed ${result.chunkCount} chunks`);

// Query
const response = await agent.query({
  query: 'What is the main topic?',
  options: {
    maxHops: 3,
    subagentCount: 4,
  },
});

console.log(response.answer);
console.log(response.sources);
```

---

## Support

For issues or questions, please refer to the main README.md or check the source code documentation.