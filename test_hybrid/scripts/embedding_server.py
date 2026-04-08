#!/usr/bin/env python3
"""
BGE-M3 Embedding Server using FlagEmbedding

Provides both dense and sparse embeddings via a local server.
Uses the official FlagEmbedding library for best results.

Usage:
    python embedding_server.py

Requirements:
    pip install fastapi uvicorn FlagEmbedding torch
"""

import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Any, Optional, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
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

# Load .env before initializing
load_env_file()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="BGE-M3 Embedding Server",
    description="Generate dense and sparse embeddings using BGE-M3 via FlagEmbedding",
    version="1.0.0",
)

# Embedding model configuration - ALL values from .env file
# Required: EMBEDDING_MODEL, EMBEDDING_DEVICE
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "")
if not EMBEDDING_MODEL:
    logger.error("EMBEDDING_MODEL not set in .env file")
    EMBEDDING_MODEL = "BAAI/bge-m3"  # Fallback only

EMBEDDING_DEVICE = os.environ.get("EMBEDDING_DEVICE", "")
if not EMBEDDING_DEVICE:
    logger.error("EMBEDDING_DEVICE not set in .env file")
    EMBEDDING_DEVICE = "cpu"  # Fallback only

EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))

# Log configuration
logger.info(f"Embedding model: {EMBEDDING_MODEL}")
logger.info(f"Embedding device: {EMBEDDING_DEVICE}")
logger.info(f"Embedding dimensions: {EMBEDDING_DIMENSIONS}")

# Global model instance
model = None

def get_model():
    """Lazy load the embedding model."""
    global model
    if model is None:
        try:
            from FlagEmbedding import BGEM3FlagModel
            logger.info(f"Loading embedding model: {EMBEDDING_MODEL}...")
            model = BGEM3FlagModel(
                EMBEDDING_MODEL,
                use_fp16=True,  # Speed up computation
                device=EMBEDDING_DEVICE
            )
            logger.info(f"Model loaded successfully on {EMBEDDING_DEVICE}")
        except ImportError:
            logger.error("FlagEmbedding not installed. Run: pip install FlagEmbedding")
            raise
    return model


# Request/Response Models

class EmbedRequest(BaseModel):
    """Request model for embedding generation."""
    texts: List[str]
    return_dense: bool = True
    return_sparse: bool = False
    return_colbert_vecs: bool = False
    batch_size: int = 12
    max_length: int = 8192


class DenseEmbeddingResponse(BaseModel):
    """Response model for dense embeddings."""
    embeddings: List[List[float]]
    model: str
    dimensions: int


class SparseEmbeddingResponse(BaseModel):
    """Response model for sparse embeddings."""
    lexical_weights: List[Dict[str, float]]
    model: str


class FullEmbeddingResponse(BaseModel):
    """Response model for full embedding output."""
    dense_vecs: Optional[List[List[float]]] = None
    lexical_weights: Optional[List[Dict[str, float]]] = None
    colbert_vecs: Optional[List[List[List[float]]]] = None
    model: str
    dimensions: int


class HealthResponse(BaseModel):
    """Response model for health endpoint."""
    status: str
    version: str
    model: str
    device: str


class LexicalMatchRequest(BaseModel):
    """Request model for lexical matching score."""
    weights_1: Dict[str, float]
    weights_2: Dict[str, float]


class LexicalMatchResponse(BaseModel):
    """Response model for lexical matching score."""
    score: float


# API Endpoints

@app.get("/", response_model=HealthResponse)
async def root():
    """Root endpoint - returns server status."""
    m = get_model()
    device = "cuda" if hasattr(m, 'device') and str(m.device).startswith('cuda') else "cpu"
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        model=EMBEDDING_MODEL,
        device=device,
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    m = get_model()
    device = "cuda" if hasattr(m, 'device') and str(m.device).startswith('cuda') else "cpu"
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        model=EMBEDDING_MODEL,
        device=device,
    )


