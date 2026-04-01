#!/usr/bin/env python3
"""
BGE-M3 Embedding Server

A FastAPI server that runs BGE-M3 locally and exposes it as an HTTP endpoint.
This provides high-quality embeddings without relying on external APIs.

Usage:
    python embedding_server.py

Requirements:
    pip install fastapi uvicorn sentence-transformers torch

The server will be available at http://localhost:8000
"""

import json
import logging
from typing import List, Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="BGE-M3 Embedding Server",
    description="Local embedding server using BAAI/bge-m3 model",
    version="1.0.0",
)

# Global model variable
model: Optional[SentenceTransformer] = None


class EmbedRequest(BaseModel):
    """Request model for embedding endpoint."""
    texts: List[str]
    normalize: bool = True


class EmbedResponse(BaseModel):
    """Response model for embedding endpoint."""
    embeddings: List[List[float]]
    dimensions: int
    model: str
    count: int


class HealthResponse(BaseModel):
    """Response model for health endpoint."""
    status: str
    model: str
    dimensions: int
    device: str


@app.on_event("startup")
async def load_model():
    """Load the BGE-M3 model on startup."""
    global model
    
    logger.info("Loading BGE-M3 model...")
    
    # Determine device
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info(f"Using device: {device}")
    
    # Load the model
    model = SentenceTransformer(
        "BAAI/bge-m3",
        device=device,
        trust_remote_code=True,
    )
    
    logger.info(f"Model loaded successfully. Dimensions: {model.get_sentence_embedding_dimension()}")


@app.get("/", response_model=HealthResponse)
async def root():
    """Root endpoint - returns server status."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    return HealthResponse(
        status="healthy",
        model="BAAI/bge-m3",
        dimensions=model.get_sentence_embedding_dimension(),
        device=str(model.device),
    )


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    return HealthResponse(
        status="healthy",
        model="BAAI/bge-m3",
        dimensions=model.get_sentence_embedding_dimension(),
        device=str(model.device),
    )


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    """
    Generate embeddings for a list of texts.
    
    Args:
        request: EmbedRequest with texts to embed
        
    Returns:
        EmbedResponse with embeddings and metadata
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")
    
    try:
        # Generate embeddings
        embeddings = model.encode(
            request.texts,
            normalize_embeddings=request.normalize,
            show_progress_bar=False,
        )
        
        # Convert to list
        embeddings_list = embeddings.tolist()
        
        return EmbedResponse(
            embeddings=embeddings_list,
            dimensions=len(embeddings_list[0]),
            model="BAAI/bge-m3",
            count=len(embeddings_list),
        )
        
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embeddings", response_model=EmbedResponse)
async def embeddings(request: EmbedRequest):
    """
    Alternative endpoint matching OpenAI's API naming convention.
    """
    return await embed(request)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="BGE-M3 Embedding Server")
    parser.add_argument("--host", type=str, default="localhost", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()
    
    import uvicorn
    uvicorn.run(
        "embedding_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )