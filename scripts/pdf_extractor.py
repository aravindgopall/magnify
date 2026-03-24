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
    def __init__(self, output_dir: Optional[str] = None, save_images: bool = True):
        self.output_dir = output_dir or tempfile.mkdtemp()
        self.save_images = save_images
        self.images_dir = os.path.join(self.output_dir, "images")
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
        
        # Extract text blocks with font info
        text_blocks = self.extract_text_blocks(page)
        
        # Extract tables (camelot first, pdfplumber fallback)
        tables = self.extract_tables_camelot(pdf_path, page_number)
        if not tables:
            tables = self.extract_tables_pdfplumber(pdf_path, page_number)
        
        # Extract images
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
                    
                    # Try table detection with pdfplumber
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
            
            # Find end page (start of next item - 1)
            if i < len(toc) - 1:
                end_page = toc[i + 1][2] - 1
            else:
                end_page = len(pages)
            
            # Gather pages for this group
            group_pages = [p for p in pages if start_page <= p.page_number <= end_page]
            
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
        
        return groups
    
    def build_heading_groups(self, pages: List[PageObject], doc_id: str) -> List[GroupObject]:
        """Build groups based on detected headings (bold or large font)."""
        groups = []
        headings = []  # List of (page_number, title)
        
        # Find all headings
        for page in pages:
            for block in page.text_blocks:
                # Heading criteria: bold OR font_size >= 14
                if block.get("is_bold") or block.get("font_size", 0) >= 14:
                    text = block.get("text", "").strip()
                    if text and len(text) < 100:  # Headings are usually short
                        headings.append((page.page_number, text))
        
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
        
        # Build groups from headings
        for i, (page_num, title) in enumerate(headings):
            # Find end page
            if i < len(headings) - 1:
                end_page = headings[i + 1][0] - 1
            else:
                end_page = len(pages)
            
            # Gather pages for this group
            group_pages = [p for p in pages if page_num <= p.page_number <= end_page]
            
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
        
        return groups
    
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
    
    def extract(self, pdf_path: str) -> ExtractionResult:
        """Main extraction pipeline."""
        doc_id = str(uuid.uuid4())
        
        # Step 1: Detect PDF type
        pdf_type = self.detect_pdf_type(pdf_path)
        
        # Step 2: Extract pages based on PDF type
        pages = []
        
        if not PYMUPDF_AVAILABLE:
            raise RuntimeError("PyMuPDF is required for PDF extraction")
        
        doc = fitz.open(pdf_path)
        
        for page_num in range(1, len(doc) + 1):
            if pdf_type == PDFType.DIGITAL:
                page_obj = self.extract_page_digital(doc[page_num - 1], page_num, pdf_path, doc_id)
            elif pdf_type == PDFType.SCANNED:
                page_obj = self.extract_page_scanned(pdf_path, page_num, doc_id)
            else:  # HYBRID
                # Check if this specific page has text
                page = doc[page_num - 1]
                if page.get_text().strip():
                    page_obj = self.extract_page_digital(page, page_num, pdf_path, doc_id)
                else:
                    page_obj = self.extract_page_scanned(pdf_path, page_num, doc_id)
            
            pages.append(page_obj)
        
        # Step 3: Build all 3 grouping strategies
        all_groups = []
        
        # TOC groups
        toc_groups = self.build_toc_groups(doc, pages, doc_id)
        all_groups.extend(toc_groups)
        
        # Heading groups
        heading_groups = self.build_heading_groups(pages, doc_id)
        all_groups.extend(heading_groups)
        
        # Fixed range groups
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
    if len(sys.argv) < 2:
        print("Usage: python pdf_extractor.py <pdf_path> [output_dir]", file=sys.stderr)
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not os.path.exists(pdf_path):
        print(f"Error: File not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)
    
    extractor = PDFExtractor(output_dir=output_dir)
    
    try:
        result = extractor.extract(pdf_path)
        print(json.dumps(asdict(result), indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()