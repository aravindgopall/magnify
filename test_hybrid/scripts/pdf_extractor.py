#!/usr/bin/env python3
"""
PDF Extractor Server using PyMuPDF

Extracts text, tables, and images from PDFs.
- Text: Extracted as-is
- Tables: Converted to markdown format
- Images: Described using vision model (kimi-latest)

Usage:
    python pdf_extractor.py

Requirements:
    pip install fastapi uvicorn pymupdf pillow httpx python-multipart
"""

import asyncio
import base64
import io
import json
import logging
import os
import re
from pathlib import Path
from typing import List, Optional, Dict, Any, Literal, Tuple

import httpx
import pymupdf
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel

# Load .env file from test_hybrid directory
def load_env_file():
    """Load environment variables from .env file."""
    env_paths = [
        Path(__file__).parent.parent / '.env',  # test_hybrid/.env
        Path.cwd() / '.env',  # current working directory
    ]
    
    for env_path in env_paths:
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key not in os.environ:
                            os.environ[key] = value
            logging.info(f"Loaded environment from: {env_path}")
            return True
    return False

# Load .env before checking API keys
load_env_file()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="PDF Extractor Server",
    description="Extract text, tables, and images from PDFs using PyMuPDF",
    version="1.0.0",
)

# Vision model configuration - ALL values must be set in .env file
# Required: VISION_BASE_URL, VISION_MODEL, GRID_API_KEY

VISION_BASE_URL = os.environ.get("VISION_BASE_URL", "")
if not VISION_BASE_URL:
    logger.error("VISION_BASE_URL not set in .env file - image descriptions will be disabled")

VISION_API_URL = f"{VISION_BASE_URL}/chat/completions" if VISION_BASE_URL else ""

VISION_MODEL = os.environ.get("VISION_MODEL", "")
if not VISION_MODEL:
    logger.error("VISION_MODEL not set in .env file - image descriptions will be disabled")

VISION_API_KEY = os.environ.get("GRID_API_KEY", "")
if not VISION_API_KEY:
    logger.error("GRID_API_KEY not set in .env file - image descriptions will be disabled")

# Log the configuration being used
if VISION_BASE_URL and VISION_MODEL and VISION_API_KEY:
    logger.info(f"Vision API configured: {VISION_MODEL} @ {VISION_BASE_URL}")
else:
    logger.warning("Vision API not fully configured - images will have placeholder descriptions")


class ExtractedContent(BaseModel):
    """A piece of extracted content from a PDF."""
    type: Literal["text", "table", "image"]
    text: str  # For tables: markdown, for images: description
    page_number: int
    position: int  # Position in the document
    metadata: Dict[str, Any] = {}


class ExtractionResult(BaseModel):
    """Result of PDF extraction."""
    contents: List[ExtractedContent]
    total_pages: int
    file_name: str
    metadata: Dict[str, Any] = {}


class HealthResponse(BaseModel):
    """Response model for health endpoint."""
    status: str
    version: str
    vision_model: str


class ImageToProcess(BaseModel):
    """An image awaiting vision processing."""
    base64: str
    ext: str
    position: Optional[List[float]]
    context: str
    xref: int
    page_number: int
    global_position: int


def extract_text_from_block(block: dict) -> str:
    """Extract text from a PDF block."""
    if block.get("type") != 0:  # Type 0 is text
        return ""
    
    lines = block.get("lines", [])
    text_parts = []
    for line in lines:
        for span in line.get("spans", []):
            text_parts.append(span.get("text", ""))
        text_parts.append("\n")
    
    return "".join(text_parts).strip()


def detect_table_in_page(page: pymupdf.Page) -> List[Dict[str, Any]]:
    """
    Detect tables in a page using PyMuPDF's table detection.
    Returns list of table information.
    """
    tables = []
    
    # Use PyMuPDF's find_tables() method (available in recent versions)
    try:
        tab_finder = page.find_tables()
        if tab_finder and hasattr(tab_finder, 'tables'):
            for table in tab_finder.tables:
                # Extract table as markdown
                table_md = table.to_markdown()
                bbox = table.bbox  # (x0, y0, x1, y1)
                # Convert pymupdf.Rect to list for JSON serialization
                bbox_list = [bbox[0], bbox[1], bbox[2], bbox[3]] if bbox else None
                tables.append({
                    "markdown": table_md,
                    "bbox": bbox_list,
                    "row_count": table.row_count if hasattr(table, 'row_count') else 0,
                    "col_count": table.col_count if hasattr(table, 'col_count') else 0,
                })
    except Exception as e:
        logger.debug(f"Table detection not available or failed: {e}")
    
    return tables


