# Work Plan: Parallel Batch Processing for PDF Ingestion

## Summary
Add parallel batch processing to the PDF ingestion pipeline to speed up extraction of multi-page PDFs by processing multiple pages concurrently instead of sequentially.

## Goal
Reduce PDF ingestion time by 3-4x for multi-page documents through parallel page processing.

## Scope
### IN
- Python extractor: Add ThreadPoolExecutor for parallel page processing
- Python CLI: Add `--batch-size` argument with default 4
- TypeScript pipeline: Pass batch size to Python extractor
- Progress logging during extraction

### OUT
- Distributed processing across multiple machines
- GPU acceleration for OCR
- Modifying query pipeline

## Technical Approach

### Files to Modify

| File | Change |
|------|--------|
| `scripts/pdf_extractor.py` | Add parallel batch processing with ThreadPoolExecutor |
| `src/ingest/pipeline.ts` | Pass batch size option to Python extractor |
| `src/cli/ingest.ts` | Add optional `--batch-size` CLI argument |

### Architecture
```
Current:  PDF → Python (sequential pages) → JSON → TS chunking → SQLite
Proposed: PDF → Python (parallel batches) → JSON → TS chunking → SQLite
```

## Key Decisions
| Decision | Rationale |
|----------|-----------|
| ThreadPoolExecutor over ProcessPool | I/O-bound operations (table extraction, OCR) benefit from threads; lower memory overhead |
| Default batch size: 4 | Matches existing `maxConcurrency` config in codebase |
| CLI argument for batch size | Allows tuning for different document types and hardware |

## Guardrails
- Batch size capped at 16 to prevent memory issues
- Graceful fallback to sequential processing if parallelism fails
- Preserve existing output format (JSON structure unchanged)

---

## Tasks

### Task 1: Add parallel processing infrastructure to Python extractor

**File**: `scripts/pdf_extractor.py`

**Changes**:
1. Add import: `from concurrent.futures import ThreadPoolExecutor, as_completed`
2. Add `--batch-size` CLI argument to `main()` function (default: 4, max: 16)
3. Pass `batch_size` to `PDFExtractor` constructor
4. Add `batch_size` attribute to `PDFExtractor.__init__()` (default: 4)

**Code pattern**:
```python
parser.add_argument('--batch-size', type=int, default=4,
                   help='Number of pages to process in parallel (default: 4, max: 16)')
```

**QA scenarios**:
- Run with `--batch-size 1` (sequential, should work as before)
- Run with `--batch-size 16` (maximum allowed)
- Run with `--batch-size 100` (should cap at 16)

---

### Task 2: Implement batch page processing in Python extractor

**File**: `scripts/pdf_extractor.py`

**Changes**:
1. Add helper method `_extract_page_wrapper()` for thread-safe page extraction
2. Modify `extract()` method to process pages in parallel batches
3. Add progress logging (e.g., "Processing pages 1-4 of 100...")

**Code pattern for `extract()` method** (replace lines 680-693):
```python
def _extract_page_batch(self, page_nums, doc, pdf_path, pdf_type, doc_id):
    results = []
    for page_num in page_nums:
        if pdf_type == PDFType.DIGITAL:
            page_obj = self.extract_page_digital(doc[page_num - 1], page_num, pdf_path, doc_id)
        elif pdf_type == PDFType.SCANNED:
            page_obj = self.extract_page_scanned(pdf_path, page_num, doc_id)
        else:  # HYBRID
            page = doc[page_num - 1]
            if page.get_text().strip():
                page_obj = self.extract_page_digital(page, page_num, pdf_path, doc_id)
            else:
                page_obj = self.extract_page_scanned(pdf_path, page_num, doc_id)
        results.append(page_obj)
    return results

# In extract() method:
batch_size = min(self.batch_size, 16)  # Cap at 16
pages = []
with ThreadPoolExecutor(max_workers=batch_size) as executor:
    # Process in batches
    for batch_start in range(1, len(doc) + 1, batch_size):
        batch_end = min(batch_start + batch_size - 1, len(doc))
        batch_nums = list(range(batch_start, batch_end + 1))
        
        print(f"Processing pages {batch_start}-{batch_end} of {len(doc)}...", file=sys.stderr)
        
        # Submit all pages in batch for parallel processing
        futures = {
            executor.submit(self._extract_single_page, page_num, doc, pdf_path, pdf_type, doc_id): page_num
            for page_num in batch_nums
        }
        
        for future in as_completed(futures):
            page_obj = future.result()
            pages.append(page_obj)

# Sort by page number to maintain order
pages.sort(key=lambda p: p.page_number)
```

**QA scenarios**:
- Extract 4-page PDF with batch-size 2 (should process 2 batches)
- Extract 100-page PDF with batch-size 4 (should process 25 batches)
- Verify output JSON has pages in correct order

---

### Task 3: Add single page extraction helper method

**File**: `scripts/pdf_extractor.py`

**Changes**:
1. Add `_extract_single_page()` method that handles one page (thread-safe)

