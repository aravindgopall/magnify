# Magnify + Pi-Mono Integration

Complete integration guide for using Magnify's PDF processing with Pi-Mono's multi-agent system.

## Overview

This integration enables:
1. **PDF Upload & Processing** - Upload PDFs to Magnify server, which uses `pdf_extractor.py` to extract and store content with 3 grouping strategies (TOC, heading-based, fixed page ranges)
2. **Persistent Storage** - Documents stored on Magnify server for reuse across queries
3. **Multi-Agent Pipeline** - Pi-Mono spawns specialized agents (Rewriter, Explorer, Reader) to intelligently query documents
4. **Web UI Support** - Pi-Mono web-ui provides chat interface for document queries

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Query                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Pi-Mono Web UI / CLI                            │
│  (Uses magnify extension + agents)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   4-Step Agent Pipeline      │
        │                              │
        │  1. Rewriter Agent           │
        │     └─> Creates queries      │
        │                              │
        │  2. Explorer Agent           │
        │     └─> Finds sections       │
        │                              │
        │  3. Reader Agent             │
        │     └─> Extracts content     │
        │                              │
        │  4. Main Agent               │
        │     └─> Synthesizes answer   │
        └──────────────┬───────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Magnify Server (localhost:3000)                 │
│                                                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Document Store (Persistent)                       │     │
│  │  - Stores PDFs with all grouping strategies        │     │
│  │  - TOC-based groups                                │     │
│  │  - Heading-based groups                            │     │
│  │  - Fixed page range groups                         │     │
│  └────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │  PDF Extractor (pdf_extractor.py)                  │     │
│  │  - Uses PyMuPDF + Camelot + OCR                    │     │
│  │  - Handles digital, scanned, hybrid PDFs           │     │
│  │  - Extracts text, tables, images                   │     │
│  └────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Query Orchestrator                                │     │
│  │  - Semantic search                                 │     │
│  │  - LLM-powered extraction                          │     │
│  │  - Multi-group synthesis                           │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Install Python Dependencies

```bash
cd /Users/telkar.varasree/my-project/magnify/magnify/scripts
pip install -r requirements.txt
```

This installs:
- PyMuPDF (fitz) - PDF parsing
- camelot-py - Table extraction
- pdfplumber - Alternative table extraction
- pdf2image - PDF to image conversion
- pytesseract - OCR for scanned PDFs

### 2. Install Pi-Mono Extension

```bash
cd /Users/telkar.varasree/my-project/magnify/magnify
chmod +x scripts/install-pi-extension.sh
./scripts/install-pi-extension.sh
```

This creates symlinks:
- `~/.pi/agent/extensions/magnify/index.ts` - Extension entry point
- `~/.pi/agent/agents/rewriter.md` - Query rewriter agent
- `~/.pi/agent/agents/explorer.md` - Section finder agent
- `~/.pi/agent/agents/reader.md` - Content extractor agent
- `~/.pi/agent/agents/main-agent.md` - Synthesizer agent

### 3. Start Magnify Server

```bash
cd /Users/telkar.varasree/my-project/magnify/magnify

# Option 1: Development mode
npm run dev

# Option 2: With specific LLM
export LLM_PROVIDER=openai
export OPENAI_API_KEY=your-key-here
npm run dev

# Option 3: With LiteLLM
export LLM_PROVIDER=litellm
export LITE_LLM_API_KEY=your-key
export LITE_LLM_MODEL=gpt-4
export LITE_LLM_URL=http://localhost:8000
npm run dev
```

Server starts at `http://localhost:3000`

### 4. Verify Installation

```bash
# Check server
curl http://localhost:3000

# List available agents
ls ~/.pi/agent/agents/

# Check extension
ls ~/.pi/agent/extensions/magnify/
```

## Usage

### Upload Documents

#### Using Python Script

```bash
# Upload a PDF
python scripts/upload_document.py /path/to/document.pdf

# List all uploaded documents
python scripts/upload_document.py --list
```

#### Using Pi-Mono

```bash
pi "Upload the PDF at /path/to/document.pdf using magnify_upload_document"
```

#### Using API Directly

```bash
curl -X POST http://localhost:3000/api/documents/upload \
  -H "Content-Type: application/json" \
  -d '{
    "source": "/path/to/document.pdf",
    "fileName": "My Document",
    "groupingStrategy": "hybrid"
  }'
```

The upload process:
1. Calls `pdf_extractor.py` to process the PDF
2. Extracts content with all 3 grouping strategies:
   - **TOC** - Based on document table of contents
   - **Heading** - Based on detected headings (bold/large text)
   - **Range** - Fixed page ranges (default: 10 pages per group)
3. Stores in Magnify's persistent storage
4. Returns document ID and group information

### Query Documents

#### Using Pi-Mono CLI

```bash
# Simple query
pi "Query the uploaded document: What is the authorization process?"

# Specific document
pi "Use magnify_query to ask: How do I handle errors? Use document abc-123"
```

#### Using Pi-Mono Web UI

1. Start the web UI (from pi-mono repo):
```bash
cd /Users/telkar.varasree/my-project/pi-mono/packages/web-ui
npm run dev
```

2. Open browser to `http://localhost:5173`

3. In the chat interface:
```
Upload document.pdf using magnify
```

Then query:
```
What is the main topic of the document?
```

#### Using API Directly

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "your-doc-id",
    "query": "What is the authorization process?",
    "extractionType": "full"
  }'
```

### Multi-Agent Pipeline Execution

When you query via Pi-Mono, this happens automatically:

**Step 1: Rewriter Agent**
- Takes your raw query
- Creates `explorer_query` (3-7 keywords for section matching)
- Creates `reader_query` (detailed extraction instructions)

**Step 2: Explorer Agent**
- Fetches all document groups from Magnify
- Matches groups against `explorer_query`
- Ranks by relevance score
- Returns top 5 matching sections

**Step 3: Reader Agent**
- Calls Magnify query API with matched groups
- Receives extracted content (text, tables, images)
- Synthesizes information from multiple groups

**Step 4: Main Agent**
- Takes reader results
- Formats comprehensive answer
- Cites sources with page numbers
- Includes tables and key entities
- Notes any information gaps

## Available Tools

### magnify_upload_document

Upload a PDF document to the Magnify server.

**Parameters:**
- `pdfPath` (required) - Absolute path to PDF file
- `fileName` (optional) - Display name for the document

**Example:**
```typescript
magnify_upload_document({
  pdfPath: "/Users/me/docs/manual.pdf",
  fileName: "Authorization Manual"
})
```

### magnify_list_documents

List all documents stored on the Magnify server.

**Example:**
```typescript
magnify_list_documents({})
```

### magnify_query

Query PDF documents using the multi-agent pipeline.

**Parameters:**
- `query` (required) - Your question about the document
- `documentId` (optional) - Specific document to query (uses first if omitted)

**Example:**
```typescript
magnify_query({
  query: "What is the SI registration authorization process?",
  documentId: "abc-123"
})
```

## API Endpoints

### Document Management

```
POST /api/documents/upload
  - Upload and process a PDF
  - Body: { source, fileName, groupingStrategy }
  - Returns: { documentId, metadata, groups }

GET /api/documents
  - List all documents
  - Returns: { documents: [...] }

GET /api/documents/:id
  - Get document details
  - Returns: { documentId, metadata, groups, toc }

GET /api/documents/:id/groups
  - Get all groups for a document
  - Returns: { groups: [...] }

DELETE /api/documents/:id
  - Delete a document
```

### Query

```
POST /api/query
  - Query any document
  - Body: { documentId, query, groupIds?, extractionType? }
  - Returns: { answer, sources, tables, entities, confidence }

POST /api/documents/:id/query
  - Query specific document
  - Body: { query, groupIds?, extractionType? }
```

### Agent Endpoints (for Pi-Mono)

```
POST /api/agents/rewriter
  - Rewrite query into explorer and reader versions
  - Body: { task, outputSchema? }

POST /api/agents/explorer
  - Find relevant document sections
  - Body: { context: { documentId, explorer_query } }

POST /api/agents/reader
  - Extract detailed content
  - Body: { context: { documentId, groupIds, reader_query } }
```

## Configuration

### Environment Variables

```bash
# Magnify Server
PORT=3000
HOST=0.0.0.0

# LLM Configuration
LLM_PROVIDER=openai|litellm|mock
OPENAI_API_KEY=your-key
LLM_MODEL=gpt-4

# LiteLLM Configuration
LITE_LLM_API_KEY=your-key
LITE_LLM_MODEL=gpt-4
LITE_LLM_URL=http://localhost:8000

# Pi-Mono Extension
MAGNIFY_URL=http://localhost:3000
```

### Data Storage

Documents are stored in: `/Users/telkar.varasree/my-project/magnify/magnify/data/`

Structure:
```
data/
├── <doc-id-1>.json         # Document metadata and groups
├── <doc-id-2>.json
└── images/                 # Extracted images
    ├── <doc-id>_p1_i0.png
    └── ...
```

## Example Workflow

### Complete Example: Analyzing a Technical Manual

```bash
# 1. Start Magnify server
cd /Users/telkar.varasree/my-project/magnify/magnify
npm run dev

# 2. Upload the manual
python scripts/upload_document.py ~/Downloads/auth-manual.pdf

# Output:
# ✅ Upload successful!
# 📊 Document ID: a1b2c3d4-...
# 📖 Pages: 150
# 📚 Groups: 25
# 
# Group Breakdown:
#   - toc: 8 groups
#   - heading: 12 groups
#   - range: 15 groups

# 3. Query using Pi-Mono
pi "What is the authorization flow for SI transactions?"

# The multi-agent pipeline executes:
# 
# [Rewriter] → explorer: "SI Authorization Flow"
#              reader: "Explain complete SI authorization flow with steps"
# 
# [Explorer] → Found 2 relevant sections:
#              • "SI Registration and Authorization" (pages 45-62, score: 0.95)
#              • "Transaction Flow" (pages 88-102, score: 0.72)
# 
# [Reader] → Extracted content from both sections
#            Found 3 tables, 2 diagrams, 15 key terms
# 
# [Main Agent] → Synthesizes comprehensive answer with citations

# 4. Get another insight
pi "What error codes are related to declined transactions?"

# Pipeline executes again, this time finding:
# • "Error Codes Reference" section
# • "Decline Reasons" section
```

## Troubleshooting

### PDF Upload Fails

**Problem:** Upload returns error or times out

**Solutions:**
1. Check Python dependencies:
   ```bash
   pip install -r scripts/requirements.txt
   ```

2. Verify pdf_extractor.py works:
   ```bash
   python scripts/pdf_extractor.py /path/to/test.pdf
   ```

3. Check file permissions and path

4. For large PDFs, increase timeout in upload script

### No Groups Found

**Problem:** Document uploaded but Explorer finds no matches

**Solutions:**
1. Check if document has TOC:
   ```bash
   curl http://localhost:3000/api/documents/<doc-id>
   ```

2. Try broader keywords in query

3. Use heading-based or range groups explicitly

### Agent Not Found

**Problem:** Pi-Mono can't find rewriter/explorer/reader agents

**Solutions:**
1. Re-run installation:
   ```bash
   ./scripts/install-pi-extension.sh
   ```

2. Verify symlinks:
   ```bash
   ls -la ~/.pi/agent/agents/
   ls -la ~/.pi/agent/extensions/magnify/
   ```

3. Check Pi-Mono is using correct agent directory

### Low Confidence Answers

**Problem:** Reader returns low confidence scores

**Solutions:**
1. Refine your query to be more specific

2. Check if relevant sections were found by Explorer

3. Try uploading higher quality PDF (not scanned if possible)

4. Increase number of matched groups in Explorer

## Advanced Features

### Custom Grouping Strategies

Modify the grouping strategy in upload:

```typescript
magnify_upload_document({
  pdfPath: "/path/to/doc.pdf",
  groupingStrategy: "toc"  // or "heading" or "range"
})
```

### Multiple Document Queries

Query across multiple documents:

```bash
# Upload multiple docs
pi "Upload doc1.pdf and doc2.pdf"

# Query both
pi "Compare the authorization processes in the uploaded documents"
```

### Streaming Responses

For real-time feedback, use Pi-Mono's streaming mode with the web UI. You'll see:
- Rewriter progress
- Explorer matches in real-time
- Reader extraction updates
- Final answer as it's synthesized

## Performance Tips

1. **Use TOC-based groups** when available - most accurate section matching
2. **Upload once, query many** - leverage persistent storage
3. **Specific queries** get better results than broad questions
4. **Page hints** help: "What is on page 45?" matches range groups directly
5. **Digital PDFs** process faster than scanned (no OCR needed)

## Next Steps

- Explore the agents in `~/.pi/agent/agents/` to understand their prompts
- Customize agent behavior by editing the `.md` files
- Add more documents to build a knowledge base
- Use Pi-Mono's chat history for context across queries
- Integrate with other Pi-Mono extensions

## Support

- Magnify issues: Check the magnify server logs
- Pi-Mono issues: Check `~/.pi/agent/logs/`
- Extension issues: Review agent execution logs in Pi-Mono
- PDF extraction issues: Test with `pdf_extractor.py` directly

## License

See individual project licenses:
- Magnify: Check magnify/LICENSE
- Pi-Mono: Check pi-mono/LICENSE
