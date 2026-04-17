# ViDoRe Integration Draft

## Goal
Implement ViDoRe benchmark evaluation for the hybrid_search system. Benchmark only — no production pipeline changes.

## Architecture
- **ViDoRe Retriever**: Python class extending `BaseVisionRetriever`
- **Model**: kimi-latest (image description) + BGE-M3 (text embedding)
- **Granularity**: Page-level
- **use_visual_embedding**: True (tests full pipeline: PIL Image → kimi-latest description → BGE-M3 embedding)

## Key Design Decisions
1. **Text-based retriever** — uses existing pipeline, no new GPU model needed
2. **Benchmark only** — no TypeScript changes, pure Python addition
3. **Page-level** — aligns with ViDoRe's evaluation format
4. **Two evaluation modes**: visual (kimi-latest + BGE-M3) and text-only (BGE-M3 only) for comparison

## Files to Create
1. `test_hybrid/scripts/vidore_retriever.py` — BaseVisionRetriever implementation
2. `test_hybrid/scripts/run_vidore_eval.py` — Evaluation runner script

## Files to Modify
3. `test_hybrid/requirements.txt` — Add vidore-benchmark dependency
4. `test_hybrid/.env.example` — Add ViDoRe config vars

## ViDoRe Data Flow
```
ViDoRe Dataset (HuggingFace)
  → Evaluator loads queries (text) + passages (PIL Images or text)
  → forward_queries(queries) → BGE-M3 embed → query_embeddings
  → forward_passages(passages) → kimi-latest describe → BGE-M3 embed → passage_embeddings
  → get_scores(query_emb, passage_emb) → cosine similarity → scores matrix
  → compute_retrieval_scores(scores, qrels) → NDCG, MAP, Recall, MRR
```

## Open Questions
- Standard ViDoRe datasets only, or also custom PDF evaluation?
- Compare visual vs text-only retrieval modes?