@app.post("/embed", response_model=DenseEmbeddingResponse)
async def embed_texts(request: EmbedRequest):
    """
    Generate dense embeddings for a list of texts.
    
    This is the main endpoint for semantic search embeddings.
    Returns 1024-dimensional dense vectors.
    """
    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")
    
    try:
        m = get_model()
        
        # Generate embeddings
        output = m.encode(
            request.texts,
            batch_size=request.batch_size,
            max_length=request.max_length,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
        )
        
        # Convert to list for JSON serialization
        dense_vecs = output['dense_vecs']
        if isinstance(dense_vecs, np.ndarray):
            embeddings = dense_vecs.tolist()
        else:
            embeddings = [v.tolist() if isinstance(v, np.ndarray) else v for v in dense_vecs]
        
        return DenseEmbeddingResponse(
            embeddings=embeddings,
            model=EMBEDDING_MODEL,
            dimensions=len(embeddings[0]) if embeddings else EMBEDDING_DIMENSIONS,
        )
        
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed/sparse", response_model=SparseEmbeddingResponse)
async def embed_sparse(request: EmbedRequest):
    """
    Generate sparse embeddings (lexical weights) for a list of texts.
    
    Useful for BM25-like lexical matching.
    Returns token-level weights for each document.
    """
    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")
    
    try:
        m = get_model()
        
        # Generate sparse embeddings
        output = m.encode(
            request.texts,
            batch_size=request.batch_size,
            max_length=request.max_length,
            return_dense=False,
            return_sparse=True,
            return_colbert_vecs=False,
        )
        
        # Convert lexical weights to token format
        lexical_weights = m.convert_id_to_token(output['lexical_weights'])
        
        return SparseEmbeddingResponse(
            lexical_weights=lexical_weights,
            model=EMBEDDING_MODEL,
        )
        
    except Exception as e:
        logger.error(f"Sparse embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed/full", response_model=FullEmbeddingResponse)
async def embed_full(request: EmbedRequest):
    """
    Generate all types of embeddings (dense, sparse, colbert).
    
    This endpoint returns all available embedding types.
    """
    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")
    
    try:
        m = get_model()
        
        # Generate all embeddings
        output = m.encode(
            request.texts,
            batch_size=request.batch_size,
            max_length=request.max_length,
            return_dense=request.return_dense,
            return_sparse=request.return_sparse,
            return_colbert_vecs=request.return_colbert_vecs,
        )
        
        response = FullEmbeddingResponse(
            model=EMBEDDING_MODEL,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        
        if request.return_dense and 'dense_vecs' in output:
            dense = output['dense_vecs']
            if isinstance(dense, np.ndarray):
                response.dense_vecs = dense.tolist()
            else:
                response.dense_vecs = [v.tolist() if isinstance(v, np.ndarray) else v for v in dense]
        
        if request.return_sparse and 'lexical_weights' in output:
            response.lexical_weights = m.convert_id_to_token(output['lexical_weights'])
        
        if request.return_colbert_vecs and 'colbert_vecs' in output:
            colbert = output['colbert_vecs']
            if isinstance(colbert, np.ndarray):
                response.colbert_vecs = colbert.tolist()
            else:
                response.colbert_vecs = [[v.tolist() if isinstance(v, np.ndarray) else v for v in vecs] for vecs in colbert]
        
        return response
        
    except Exception as e:
        logger.error(f"Full embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/lexical-match", response_model=LexicalMatchResponse)
async def compute_lexical_match(request: LexicalMatchRequest):
    """
    Compute lexical matching score between two documents.
    
    Uses the sparse lexical weights to compute similarity.
    """
    try:
        m = get_model()
        
        # Convert token weights back to ID format for the model
        # Note: This requires the model's tokenizer
        score = m.compute_lexical_matching_score(
            request.weights_1,
            request.weights_2
        )
        
        return LexicalMatchResponse(score=float(score))
        
    except Exception as e:
        logger.error(f"Lexical matching error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="BGE-M3 Embedding Server")
    parser.add_argument("--host", type=str, default="localhost", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8002, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    parser.add_argument("--device", type=str, default="cpu", help="Device to use (cpu/cuda)")
    args = parser.parse_args()
    
    # Pre-load model at startup
    logger.info("Pre-loading BGE-M3 model...")
    get_model()
    logger.info("Model ready!")
    
    import uvicorn
    uvicorn.run(
        "embedding_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )