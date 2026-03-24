#!/usr/bin/env python3
"""
Fast Upload Script for Large PDFs
Optimized for speed - skips OCR and uses efficient extraction
"""

import sys
import os
import json
import requests
from pathlib import Path

DEFAULT_MAGNIFY_URL = os.environ.get('MAGNIFY_URL', 'http://localhost:3000')


def fast_upload_document(pdf_path: str, magnify_url: str = DEFAULT_MAGNIFY_URL) -> dict:
    """Upload a PDF document with speed optimizations"""
    
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    pdf_path = os.path.abspath(pdf_path)
    file_name = Path(pdf_path).name
    
    print(f"🚀 Fast Upload Mode (optimized for large PDFs)")
    print(f"📄 Uploading: {file_name}")
    print(f"🌐 Server: {magnify_url}")
    print(f"⚡ Optimizations: No OCR, parallel processing, single grouping strategy")
    
    # Upload with optimizations
    response = requests.post(
        f"{magnify_url}/api/documents/upload",
        json={
            "source": pdf_path,
            "fileName": file_name,
            "groupingStrategy": "fixed",  # Fastest strategy - just page ranges
            "skipOCR": True,  # Skip OCR for speed
            "parallelPages": True,  # Process pages in parallel
        },
        timeout=1800  # 30 minutes
    )
    
    if response.status_code != 200:
        raise Exception(f"Upload failed: {response.status_code} - {response.text}")
    
    result = response.json()
    
    print(f"✅ Upload successful!")
    print(f"📊 Document ID: {result['documentId']}")
    print(f"📖 Pages: {result['metadata']['pageCount']}")
    print(f"📚 Groups: {len(result['groups'])}")
    
    return result


def main():
    if len(sys.argv) < 2:
        print("Fast Upload for Large PDFs")
        print()
        print("Usage:")
        print("  python fast_upload.py <pdf_path>")
        print()
        print("Optimizations:")
        print("  • Skips OCR (3-5x faster for scanned PDFs)")
        print("  • Uses fixed page grouping (simplest, fastest)")
        print("  • Parallel page processing where possible")
        print()
        print("For full processing with all features, use:")
        print("  python upload_document.py <pdf_path>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    magnify_url = os.environ.get('MAGNIFY_URL', DEFAULT_MAGNIFY_URL)
    
    try:
        import time
        start = time.time()
        
        result = fast_upload_document(pdf_path, magnify_url)
        
        elapsed = time.time() - start
        print(f"\n⏱️  Upload completed in {elapsed:.1f} seconds ({elapsed/60:.1f} minutes)")
        
        pages = result['metadata']['pageCount']
        print(f"📈 Speed: {pages/elapsed:.1f} pages/second")
        
        print()
        print("🎯 Next Steps:")
        print(f'  curl -X POST {magnify_url}/api/query \\')
        print(f'    -H "Content-Type: application/json" \\')
        print(f'    -d \'{{"documentId": "{result["documentId"]}", "query": "your question"}}\'')
        
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
