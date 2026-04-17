#!/usr/bin/env python3
"""
PDF Extraction Pipeline
Handles digital, scanned, and hybrid PDFs with multiple extraction strategies.
Outputs page-level data and all 3 grouping strategies.
"""

import json
import sys
import os
import tempfile
import base64
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, asdict, field
from enum import Enum
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# PDF processing libraries
try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False

try:
    import camelot
    CAMELOT_AVAILABLE = True
except ImportError:
    CAMELOT_AVAILABLE = False

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False

try:
    from pdf2image import convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False

try:
    import pytesseract
    PYTESSERACT_AVAILABLE = True
except ImportError:
    PYTESSERACT_AVAILABLE = False


class PDFType(Enum):
    DIGITAL = "digital"
    SCANNED = "scanned"
    HYBRID = "hybrid"


@dataclass
class TextBlock:
    text: str
    font_size: float
    is_bold: bool
    bbox: Dict[str, float]  # x, y, width, height
    

@dataclass
class TableData:
    headers: List[str]
    rows: List[List[str]]
    caption: Optional[str] = None
    

@dataclass
class ImageData:
    page_number: int
    image_index: int
    width: int
    height: int
    file_path: Optional[str] = None
    image_base64: Optional[str] = None


@dataclass
class PageObject:
    page_number: int
    text: str
    text_blocks: List[Dict[str, Any]]
    tables: List[Dict[str, Any]]
    images: List[Dict[str, Any]]
    width: float
    height: float


@dataclass
class GroupObject:
    group_id: str
    doc_id: str
    strategy: str  # "toc" | "heading" | "range"
    title: str
    start_page: int
    end_page: int
    full_text: str
    tables: List[Dict[str, Any]]
    image_paths: List[str]


@dataclass
class ExtractionResult:
    doc_id: str
    pdf_type: str
    metadata: Dict[str, Any]
    pages: List[Dict[str, Any]]
    groups: List[Dict[str, Any]]
    toc: Optional[List[Dict[str, Any]]] = None