**Code**:
```python
def _extract_single_page(self, page_num, doc, pdf_path, pdf_type, doc_id):
    """Extract a single page - thread-safe for parallel processing."""
    if pdf_type == PDFType.DIGITAL:
        return self.extract_page_digital(doc[page_num - 1], page_num, pdf_path, doc_id)
    elif pdf_type == PDFType.SCANNED:
        return self.extract_page_scanned(pdf_path, page_num, doc_id)
    else:  # HYBRID
        page = doc[page_num - 1]
        if page.get_text().strip():
            return self.extract_page_digital(page, page_num, pdf_path, doc_id)
        else:
            return self.extract_page_scanned(pdf_path, page_num, doc_id)
```

**QA scenarios**:
- Called concurrently by multiple threads
- Returns correct PageObject for each PDF type

---

### Task 4: Update TypeScript pipeline to pass batch size

**File**: `src/ingest/pipeline.ts`

**Changes**:
1. Add optional `batchSize` parameter to `runPythonExtractor()` function
2. Pass `--batch-size` argument to Python process when specified

**Code changes** (around line 67):
```typescript
async function runPythonExtractor(pdfPath: string, batchSize?: number): Promise<PythonExtractionResult> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'pdf_extractor.py');
  
  const args = [scriptPath, pdfPath, '--strategy', 'all'];
  if (batchSize) {
    args.push('--batch-size', String(batchSize));
  }
  
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // ... rest unchanged
```

**QA scenarios**:
- Call without batch size (Python uses default 4)
- Call with batch size 8 (Python should receive `--batch-size 8`)

---

### Task 5: Add batch size option to CLI

**File**: `src/cli/ingest.ts`

**Changes**:
1. Parse `--batch-size` argument from CLI
2. Pass to `ingestPDF()` function

**Code changes**:
```typescript
// In main():
let batchSize: number | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--batch-size') {
    batchSize = parseInt(args[++i], 10);
    if (isNaN(batchSize) || batchSize < 1 || batchSize > 16) {
      console.error('Error: --batch-size must be between 1 and 16');
      process.exit(1);
    }
  } else if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  } else if (!arg.startsWith('-')) {
    filePath = arg;
  }
}

// Update ingestPDF call:
const result = await ingestPDF(filePath, batchSize);
```

**Update `ingestPDF` signature in `src/ingest/pipeline.ts`**:
```typescript
export async function ingestPDF(filePath: string, batchSize?: number): Promise<{...}>
```

**QA scenarios**:
- `npm run ingest -- file.pdf --batch-size 8` works
- `npm run ingest -- file.pdf --batch-size 0` shows error
- `npm run ingest -- file.pdf --batch-size 20` shows error (capped at 16)

---

### Task 6: Update help text

**File**: `src/cli/ingest.ts`

**Changes**:
1. Update `printUsage()` to document `--batch-size` option

**Code**:
```typescript
function printUsage(): void {
  console.log(`
Usage: npm run ingest -- <file_path> [options]

Ingest a PDF file into SQLite databases for querying.

Note: Use "--" after "ingest" to pass arguments correctly (especially for paths with spaces).

Arguments:
  file_path    Path to the PDF file to ingest

Options:
  -h, --help      Show this help message
  --batch-size N  Process N pages in parallel (default: 4, max: 16)

Examples:
  npm run ingest -- ./document.pdf
  npm run ingest -- "/path/with spaces/report.pdf"
  npm run ingest -- ./large.pdf --batch-size 8

The ingestion creates 3 SQLite databases:
  1. fixed_chunks.db  - Fixed 10-page chunks
  2. heading_chunks.db - Chunks based on detected headings
  3. toc_chunks.db    - Chunks based on table of contents
`);
}
```

**QA scenarios**:
- `npm run ingest -- --help` shows updated help

---

## Final Verification Wave

Before marking complete, verify ALL of the following:

### Build Verification
- [ ] `npm run build` completes with no errors
- [ ] TypeScript compilation successful

### Functional Verification
- [ ] `npm run ingest -- test.pdf` works with default batch size
- [ ] `npm run ingest -- test.pdf --batch-size 1` works (sequential)
- [ ] `npm run ingest -- test.pdf --batch-size 8` works (parallel)
- [ ] `npm run ingest -- test.pdf --batch-size 0` shows validation error
- [ ] `npm run ingest -- test.pdf --batch-size 20` shows validation error
- [ ] Progress messages show during extraction (e.g., "Processing pages 1-4 of 100...")

### Output Verification
- [ ] Output JSON structure unchanged (same keys)
- [ ] Pages in correct order (sorted by page number)
- [ ] All 3 databases created correctly

### Performance Verification
- [ ] Large PDF (50+ pages) processes faster with batch-size 4 vs batch-size 1

### User Confirmation
- [ ] User confirms "looks good" before marking complete

---

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Single-page PDF | Process normally, batch-size ignored |
| PDF with 0 pages | Should fail with clear error |
| Mixed digital/scanned PDF | HYBRID type handles per-page |
| Memory pressure with large batches | Cap at 16, document in help |
| Python process crash | TypeScript catches error, shows message |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Thread safety issues in Python | Test with various PDFs, use thread-safe operations only |
| Memory issues with large batches | Cap batch-size at 16, document limitation |
| Output order not preserved | Sort pages by page_number after collection |

## Estimated Effort
- Python changes: ~30 minutes
- TypeScript changes: ~15 minutes
- Testing: ~15 minutes
- **Total: ~1 hour**
