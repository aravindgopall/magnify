# Quick Start Guide - Magnify + Pi-Mono Integration

Get started with PDF document querying using multi-agent pipeline in under 5 minutes.

## Prerequisites

- Node.js 18+ and npm
- Python 3.8+
- Magnify server running
- Pi-Mono installed

## Step-by-Step Setup

### 1. Install Python Dependencies (2 min)

```bash
cd /Users/telkar.varasree/my-project/magnify/magnify/scripts
pip install -r requirements.txt
```

### 2. Install Pi-Mono Extension (30 sec)

```bash
cd /Users/telkar.varasree/my-project/magnify/magnify
./scripts/install-pi-extension.sh
```

### 3. Start Magnify Server (30 sec)

```bash
cd /Users/telkar.varasree/my-project/magnify/magnify
npm run dev
```

You should see:
```
Magnify PDF Scraper API running at http://0.0.0.0:3000
LLM Provider: mock
```

### 4. Upload a Test Document (1 min)

```bash
# Use any PDF you have
python scripts/upload_document.py ~/Downloads/your-document.pdf
```

You'll see:
```
📄 Uploading: your-document.pdf
🌐 Server: http://localhost:3000
✅ Upload successful!
📊 Document ID: abc-123-def
📖 Pages: 50
📚 Groups: 12

Group Breakdown:
  - toc: 4 groups
  - heading: 5 groups
  - range: 5 groups
```

Copy the Document ID for the next step.

### 5. Query Your Document (1 min)

Using Pi-Mono CLI:

```bash
# Method 1: Let it auto-select first document
pi "Use magnify_query to ask: What is the main topic of this document?"

# Method 2: Specify the document ID
pi "Use magnify_query with documentId abc-123-def to ask: What are the key sections?"
```

Or use Pi-Mono Web UI:

```bash
# Start web UI (in a new terminal)
cd /Users/telkar.varasree/my-project/pi-mono/packages/web-ui
npm run dev
```

Then open http://localhost:5173 and type:
```
Query the Magnify document: What is this document about?
```

## What Just Happened?

When you queried the document, Pi-Mono executed a 4-step multi-agent pipeline:

1. **Rewriter Agent** transformed your question into:
   - `explorer_query`: "Main Topic" (keywords)
   - `reader_query`: "Explain the main topic of this document in detail"

2. **Explorer Agent**:
   - Fetched all 12 groups from Magnify
   - Matched against "Main Topic"
   - Found 2 relevant sections with high scores

3. **Reader Agent**:
   - Queried Magnify API for those 2 sections
   - Extracted content, tables, images
   - Synthesized information

4. **Main Agent**:
   - Formatted the final answer
   - Added source citations
   - Included confidence score

## Next Steps

### Try More Queries

```bash
# Tables and structured data
pi "What tables are in the document?"

# Specific sections
pi "Tell me about the authorization process"

# Error handling
pi "How do I handle timeout errors?"

# Process flows
pi "Explain the transaction flow step by step"
```

### Upload More Documents

```bash
# Upload another document
python scripts/upload_document.py ~/docs/api-guide.pdf

# List all documents
python scripts/upload_document.py --list
```

### Use Direct API

```bash
# List documents
curl http://localhost:3000/api/documents

# Query directly
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "abc-123-def",
    "query": "What is the authorization process?"
  }'
```

## Common Issues

### "Command not found: pi"

Install pi-mono CLI:
```bash
cd /Users/telkar.varasree/my-project/pi-mono
npm run build
npm link
```

### "Module not found: fitz"

Install Python dependencies:
```bash
pip install pymupdf camelot-py pdfplumber pdf2image pytesseract
```

### "Connection refused"

Make sure Magnify server is running:
```bash
cd /Users/telkar.varasree/my-project/magnify/magnify
npm run dev
```

### "No documents found"

Upload a document first:
```bash
python scripts/upload_document.py /path/to/document.pdf
```

## Configuration

### Use Real LLM (OpenAI)

```bash
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-your-key-here
export LLM_MODEL=gpt-4
npm run dev
```

### Change Magnify Port

```bash
export PORT=8080
npm run dev
```

Then update Pi-Mono extension:
```bash
export MAGNIFY_URL=http://localhost:8080
```

## Help & Documentation

- Full documentation: [README.md](./README.md)
- Agent definitions: `~/.pi/agent/agents/`
- Magnify API: http://localhost:3000
- Pi-Mono docs: `/Users/telkar.varasree/my-project/pi-mono/README.md`

## Example Session

Here's a complete example session:

```bash
# Terminal 1: Start Magnify
cd /Users/telkar.varasree/my-project/magnify/magnify
npm run dev

# Terminal 2: Upload & Query
cd /Users/telkar.varasree/my-project/magnify/magnify

# Upload
python scripts/upload_document.py ~/Downloads/authorization-guide.pdf
# Output: Document ID: abc-123

# Query 1
pi "What is the authorization process?"
# Output: [Detailed answer with sources and page numbers]

# Query 2
pi "What error codes are related to declined transactions?"
# Output: [Table of error codes with descriptions]

# Query 3
pi "How do I configure timeout settings?"
# Output: [Configuration guide with citations]
```

That's it! You're now querying PDFs with a multi-agent AI system. 🚀