class PDFExtractor:
    def __init__(self, output_dir: Optional[str] = None, save_images: bool = True, 
                 skip_tables: bool = False, skip_ocr: bool = False, extract_font_info: bool = True,
                 batch_size: int = 4):
        self.output_dir = output_dir or tempfile.mkdtemp()
        self.save_images = save_images
        self.skip_tables = skip_tables
        self.skip_ocr = skip_ocr
        self.extract_font_info = extract_font_info
        self.batch_size = min(max(batch_size, 1), 16)
        self.images_dir = os.path.join(self.output_dir, "images")
        self._doc_lock = threading.Lock()
        if self.save_images:
            os.makedirs(self.images_dir, exist_ok=True)
    
    def detect_pdf_type(self, pdf_path: str) -> PDFType:
        """Detect if PDF is digital, scanned, or hybrid."""
        if not PYMUPDF_AVAILABLE:
            return PDFType.DIGITAL  # Default assumption
        
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        pages_with_text = 0
        pages_without_text = 0
        
        for page_num in range(min(total_pages, 20)):  # Sample first 20 pages
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                pages_with_text += 1
            else:
                pages_without_text += 1
        
        doc.close()
        
        if pages_without_text == 0:
            return PDFType.DIGITAL
        elif pages_with_text == 0:
            return PDFType.SCANNED
        else:
            return PDFType.HYBRID
    
    def extract_text_blocks(self, page) -> List[TextBlock]:
        """Extract text blocks with font metadata from PyMuPDF page."""
        blocks = []
        
        # Get text with font information
        text_dict = page.get_text("dict")
        
        for block in text_dict.get("blocks", []):
            if "lines" not in block:
                continue
                
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                    
                    font_size = span.get("size", 12)
                    font_flags = span.get("flags", 0)
                    is_bold = bool(font_flags & 16)  # Bold flag
                    
                    bbox = span.get("bbox", (0, 0, 0, 0))
                    
                    blocks.append(TextBlock(
                        text=text,
                        font_size=font_size,
                        is_bold=is_bold,
                        bbox={
                            "x": bbox[0],
                            "y": bbox[1],
                            "width": bbox[2] - bbox[0],
                            "height": bbox[3] - bbox[1]
                        }
                    ))
        
        return blocks
    
    def extract_tables_camelot(self, pdf_path: str, page_number: int) -> List[TableData]:
        """Extract tables using camelot."""
        if not CAMELOT_AVAILABLE:
            return []
        
        tables = []
        try:
            # Try lattice mode first (for bordered tables)
            camelot_tables = camelot.read_pdf(
                pdf_path, 
                pages=str(page_number),
                flavor='lattice'
            )
            
            # Fallback to stream mode if no tables found
            if len(camelot_tables) == 0:
                camelot_tables = camelot.read_pdf(
                    pdf_path,
                    pages=str(page_number),
                    flavor='stream'
                )
            
            for table in camelot_tables:
                df = table.df
                if len(df) > 0:
                    headers = df.iloc[0].tolist() if len(df) > 0 else []
                    rows = df.iloc[1:].values.tolist() if len(df) > 1 else []
                    
                    tables.append(TableData(
                        headers=[str(h) for h in headers],
                        rows=[[str(cell) for cell in row] for row in rows]
                    ))
        except Exception as e:
            print(f"Camelot error on page {page_number}: {e}", file=sys.stderr)
        
        return tables
    
    def extract_tables_pdfplumber(self, pdf_path: str, page_number: int) -> List[TableData]:
        """Extract tables using pdfplumber."""
        if not PDFPLUMBER_AVAILABLE:
            return []
        
        tables = []
        try:
            with pdfplumber.open(pdf_path) as pdf:
                if page_number <= len(pdf.pages):
                    page = pdf.pages[page_number - 1]
                    extracted_tables = page.extract_tables()
                    
                    for table in extracted_tables:
                        if table and len(table) > 0:
                            headers = table[0] if table else []
                            rows = table[1:] if len(table) > 1 else []
                            
                            tables.append(TableData(
                                headers=[str(h) if h else "" for h in headers],
                                rows=[[str(cell) if cell else "" for cell in row] for row in rows]
                            ))
        except Exception as e:
            print(f"pdfplumber error on page {page_number}: {e}", file=sys.stderr)
        
        return tables
    
    def extract_images(self, page, page_number: int, doc_id: str) -> List[ImageData]:
        """Extract images from PyMuPDF page."""
        images = []
        
        image_list = page.get_images()
        
        for img_index, img in enumerate(image_list):
            try:
                xref = img[0]
                base_image = page.parent.extract_image(xref)
                
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                # Save image to disk
                image_filename = f"{doc_id}_p{page_number}_i{img_index}.{image_ext}"
                image_path = os.path.join(self.images_dir, image_filename)
                
                with open(image_path, "wb") as f:
                    f.write(image_bytes)
                
                images.append(ImageData(
                    page_number=page_number,
                    image_index=img_index,
                    width=img[2] if len(img) > 2 else 0,
                    height=img[3] if len(img) > 3 else 0,
                    file_path=image_path
                ))
            except Exception as e:
                print(f"Image extraction error: {e}", file=sys.stderr)
        
        return images
    
    def extract_page_digital(self, page, page_number: int, pdf_path: str, doc_id: str) -> PageObject:
        """Extract content from a digital PDF page."""
        # Extract text
        text = page.get_text()
        
        # Extract text blocks with font info (optional for performance)
        text_blocks = self.extract_text_blocks(page) if self.extract_font_info else []
        
        # Extract tables (SLOW - skip if not needed)
        tables = []
        if not self.skip_tables:
            tables = self.extract_tables_camelot(pdf_path, page_number)
            if not tables:
                tables = self.extract_tables_pdfplumber(pdf_path, page_number)
        
        # Extract images (optional for performance)
        images = self.extract_images(page, page_number, doc_id) if self.save_images else []
        
        # Get page dimensions
        rect = page.rect
        
        return PageObject(
            page_number=page_number,
            text=text,
            text_blocks=[asdict(tb) for tb in text_blocks],
            tables=[asdict(t) for t in tables],
            images=[asdict(img) for img in images],
            width=rect.width,
            height=rect.height
        )
    
    def extract_page_scanned(self, pdf_path: str, page_number: int, doc_id: str) -> PageObject:
        """Extract content from a scanned PDF page using OCR."""
        text = ""
        text_blocks = []
        tables = []
        images = []
        width, height = 612, 792  # Default letter size
        
        # Skip OCR if disabled (MAJOR speedup for scanned PDFs)
        if self.skip_ocr:
            return PageObject(
                page_number=page_number,
                text="[OCR skipped for performance]",
                text_blocks=[],
                tables=[],
                images=[],
                width=width,
                height=height
            )
        
        # Convert page to image
        if PDF2IMAGE_AVAILABLE and PYTESSERACT_AVAILABLE:
            try:
                pages = convert_from_path(pdf_path, first_page=page_number, last_page=page_number, dpi=300)
                if pages:
                    page_image = pages[0]
                    width, height = page_image.size
                    
                    # OCR the image
                    ocr_data = pytesseract.image_to_data(page_image, output_type=pytesseract.Output.DICT)
                    
                    # Build text from OCR results
                    lines = {}
                    for i, word in enumerate(ocr_data.get("text", [])):
                        if not word.strip():
                            continue
                        line_num = ocr_data.get("line_num", [0])[i]
                        if line_num not in lines:
                            lines[line_num] = []
                        lines[line_num].append(word)
                    
                    text = "\n".join(" ".join(words) for words in lines.values())
                    
                    # Create text blocks from OCR data
                    for i, word in enumerate(ocr_data.get("text", [])):
                        if not word.strip():
                            continue
                        text_blocks.append({
                            "text": word,
                            "font_size": 12,  # Default
                            "is_bold": False,
                            "bbox": {
                                "x": ocr_data.get("left", [0])[i],
                                "y": ocr_data.get("top", [0])[i],
                                "width": ocr_data.get("width", [0])[i],
                                "height": ocr_data.get("height", [0])[i]
                            }
                        })
                    
                    # Try table detection with pdfplumber (optional)
                    if not self.skip_tables:
                        tables = self.extract_tables_pdfplumber(pdf_path, page_number)
                        tables = [asdict(t) for t in tables]
                    
            except Exception as e:
                print(f"OCR error on page {page_number}: {e}", file=sys.stderr)
        
        return PageObject(
            page_number=page_number,
            text=text,
            text_blocks=text_blocks,
            tables=tables,
            images=images,
            width=width,
            height=height
        )
    
    def build_toc_groups(self, doc, pages: List[PageObject], doc_id: str) -> List[GroupObject]:
        """Build groups from Table of Contents."""
        groups = []
        toc = doc.get_toc()
        
        if not toc:
            # Create single "Full Document" group
            groups.append(GroupObject(
                group_id=str(uuid.uuid4()),
                doc_id=doc_id,
                strategy="toc",
                title="Full Document",
                start_page=1,
                end_page=len(pages),
                full_text="\n\n".join(p.text for p in pages),
                tables=[],
                image_paths=[]
            ))
            return groups
        
        for i, item in enumerate(toc):
            level, title, start_page = item[0], item[1], item[2]
            
            # Skip empty or whitespace-only titles
            if not title or not title.strip():
                continue
            
            title = title.strip()
            
            # Skip very short titles (likely noise)
            if len(title) < 3:
                continue
            
            # Find end page (start of next valid item with different page - 1)
            end_page = len(pages)  # Default to last page
            for j in range(i + 1, len(toc)):
                next_level, next_title, next_page = toc[j][0], toc[j][1], toc[j][2]
                # Skip invalid entries
                if not next_title or not next_title.strip() or len(next_title.strip()) < 3:
                    continue
                # Only use entries on a DIFFERENT page
                if next_page > start_page:
                    end_page = next_page - 1
                    break
            
            # Ensure valid page range
            if end_page < start_page:
                end_page = start_page
            
            # Ensure pages are within bounds
            start_page = max(1, min(start_page, len(pages)))
            end_page = max(start_page, min(end_page, len(pages)))
            
            # Gather pages for this group
            group_pages = [p for p in pages if start_page <= p.page_number <= end_page]
            
            # Skip if no pages found
            if not group_pages:
                continue
            
            groups.append(GroupObject(
                group_id=str(uuid.uuid4()),
                doc_id=doc_id,
                strategy="toc",
                title=title,
                start_page=start_page,
                end_page=end_page,
                full_text="\n\n".join(p.text for p in group_pages),
                tables=[t for p in group_pages for t in p.tables],
                image_paths=[img.get("file_path", "") for p in group_pages for img in p.images if img.get("file_path")]
            ))
        
        # Post-process: Merge consecutive groups with same page range (multiple TOC entries on same page)
        merged_groups = []
        current_group = None
        
        for group in groups:
            if current_group is None:
                current_group = group
            elif (current_group.start_page == group.start_page and 
                  current_group.end_page == group.end_page):
                # Same page range - merge titles
                current_group.title = f"{current_group.title} / {group.title}"
            else:
                merged_groups.append(current_group)
                current_group = group
        
        if current_group is not None:
            merged_groups.append(current_group)
        
        return merged_groups if merged_groups else groups
    
    def build_heading_groups(self, pages: List[PageObject], doc_id: str) -> List[GroupObject]:
        """Build groups based on detected headings (bold or large font)."""
        groups = []
        headings = []  # List of (page_number, title, font_size)
        
        # Noise words and symbols to filter out
        noise_words = {'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with'}
        noise_symbols = {'→', '•', '-', '>', '<', '|', '/', '\\'}
        
        # Find all headings
        for page in pages:
            for block in page.text_blocks:
                text = block.get("text", "").strip()
                font_size = block.get("font_size", 0)
                is_bold = block.get("is_bold", False)
                
                # Skip empty text
                if not text:
                    continue
                
                # Stricter heading criteria: bold AND font_size >= 12, OR font_size >= 16
                is_heading = (is_bold and font_size >= 12) or font_size >= 16
                
                if is_heading and len(text) < 100:  # Headings are usually short
                    # Filter out noise
                    text_lower = text.lower()
                    
                    # Skip if too short
                    if len(text) < 3:
                        continue
                    
                    # Skip if single word and it's a noise word
                    words = text.split()
                    if len(words) == 1 and text_lower in noise_words:
                        continue
                    
                    # Skip if it's just a symbol
                    if text in noise_symbols:
                        continue
                    
                    # Skip if it's only punctuation/symbols
                    if all(not c.isalnum() for c in text):
                        continue
                    
                    # Skip if it looks like a page number or date
                    if text.isdigit() or (len(text) <= 5 and any(c.isdigit() for c in text)):
                        continue
                    
                    headings.append((page.page_number, text, font_size))
        
        if not headings:
            # Create single "Full Document" group
            groups.append(GroupObject(
                group_id=str(uuid.uuid4()),
                doc_id=doc_id,
                strategy="heading",
                title="Full Document",
                start_page=1,
                end_page=len(pages),
                full_text="\n\n".join(p.text for p in pages),
                tables=[],
                image_paths=[]
            ))
            return groups
        
        # Remove duplicate headings on same page (keep larger font)
        filtered_headings = []
        seen_on_page = {}
        for page_num, title, font_size in headings:
            key = (page_num, title)
            if key not in seen_on_page or font_size > seen_on_page[key]:
                seen_on_page[key] = font_size
                filtered_headings.append((page_num, title))
        
        # Remove exact duplicates
        filtered_headings = list(dict.fromkeys(filtered_headings))
        
        # Sort by page number
        filtered_headings.sort(key=lambda x: x[0])
        
        # Build groups from headings
        for i, (page_num, title) in enumerate(filtered_headings):
            # Find end page (next heading's page - 1, or last page)
            end_page = len(pages)
            if i < len(filtered_headings) - 1:
                next_page = filtered_headings[i + 1][0]
                # If next heading is on a DIFFERENT page, end before it starts
                if next_page > page_num:
                    end_page = next_page - 1
                else:
                    # Next heading is on the SAME page - this group should only span current page
                    end_page = page_num
            
            # Ensure valid page range
            if end_page < page_num:
                end_page = page_num
            
            # Gather pages for this group
            group_pages = [p for p in pages if page_num <= p.page_number <= end_page]
            
            # Skip if no pages found
            if not group_pages:
                continue
            
            groups.append(GroupObject(
                group_id=str(uuid.uuid4()),
                doc_id=doc_id,
                strategy="heading",
                title=title,
                start_page=page_num,
                end_page=end_page,
                full_text="\n\n".join(p.text for p in group_pages),
                tables=[t for p in group_pages for t in p.tables],
                image_paths=[img.get("file_path", "") for p in group_pages for img in p.images if img.get("file_path")]
            ))
        
        # Post-process: Merge consecutive groups with same page range (multiple headings on same page)
        merged_groups = []
        current_group = None
        
        for group in groups:
            if current_group is None:
                current_group = group
            elif (current_group.start_page == group.start_page and 
                  current_group.end_page == group.end_page):
                # Same page range - merge titles
                current_group.title = f"{current_group.title} / {group.title}"
            else:
                merged_groups.append(current_group)
                current_group = group
        
        if current_group is not None:
            merged_groups.append(current_group)
        
        return merged_groups if merged_groups else groups
    
    def build_fixed_groups(self, pages: List[PageObject], doc_id: str, pages_per_group: int = 10) -> List[GroupObject]:
        """Build fixed range groups (always runs)."""
        groups = []
        total_pages = len(pages)
        
        for start in range(1, total_pages + 1, pages_per_group):
            end = min(start + pages_per_group - 1, total_pages)
            
            # Gather pages for this group
            group_pages = [p for p in pages if start <= p.page_number <= end]
            
            groups.append(GroupObject(
                group_id=str(uuid.uuid4()),
                doc_id=doc_id,
                strategy="range",
                title=f"Pages {start}-{end}",
                start_page=start,
                end_page=end,
                full_text="\n\n".join(p.text for p in group_pages),
                tables=[t for p in group_pages for t in p.tables],
                image_paths=[img.get("file_path", "") for p in group_pages for img in p.images if img.get("file_path")]
            ))
        
        return groups
    
    def _extract_single_page(self, page_num, doc, pdf_path, pdf_type, doc_id):
        if pdf_type == PDFType.DIGITAL:
            with self._doc_lock:
                page_obj = self.extract_page_digital(doc[page_num - 1], page_num, pdf_path, doc_id)
        elif pdf_type == PDFType.SCANNED:
            page_obj = self.extract_page_scanned(pdf_path, page_num, doc_id)
        else:  # HYBRID
            with self._doc_lock:
                page = doc[page_num - 1]
                has_text = page.get_text().strip()
            if has_text:
                with self._doc_lock:
                    page_obj = self.extract_page_digital(doc[page_num - 1], page_num, pdf_path, doc_id)
            else:
                page_obj = self.extract_page_scanned(pdf_path, page_num, doc_id)
        return page_obj

    def extract(self, pdf_path: str, strategy: Optional[str] = None) -> ExtractionResult:
        """
        Main extraction pipeline.
        
        Args:
            pdf_path: Path to the PDF file
            strategy: Grouping strategy - 'toc', 'heading', 'fixed', or None for all strategies
        """
        doc_id = str(uuid.uuid4())
        
        # Step 1: Detect PDF type
        pdf_type = self.detect_pdf_type(pdf_path)
        
        # Step 2: Extract pages based on PDF type
        pages = []
        
        if not PYMUPDF_AVAILABLE:
            raise RuntimeError("PyMuPDF is required for PDF extraction")
        
        doc = fitz.open(pdf_path)
        
        total_pages = len(doc)
        batch_size = self.batch_size
        pages = []
        
        with ThreadPoolExecutor(max_workers=batch_size) as executor:
            futures = {}
            for page_num in range(1, total_pages + 1):
                future = executor.submit(self._extract_single_page, page_num, doc, pdf_path, pdf_type, doc_id)
                futures[future] = page_num
            
            for future in as_completed(futures):
                page_num = futures[future]
                try:
                    page_obj = future.result()
                    pages.append(page_obj)
                    if len(pages) % batch_size == 0 or len(pages) == total_pages:
                        print(f"[Batch] Processed {len(pages)}/{total_pages} pages", file=sys.stderr)
                except Exception as e:
                    print(f"Error processing page {page_num}: {e}", file=sys.stderr)
        
        pages.sort(key=lambda p: p.page_number)
        
        # Step 3: Build grouping strategies based on parameter
        all_groups = []
        
        if strategy is None or strategy == 'hybrid' or strategy == 'all':
            # Build all 3 strategies (legacy behavior)
            print(f"Building all grouping strategies", file=sys.stderr)
            
            # TOC groups
            toc_groups = self.build_toc_groups(doc, pages, doc_id)
            all_groups.extend(toc_groups)
            
            # Heading groups
            heading_groups = self.build_heading_groups(pages, doc_id)
            all_groups.extend(heading_groups)
            
            # Fixed range groups
            fixed_groups = self.build_fixed_groups(pages, doc_id)
            all_groups.extend(fixed_groups)
            
        elif strategy == 'toc':
            # Only build TOC groups
            print(f"Building TOC grouping strategy only", file=sys.stderr)
            toc_groups = self.build_toc_groups(doc, pages, doc_id)
            all_groups.extend(toc_groups)
            
        elif strategy == 'heading':
            # Only build heading groups
            print(f"Building Heading grouping strategy only", file=sys.stderr)
            heading_groups = self.build_heading_groups(pages, doc_id)
            all_groups.extend(heading_groups)
            
        elif strategy == 'fixed':
            # Only build fixed groups
            print(f"Building Fixed grouping strategy only", file=sys.stderr)
            fixed_groups = self.build_fixed_groups(pages, doc_id)
            all_groups.extend(fixed_groups)
            
        else:
            # Unknown strategy, build all (fallback)
            print(f"Unknown strategy '{strategy}', building all strategies", file=sys.stderr)
            toc_groups = self.build_toc_groups(doc, pages, doc_id)
            all_groups.extend(toc_groups)
            heading_groups = self.build_heading_groups(pages, doc_id)
            all_groups.extend(heading_groups)
            fixed_groups = self.build_fixed_groups(pages, doc_id)
            all_groups.extend(fixed_groups)
        
        # Get metadata
        metadata = {
            "title": doc.metadata.get("title"),
            "author": doc.metadata.get("author"),
            "subject": doc.metadata.get("subject"),
            "creator": doc.metadata.get("creator"),
            "producer": doc.metadata.get("producer"),
            "creationDate": doc.metadata.get("creationDate"),
            "pageCount": len(doc)
        }
        
        # Get TOC for output
        toc_list = doc.get_toc()
        toc_items = []
        for item in toc_list:
            toc_items.append({
                "level": item[0],
                "title": item[1],
                "pageNumber": item[2]
            })
        
        doc.close()
        
        return ExtractionResult(
            doc_id=doc_id,
            pdf_type=pdf_type.value,
            metadata=metadata,
            pages=[asdict(p) for p in pages],
            groups=[asdict(g) for g in all_groups],
            toc=toc_items if toc_items else None
        )


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Extract content from PDF files')
    parser.add_argument('pdf_path', help='Path to PDF file')
    parser.add_argument('--output-dir', help='Output directory for extracted data')
    parser.add_argument('--strategy', 
                       choices=['toc', 'heading', 'fixed', 'hybrid', 'all'],
                       help='Grouping strategy: toc, heading, fixed, hybrid (all strategies), or all (same as hybrid)')
    parser.add_argument('--skip-tables', action='store_true',
                       help='Skip table extraction (MAJOR speedup - 5-10x faster)')
    parser.add_argument('--skip-images', action='store_true',
                       help='Skip image extraction and saving')
    parser.add_argument('--skip-ocr', action='store_true',
                       help='Skip OCR for scanned pages (3-5x faster for scanned PDFs)')
    parser.add_argument('--no-font-info', action='store_true',
                       help='Skip detailed font metadata extraction')
    parser.add_argument('--batch-size', type=int, default=4,
                       help='Number of pages to process in parallel (default: 4, max: 16)')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.pdf_path):
        print(f"Error: File not found: {args.pdf_path}", file=sys.stderr)
        sys.exit(1)
    
    # Create extractor with performance options
    extractor = PDFExtractor(
        output_dir=args.output_dir,
        save_images=not args.skip_images,
        skip_tables=args.skip_tables,
        skip_ocr=args.skip_ocr,
        extract_font_info=not args.no_font_info,
        batch_size=args.batch_size
    )
    
    try:
        print(f"Extracting PDF with options: tables={not args.skip_tables}, images={not args.skip_images}, ocr={not args.skip_ocr}", file=sys.stderr)
        result = extractor.extract(args.pdf_path, strategy=args.strategy)
        print(json.dumps(asdict(result), indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()