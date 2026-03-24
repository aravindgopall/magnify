# Magnify Query Approaches

Two ways to query PDFs: **Native Magnify** (fast, direct) vs **Pi-Mono Multi-Agent** (intelligent, research-style).

---

## Quick Comparison

| Feature | Native Magnify | Pi-Mono Multi-Agent |
|---------|---------------|---------------------|
| **Endpoint** | `POST /api/query` | `POST /api/query-agents` |
| **Speed** | Fast (~2-5s) | Slower (~30-60s) |
| **Intelligence** | Direct LLM call | 3-agent pipeline |
| **Best For** | Simple extraction | Complex research |
| **Group Selection** | Manual or keyword | Auto-intelligent matching |

---

## 1. Native Magnify Approach

### Files Involved
```
src/
├── api/
│   ├── routes.ts              # POST /api/query endpoint
│   └── server.ts              # Express server setup
├── orchestrator/
│   └── index.ts               # Query orchestration logic
├── llm/
│   └── client.ts              # Direct LLM calls
└── store/
    └── index.ts               # Document storage
```

### How It Works
1. Receives query + documentId (or groupIds)
2. Retrieves document content directly
3. Sends to LLM with extracted text
4. Returns answer immediately

### Usage
```bash
# Query entire document
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "abc-123",
    "query": "What is the authorization process?",
    "extractionType": "summary"
  }'

# Query specific groups
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "abc-123",
    "groupIds": ["group-456", "group-789"],
    "query": "Extract error codes",
    "extractionType": "full"
  }'
```

**extractionType:**
- `summary` - Concise answer (default)
- `full` - Detailed extraction with quotes

---

## 2. Pi-Mono Multi-Agent Approach

### Files Involved
```
src/
├── api/
│   └── pi-mono-routes.ts      # POST /api/query-agents endpoint
agents/
├── explorer.md                # Agent: Find relevant groups
└── reader.md                  # Agent: Extract content
logs/
└── pi-sessions/               # Agent execution logs (JSON)
```

### How It Works (3-Agent Pipeline)
```
Query → Explorer Agent → Reader Agent → Final Answer
          (find groups)    (extract info)
```

1. **Explorer**: Matches query to relevant document groups
2. **Reader**: Extracts detailed content from matched groups
3. Returns structured answer with sources

### Usage
```bash
curl -X POST http://localhost:3000/api/query-agents \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "abc-123",
    "query": "explain all projects",
    "extractionType": "summary"
  }'
```

### Session Logs
Every query creates a detailed log:
```bash
ls -lt logs/pi-sessions/ | head -5

# View session
jq '.' logs/pi-sessions/1774333899781-0bfj00bcl.json

# Check agents
jq '.agents[] | {name: .agentName, duration: .duration}' logs/pi-sessions/*.json
```

---

## Upload Approaches

### upload_document.py (Standard)

**When to use:** Most documents, need comprehensive grouping

```bash
# Full extraction with all grouping strategies
python3 scripts/upload_document.py "/path/to/document.pdf"
```

**Features:**
- Uses hybrid grouping (TOC + headings + fixed ranges)
- Parallel page processing
- OCR for scanned PDFs
- Comprehensive metadata extraction

**Files:**
- `scripts/upload_document.py` - Upload script
- `scripts/pdf_extractor.py` - PDF processing engine
- `src/grouping/` - Grouping strategies (toc, heading, fixed)

**Time:** ~30-90s for 100-page PDF

---

### fast_upload.py (Speed Optimized)

**When to use:** Large PDFs (>200 pages), testing, speed priority

```bash
# Fast upload - skips OCR, simple grouping
python3 scripts/fast_upload.py "/path/to/large-document.pdf"
```

**Optimizations:**
- `skipOCR: true` - No optical character recognition
- `groupingStrategy: "fixed"` - Simple page ranges only
- `parallelPages: true` - Parallel processing
- No table detection

**Files:**
- `scripts/fast_upload.py` - Fast upload script
- Uses same `pdf_extractor.py` but with minimal options

**Time:** ~10-20s for 100-page PDF (3-5x faster)

---

## Decision Matrix

### Choose Native Magnify when:
- ✅ You know which groups to query
- ✅ Need fast responses (<5s)
- ✅ Simple extraction tasks
- ✅ Real-time applications

### Choose Pi-Mono when:
- ✅ Research-style complex queries
- ✅ Don't know which sections to search
- ✅ Need intelligent group discovery
- ✅ Want detailed execution logs

### Choose upload_document.py when:
- ✅ Important documents needing full analysis
- ✅ Documents with complex structure (chapters, TOC)
- ✅ Need all grouping strategies
- ✅ Scanned PDFs requiring OCR

### Choose fast_upload.py when:
- ✅ Large documents (>200 pages)
- ✅ Testing/development workflows
- ✅ Clean PDFs (not scans)
- ✅ Speed is priority over comprehensiveness

---

## Environment Setup

```bash
# Set custom Magnify URL (default: http://localhost:3000)
export MAGNIFY_URL="http://localhost:3000"

# Start server
npm start

# Check status
curl http://localhost:3000/api/documents

# View logs
tail -f logs/pi-sessions/*.json
```

---

## Examples

### Standard Upload + Native Query
```bash
# 1. Upload with full grouping
python3 scripts/upload_document.py "resume.pdf"
# Output: documentId: "abc-123"

# 2. Query directly
curl -X POST http://localhost:3000/api/query \
  -d '{"documentId":"abc-123","query":"list skills"}'
```

### Fast Upload + Multi-Agent Query
```bash
# 1. Fast upload large PDF
python3 scripts/fast_upload.py "manual-500pages.pdf"
# Output: documentId: "xyz-789"

# 2. Intelligent query (finds relevant sections automatically)
curl -X POST http://localhost:3000/api/query-agents \
  -d '{"documentId":"xyz-789","query":"explain error handling"}'
```

---

## Known Issues

### Pi-Mono Multi-Agent
⚠️ **Current Status:** Pi-mono tools have implementation bugs
- Explorer agent: ✅ Working (returns actual group IDs)
- Reader agent: ❌ Tool errors (`magnify_query` tool has bugs)
- Workaround: Use **Native Magnify** approach instead

**Error:** `Cannot read properties of undefined (reading 'toLowerCase')`

The agents correctly call tools (no longer returning fake examples), but the tool implementations in pi-mono have bugs that need fixing in the pi-mono codebase.

---

## Troubleshooting

**Pi-Mono agents not working?**
```bash
# Check agent files exist
ls -la agents/

# View session logs
jq '.error' logs/pi-sessions/*.json

# Rebuild TypeScript
npm run build && npm start
```

**Upload failing?**
```bash
# Check Python dependencies
pip3 list | grep -E "requests|pymupdf|pdfplumber"

# Test server
curl http://localhost:3000/api/documents

# Check logs
tail -f dist/server.log
```

---

## Performance Notes

| Operation | Standard | Fast Mode |
|-----------|----------|-----------|
| Upload 50pg PDF | ~30s | ~8s |
| Upload 200pg PDF | ~120s | ~25s |
| Native Query | ~3s | ~3s |
| Pi-Mono Query | ~45s | ~45s |

*Times vary based on PDF complexity and system specs*
