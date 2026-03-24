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

DEFAULT_MAGNIFY_URL = os.environ.get('MAGNIFY_URL', 'http://localhost:3000')


def upload_document(pdf_path: str, magnify_url: str = DEFAULT_MAGNIFY_URL) -> dict:
    """Upload a PDF document to the Magnify server"""
    
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    pdf_path = os.path.abspath(pdf_path)
    file_name = Path(pdf_path).name
    
    print(f"📄 Uploading: {file_name}")
    print(f"🌐 Server: {magnify_url}")
    
    # Upload the document
    response = requests.post(
        f"{magnify_url}/api/documents/upload",
        json={
            "source": pdf_path,
            "fileName": file_name,
            "groupingStrategy": "hybrid",  # Use all grouping strategies
            "parallelPages": True  # Process pages in parallel for speed
        },
        timeout=1800  # 30 minutes timeout for large PDFs
    )
    
    if response.status_code != 200:
        raise Exception(f"Upload failed: {response.status_code} - {response.text}")
    
    result = response.json()
    
    print(f"✅ Upload successful!")
    print(f"📊 Document ID: {result['documentId']}")
    print(f"📖 Pages: {result['metadata']['pageCount']}")
    print(f"📚 Groups: {len(result['groups'])}")
    print(f"\nGroup Breakdown:")
    
    # Count groups by strategy
    group_types = {}
    for group in result['groups']:
        gtype = group.get('type', 'unknown')
        group_types[gtype] = group_types.get(gtype, 0) + 1
    
    for gtype, count in group_types.items():
        print(f"  - {gtype}: {count} groups")
    
    return result


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
            print(f'     pi "Query document {result["documentId"]}: What is the main topic?"')
            print()
            print("  2. Or use the Magnify API directly:")
            print(f'     curl -X POST {magnify_url}/api/query \\')
            print(f'       -H "Content-Type: application/json" \\')
            print(f'       -d \'{{"documentId": "{result["documentId"]}", "query": "your question"}}\'')
        except Exception as e:
            print(f"❌ Error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
