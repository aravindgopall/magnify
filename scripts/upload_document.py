#!/usr/bin/env python3
"""
Upload Script for Magnify
Uploads a PDF document to the running Magnify server
"""

import sys
import os
import json
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

DEFAULT_MAGNIFY_URL = os.environ.get('MAGNIFY_URL', 'http://localhost:3000')


def upload_with_strategy(pdf_path: str, strategy: str, magnify_url: str) -> dict:
    """Upload a PDF with a specific grouping strategy"""
    
    file_name = Path(pdf_path).name
    
    print(f"🔄 [{strategy.upper()}] Starting upload...")
    start_time = time.time()
    
    response = requests.post(
        f"{magnify_url}/api/documents/upload",
        json={
            "source": pdf_path,
            "fileName": file_name,
            "groupingStrategy": strategy,
            "parallelPages": True
        },
        timeout=1800
    )
    
    duration = time.time() - start_time
    
    if response.status_code != 200:
        print(f"❌ [{strategy.upper()}] Upload failed: {response.status_code}")
        raise Exception(f"Upload failed for {strategy}: {response.text}")
    
    result = response.json()
    print(f"✅ [{strategy.upper()}] Complete in {duration:.1f}s - {len(result['groups'])} groups")
    
    return result


def merge_upload_results(fixed_result: dict, toc_result: dict, heading_result: dict) -> dict:
    """Merge results from 3 strategy uploads into a combined result"""
    
    # Use fixed as base (since it's done first)
    merged = fixed_result.copy()
    
    # Collect all groups from all strategies
    all_groups = []
    all_groups.extend(fixed_result.get('groups', []))
    all_groups.extend(toc_result.get('groups', []))
    all_groups.extend(heading_result.get('groups', []))
    
    merged['groups'] = all_groups
    
    return merged


def upload_document(pdf_path: str, magnify_url: str = DEFAULT_MAGNIFY_URL) -> dict:
    """Upload a PDF document using all 3 strategies in parallel (fixed first, then toc+heading)"""
    
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    pdf_path = os.path.abspath(pdf_path)
    file_name = Path(pdf_path).name
    
    print(f"📄 Uploading: {file_name}")
    print(f"🌐 Server: {magnify_url}")
    print(f"🚀 Strategy: Parallel uploads (fixed → toc+heading)")
    print()
    
    # Step 1: Upload with 'fixed' first (queryable immediately)
    fixed_result = upload_with_strategy(pdf_path, "fixed", magnify_url)
    
    # Step 2: Upload toc and heading in parallel
    print()
    print("🔄 Running TOC + Heading strategies in parallel...")
    
    with ThreadPoolExecutor(max_workers=2) as executor:
        toc_future = executor.submit(upload_with_strategy, pdf_path, "toc", magnify_url)
        heading_future = executor.submit(upload_with_strategy, pdf_path, "heading", magnify_url)
        
        # Wait for both to complete
        toc_result = toc_future.result()
        heading_result = heading_future.result()
    
    # Merge all results
    merged = merge_upload_results(fixed_result, toc_result, heading_result)
    
    print()
    print(f"✅ All uploads complete!")
    print(f"📊 Document ID: {fixed_result['documentId']}")
    print(f"📖 Pages: {fixed_result['metadata']['pageCount']}")
    print(f"📚 Total Groups: {len(merged['groups'])}")
    print(f"\nGroup Breakdown:")
    
    # Count groups by strategy
    group_types = {}
    for group in merged['groups']:
        gtype = group.get('type', 'unknown')
        group_types[gtype] = group_types.get(gtype, 0) + 1
    
    for gtype, count in sorted(group_types.items()):
        print(f"  - {gtype}: {count} groups")
    
    return merged


def list_documents(magnify_url: str = DEFAULT_MAGNIFY_URL) -> list:
    """List all documents on the Magnify server"""
    
    response = requests.get(f"{magnify_url}/api/documents")
    
    if response.status_code != 200:
        raise Exception(f"List failed: {response.status_code} - {response.text}")
    
    data = response.json()
    return data.get('documents', [])


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python upload_document.py <pdf_path>        # Upload a PDF")
        print("  python upload_document.py --list            # List all documents")
        print()
        print("Environment Variables:")
        print("  MAGNIFY_URL - Magnify server URL (default: http://localhost:3000)")
        sys.exit(1)
    
    magnify_url = os.environ.get('MAGNIFY_URL', DEFAULT_MAGNIFY_URL)
    
    if sys.argv[1] == '--list':
        print("📚 Documents on server:")
        documents = list_documents(magnify_url)
        
        if not documents:
            print("  No documents found.")
            print()
            print("Upload a document first:")
            print(f"  python {sys.argv[0]} /path/to/document.pdf")
            sys.exit(0)
        
        for doc in documents:
            print(f"\n  📄 {doc['metadata'].get('title', 'Untitled')}")
            print(f"     ID: {doc['id']}")
            print(f"     Pages: {doc['metadata']['pageCount']}")
            print(f"     Groups: {doc['groupCount']}")
    else:
        pdf_path = sys.argv[1]
        try:
            result = upload_document(pdf_path, magnify_url)
            
            print()
            print("🎯 Next Steps:")
            print("  1. Query using pi-mono:")
            print(f'     pi "Query document: What is the main topic?"')
            print()
            print("  2. Or use the Magnify API directly:")
            print(f'     curl -X POST {magnify_url}/api/query-agents \\')
            print(f'       -H "Content-Type: application/json" \\')
            print(f'       -d \'{{"documentId": "<doc-id>", "query": "your question", "extractionType": "summary"}}\'')
            print()
            print(f"  💡 Document was queryable after {result.get('metadata', {}).get('pageCount', 0)} seconds (fixed strategy)")
        except Exception as e:
            print(f"❌ Error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