def table_to_markdown(table_data: List[List[str]]) -> str:
    """Convert a 2D list of strings to markdown table format."""
    if not table_data or not table_data[0]:
        return ""
    
    # Calculate column widths
    col_count = len(table_data[0])
    col_widths = [0] * col_count
    
    for row in table_data:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(cell)))
    
    # Build markdown
    lines = []
    
    # Header row
    header = "| " + " | ".join(str(cell).ljust(col_widths[i]) for i, cell in enumerate(table_data[0])) + " |"
    lines.append(header)
    
    # Separator
    separator = "|" + "|".join("-" * (w + 2) for w in col_widths) + "|"
    lines.append(separator)
    
    # Data rows
    for row in table_data[1:]:
        # Pad row if needed
        while len(row) < col_count:
            row.append("")
        data_row = "| " + " | ".join(str(cell).ljust(col_widths[i]) for i, cell in enumerate(row)) + " |"
        lines.append(data_row)
    
    return "\n".join(lines)


def _image_placeholder(image_context: str = "") -> str:
    """Generate a placeholder description for an image when vision API is unavailable."""
    if image_context:
        return f"[Image content - context: {image_context[:200]}]"
    return "[Image content - description unavailable]"


async def describe_image_with_vision(image_base64: str, image_context: str = "", max_retries: int = 5) -> str:
    """
    Generate a text description of an image using the vision model.
    
    Args:
        image_base64: Base64 encoded image data
        image_context: Optional context (e.g., surrounding text)
        max_retries: Maximum number of retries for rate limiting (429 errors)
    
    Returns:
        Text description of the image
    """
    if not VISION_API_KEY or not VISION_API_URL:
        logger.warning("No vision API configured, returning placeholder description")
        return _image_placeholder(image_context)
    
    retry_delay = 5  # seconds - increased initial delay
    
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                # Prepare the message with image
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{image_base64}"
                                }
                            },
                            {
                                "type": "text",
                                "text": f"""Analyze this image from a document and provide a detailed description.
{'Context from surrounding text: ' + image_context if image_context else ''}

Please describe:
1. What type of content is shown (chart, diagram, photo, screenshot, etc.)
2. The key information or data presented
3. Any text visible in the image
4. The purpose or meaning of this image in a document context

Provide a concise but comprehensive description that would help someone understand the image content."""
                            }
                        ]
                    }
                ]
                
                response = await client.post(
                    VISION_API_URL,
                    headers={
                        "Authorization": f"Bearer {VISION_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": VISION_MODEL,
                        "messages": messages,
                        "max_tokens": 1000,
                    }
                )
                
                if response.status_code == 429:
                    # Rate limit hit
                    error_text = response.text[:100]
                    if attempt < max_retries - 1:
                        logger.warning(f"Vision API rate limit (429), retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                        continue
                    else:
                        logger.error(f"Vision API rate limit exceeded after {max_retries} attempts")
                        return _image_placeholder(image_context)
                
                if response.status_code != 200:
                    logger.error(f"Vision API error: {response.status_code} - {response.text[:200]}")
                    return _image_placeholder(image_context)
                
                data = response.json()
                message = data.get("choices", [{}])[0].get("message", {})
                
                # Handle different response formats:
                # - Standard: content is a string
                # - Thinking models: content may be null, use reasoning_content instead
                description = message.get("content") or message.get("reasoning_content") or ""
                
                if not description or not description.strip():
                    logger.warning("Vision API returned empty description")
                    return _image_placeholder(image_context)
                
                return description.strip()
                
        except httpx.TimeoutException:
            if attempt < max_retries - 1:
                logger.warning(f"Vision API timeout, retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(retry_delay)
                retry_delay *= 2
                continue
            logger.error("Vision API timeout (60s) - all retries exhausted")
            return _image_placeholder(image_context)
        except Exception as e:
            logger.error(f"Error calling vision API: {e}")
            return _image_placeholder(image_context)
    
    # Should not reach here, but fallback just in case
    return _image_placeholder(image_context)


def extract_images_from_page(page: pymupdf.Page, page_number: int) -> List[Dict[str, Any]]:
    """
    Extract images from a PDF page.
    Returns list of image information including base64 data.
    """
    images = []
    
    try:
        image_list = page.get_images(full=True)
        
        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]  # Image reference number
            
            try:
                # Extract image data
                base_image = page.parent.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image.get("ext", "png")
                
                # Get image position on page
                img_rects = page.get_image_rects(xref)
                position = None
                if img_rects:
                    # Convert pymupdf.Rect to list for JSON serialization
                    rect = img_rects[0]
                    position = [rect.x0, rect.y0, rect.x1, rect.y1]
                
                # Convert to base64
                image_base64 = base64.b64encode(image_bytes).decode("utf-8")
                
                # Get surrounding text for context
                surrounding_text = ""
                if position:
                    # Get text near the image
                    rect = pymupdf.Rect(position)
                    # Expand rect to get surrounding context
                    context_rect = rect + (-50, -50, 50, 50)
                    surrounding_text = page.get_text("text", clip=context_rect)[:500]
                
                images.append({
                    "base64": image_base64,
                    "ext": image_ext,
                    "position": position,
                    "context": surrounding_text.strip(),
                    "xref": xref,
                    "page_number": page_number,
                })
                
            except Exception as e:
                logger.debug(f"Failed to extract image {xref}: {e}")
                continue
                
    except Exception as e:
        logger.debug(f"Image extraction failed: {e}")
    
    return images


async def process_all_images_parallel(
    all_images: List[Dict[str, Any]],
    extracted_xrefs: set
) -> List[Tuple[int, int, str, Optional[List[float]], str]]:  # (page_num, position, description, bbox, ext)
    """
    Process all images across all pages in parallel.
    
    Args:
        all_images: List of image dicts with page_number, base64, context, etc.
        extracted_xrefs: Set of already-processed xrefs
    
    Returns:
        List of tuples: (page_number, position, description, bbox, ext)
    """
    # Filter unique images and prepare for batch processing
    unique_images = []
    for img in all_images:
        xref = img.get("xref")
        if xref in extracted_xrefs:
            continue
        extracted_xrefs.add(xref)
        unique_images.append(img)
    
    if not unique_images:
        return []
    
    logger.info(f"Processing {len(unique_images)} unique image(s) in parallel...")
    
    # Process all images in parallel with limited concurrency
    # Reduced to 1 to avoid rate limiting issues with vision API
    semaphore = asyncio.Semaphore(1)
    
    async def process_one(img: Dict[str, Any]) -> Tuple[int, int, str, Optional[List[float]], str]:
        async with semaphore:
            # Retry logic for rate limiting
            max_retries = 3
            retry_delay = 2  # seconds
            
            for attempt in range(max_retries):
                try:
                    description = await describe_image_with_vision(
                        img["base64"],
                        img.get("context", "")
                    )
                    return (
                        img["page_number"],
                        img.get("position"),
                        description,
                        img.get("position"),
                        img.get("ext", "png")
                    )
                except Exception as e:
                    if "429" in str(e) and attempt < max_retries - 1:
                        logger.warning(f"Rate limit hit, retrying in {retry_delay}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                    else:
                        raise
    
    results = await asyncio.gather(*[process_one(img) for img in unique_images])
    logger.info(f"Completed processing {len(results)} image(s)")
    
    return results


async def extract_from_pdf(
    pdf_bytes: bytes,
    file_name: str,
    extract_images: bool = True,
    extract_tables: bool = True,
) -> ExtractionResult:
    """
    Extract all content from a PDF file.
    
    Args:
        pdf_bytes: Raw PDF file bytes
        file_name: Name of the file
        extract_images: Whether to extract and describe images
        extract_tables: Whether to detect and extract tables
    
    Returns:
        ExtractionResult with all extracted content
    """
    contents: List[ExtractedContent] = []
    
    try:
        # Open PDF
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        
        # Track position across all pages
        global_position = 0
        
        # Collect all images across all pages for batch processing
        all_images: List[Dict[str, Any]] = []
        
        # Track extracted image xrefs to avoid duplicates
        extracted_xrefs = set()
        
        # First pass: extract text, tables, and collect images
        for page_num in range(total_pages):
            page = doc[page_num]
            logger.info(f"Processing page {page_num + 1}/{total_pages}...")
            
            # Get page text with structure
            blocks = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE).get("blocks", [])
            
            # Detect tables on this page
            page_tables = []
            if extract_tables:
                page_tables = detect_table_in_page(page)
            
            # Extract images from this page (collect for later processing)
            if extract_images:
                page_images = extract_images_from_page(page, page_num + 1)
                all_images.extend(page_images)
            
            # Track which y-positions are covered by tables
            table_positions = []
            for table in page_tables:
                bbox = table.get("bbox", (0, 0, 0, 0))
                table_positions.append((bbox[1], bbox[3], table))  # y0, y1, table
            
            # Process blocks in order
            for block in blocks:
                if block.get("type") != 0:  # Skip non-text blocks
                    continue
                
                # Get block position
                bbox = block.get("bbox", (0, 0, 0, 0))
                block_y0, block_y1 = bbox[1], bbox[3]
                
                # Check if this block is inside a table
                skip_block = False
                for ty0, ty1, table in table_positions:
                    if block_y0 >= ty0 and block_y1 <= ty1:
                        skip_block = True
                        break
                
                if skip_block:
                    continue
                
                # Extract text from block
                text = extract_text_from_block(block)
                if text.strip():
                    contents.append(ExtractedContent(
                        type="text",
                        text=text,
                        page_number=page_num + 1,
                        position=global_position,
                        metadata={
                            "bbox": bbox,
                        }
                    ))
                    global_position += 1
            
            # Add tables
            for table in page_tables:
                table_md = table.get("markdown", "")
                if table_md.strip():
                    # Prepend with marker for table
                    table_text = f"[TABLE]\n{table_md}\n[/TABLE]"
                    contents.append(ExtractedContent(
                        type="table",
                        text=table_text,
                        page_number=page_num + 1,
                        position=global_position,
                        metadata={
                            "row_count": table.get("row_count", 0),
                            "col_count": table.get("col_count", 0),
                            "bbox": table.get("bbox"),
                        }
                    ))
                    global_position += 1
        
        # Second pass: process all images in parallel across all pages
        if extract_images and all_images:
            image_results = await process_all_images_parallel(all_images, extracted_xrefs)
            
            # Add image results to contents
            for page_num, _, description, position, ext in image_results:
                if description.strip():
                    img_text = f"[IMAGE DESCRIPTION]\n{description}\n[/IMAGE DESCRIPTION]"
                    contents.append(ExtractedContent(
                        type="image",
                        text=img_text,
                        page_number=page_num,
                        position=global_position,
                        metadata={
                            "image_ext": ext,
                            "bbox": position,
                        }
                    ))
                    global_position += 1
        
        doc.close()
        logger.info(f"Extraction complete: {len(contents)} items from {total_pages} pages")
        
        # Sort by page number and position
        contents.sort(key=lambda x: (x.page_number, x.position))
        
        # Reassign positions after sorting
        for i, content in enumerate(contents):
            content.position = i
        
        return ExtractionResult(
            contents=contents,
            total_pages=total_pages,
            file_name=file_name,
            metadata={
                "total_contents": len(contents),
                "text_count": sum(1 for c in contents if c.type == "text"),
                "table_count": sum(1 for c in contents if c.type == "table"),
                "image_count": sum(1 for c in contents if c.type == "image"),
            }
        )
        
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        raise HTTPException(status_code=500, detail=f"PDF extraction failed: {str(e)}")


# API Endpoints

@app.get("/", response_model=HealthResponse)
async def root():
    """Root endpoint - returns server status."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        vision_model=VISION_MODEL,
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        vision_model=VISION_MODEL,
    )


@app.post("/extract", response_model=ExtractionResult)
async def extract_pdf(
    file: UploadFile = File(...),
    extract_images: bool = True,
    extract_tables: bool = True,
):
    """
    Extract text, tables, and images from a PDF file.
    
    Args:
        file: PDF file to extract
        extract_images: Whether to extract and describe images
        extract_tables: Whether to detect and extract tables
    
    Returns:
        ExtractionResult with all extracted content
    """
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        pdf_bytes = await file.read()
        result = await extract_from_pdf(
            pdf_bytes,
            file.filename,
            extract_images=extract_images,
            extract_tables=extract_tables,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-bytes", response_model=ExtractionResult)
async def extract_pdf_bytes(
    pdf_bytes: bytes,
    file_name: str = "document.pdf",
    extract_images: bool = True,
    extract_tables: bool = True,
):
    """
    Extract content from PDF bytes.
    
    This endpoint is useful for programmatic access.
    """
    try:
        result = await extract_from_pdf(
            pdf_bytes,
            file_name,
            extract_images=extract_images,
            extract_tables=extract_tables,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Extraction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="PDF Extractor Server")
    parser.add_argument("--host", type=str, default="localhost", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8001, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()
    
    import uvicorn
    uvicorn.run(
        "pdf_extractor:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )