#!/usr/bin/env python3
"""
Cross-Encoder Reranker Server using SentenceTransformers

Provides reranking scores using cross-encoder models.
Uses SentenceTransformers for best results.

Usage:
    python reranker_server.py

Requirements:
    pip install fastapi uvicorn sentence-transformers torch
"""

import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

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
    title="Cross-Encoder Reranker Server",
    description="Rerank documents using cross-encoder models via SentenceTransformers",
    version="1.0.0",
)

# Reranker model configuration from .env
RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L6-v2")
RERANKER_DEVICE = os.environ.get("EMBEDDING_DEVICE", "cpu")  # Reuse same device setting

# Log configuration
logger.info(f"Reranker model: {RERANKER_MODEL}")
logger.info(f"Reranker device: {RERANKER_DEVICE}")

# Global model instance
model = None

def get_model():
    """Lazy load the cross-encoder model."""
    global model
    if model is None:
        try:
            from sentence_transformers import CrossEncoder
            logger.info(f"Loading cross-encoder model: {RERANKER_MODEL}...")
            model = CrossEncoder(RERANKER_MODEL, max_length=512, device=RERANKER_DEVICE)
            logger.info(f"Model loaded successfully on {RERANKER_DEVICE}")
        except ImportError:
            logger.error("sentence-transformers not installed. Run: pip install sentence-transformers")
            raise
    return model


# Request/Response Models

class RerankRequest(BaseModel):
    """Request model for reranking."""
    query: str
    documents: List[str]
    top_k: Optional[int] = None


class RerankResult(BaseModel):
    """Single rerank result."""
    index: int
    score: float
    text: str


class RerankResponse(BaseModel):
    """Response model for reranking."""
    results: List[RerankResult]
    model: str


class ScorePairsRequest(BaseModel):
    """Request model for scoring query-document pairs."""
    pairs: List[Tuple[str, str]]


class ScorePairsResponse(BaseModel):
    """Response model for scoring pairs."""
    scores: List[float]
    model: str


class HealthResponse(BaseModel):
    """Response model for health endpoint."""
    status: str
    version: str
    model: str
    device: str


# API Endpoints

@app.get("/", response_model=HealthResponse)
async def root():
    """Root endpoint - returns server status."""
    m = get_model()
    device = str(getattr(m, 'device', RERANKER_DEVICE))
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        model=RERANKER_MODEL,
        device=device,
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    m = get_model()
    device = str(getattr(m, 'device', RERANKER_DEVICE))
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        model=RERANKER_MODEL,
        device=device,
    )


@app.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest):
    """
    Rerank documents based on relevance to query.
    
    Returns documents sorted by relevance score (highest first).
    """
    if not request.query:
        raise HTTPException(status_code=400, detail="Query is required")
    if not request.documents:
        raise HTTPException(status_code=400, detail="Documents are required")
    
    try:
        m = get_model()
        
        # Create query-document pairs
        pairs = [(request.query, doc) for doc in request.documents]
        
        # Get scores from cross-encoder
        scores = m.predict(pairs)
        
        # Convert to list if numpy array
        if isinstance(scores, np.ndarray):
            scores = scores.tolist()
        
        # Create results with indices
        results = [
            RerankResult(index=i, score=scores[i], text=request.documents[i])
            for i in range(len(request.documents))
        ]
        
        # Sort by score descending
        results.sort(key=lambda x: x.score, reverse=True)
        
        # Apply top_k if specified
        if request.top_k is not None:
            results = results[:request.top_k]
        
        return RerankResponse(
            results=results,
            model=RERANKER_MODEL,
        )
        
    except Exception as e:
        logger.error(f"Reranking error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/score", response_model=ScorePairsResponse)
async def score_pairs(request: ScorePairsRequest):
    """
    Score query-document pairs.
    
    Each pair is a tuple of (query, document).
    Returns a relevance score for each pair.
    """
    if not request.pairs:
        raise HTTPException(status_code=400, detail="Pairs are required")
    
    try:
        m = get_model()
        
        # Get scores from cross-encoder
        scores = m.predict(request.pairs)
        
        # Convert to list if numpy array
        if isinstance(scores, np.ndarray):
            scores = scores.tolist()
        
        return ScorePairsResponse(
            scores=scores,
            model=RERANKER_MODEL,
        )
        
    except Exception as e:
        logger.error(f"Scoring error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Cross-Encoder Reranker Server")
    parser.add_argument("--host", type=str, default="localhost", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8003, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()
    
    # Pre-load model at startup
    logger.info("Pre-loading cross-encoder model...")
    get_model()
    logger.info("Model ready!")
    
    import uvicorn
    uvicorn.run(
        "reranker_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )