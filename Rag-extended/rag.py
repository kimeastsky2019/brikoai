"""
rag.py — Qdrant + BGE-M3 + LLM Router RAG 파이프라인
[REPLACED] xai_sdk → openai (OpenAI-compatible)
[REPLACED] Grok Collections → Qdrant vector search
[REPLACED] Grok Embeddings → BGE-M3 via Ollama
[ADDED]    Circuit Breaker + 하이브리드 폴백 (Exo → Grok → Claude)
"""
import time
import httpx
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

from config import (
    OLLAMA_BASE_URL, EMBED_MODEL,
    QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY,
    TOP_K, SYSTEM_GUARDRAIL,
)
# LLM은 직접 호출 대신 라우터 경유
from llm_router import router as llm_router

# ──────────────────────────────────────────────
# Singleton Qdrant client (앱 수명 주기 동안 재사용)
# ──────────────────────────────────────────────
_qdrant_client: AsyncQdrantClient | None = None


def get_qdrant_client() -> AsyncQdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = AsyncQdrantClient(
            host=QDRANT_HOST,
            port=QDRANT_PORT,
            api_key=QDRANT_API_KEY,
        )
    return _qdrant_client


# ──────────────────────────────────────────────
# Embedding via Ollama (BGE-M3)
# ──────────────────────────────────────────────
async def get_embedding(text: str) -> list[float]:
    """BGE-M3 임베딩 — 한/영/중 다국어 1024-dim"""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


# ──────────────────────────────────────────────
# Vector Search (Qdrant)
# ──────────────────────────────────────────────
async def search_documents(
    collection_name: str,
    query: str,
    filters: dict | None = None,
    top_k: int = TOP_K,
) -> list[dict]:
    """Qdrant 벡터 검색 — 메타데이터 필터 지원"""
    query_vector = await get_embedding(query)
    qdrant = get_qdrant_client()

    # 필터 조건 빌드
    qdrant_filter = None
    if filters:
        conditions = [
            FieldCondition(key=k, match=MatchValue(value=v))
            for k, v in filters.items()
            if v is not None
        ]
        if conditions:
            qdrant_filter = Filter(must=conditions)

    # qdrant-client 1.12+ 에서 .search() 가 제거되어 query_points() 를 사용합니다.
    # 반환 타입도 list 가 아닌 QueryResponse 이므로 .points 로 꺼냅니다.
    resp = await qdrant.query_points(
        collection_name=collection_name,
        query=query_vector,
        limit=top_k,
        query_filter=qdrant_filter,
        with_payload=True,
    )
    hits = resp.points

    return [
        {
            "text":   hit.payload.get("text", ""),
            "source": hit.payload.get("source", ""),
            "page":   hit.payload.get("page", ""),
            "score":  hit.score,
            "metadata": {k: v for k, v in hit.payload.items() if k != "text"},
        }
        for hit in hits
    ]


# ──────────────────────────────────────────────
# RAG Pipeline
# ──────────────────────────────────────────────
async def run_rag(
    collection_name: str,
    query: str,
    filters: dict | None = None,
    # Legacy compat: 구 app.py는 collection_id 키워드를 썼음
    collection_id: str | None = None,
    client=None,  # 무시 (Exo client는 내부 singleton)
) -> dict:
    """
    RAG 3-step: embed → search → generate

    Args:
        collection_name: Qdrant 컬렉션 이름 (= 구 xai_id 필드)
        query: 사용자 질문
        filters: 메타데이터 필터 dict (category, tags 등)
    """
    # Legacy: collection_id → collection_name 폴백
    if collection_id and not collection_name:
        collection_name = collection_id

    t0 = time.time()

    # 1. 검색
    chunks = await search_documents(collection_name, query, filters)

    if not chunks:
        return {
            "answer":    "제공된 문서 근거로는 확인할 수 없습니다.",
            "citations": [],
            "latency_ms": int((time.time() - t0) * 1000),
            "usage": {},
        }

    # 2. 컨텍스트 빌드
    context_parts = []
    for i, chunk in enumerate(chunks):
        src = f"[{chunk['source']}]" if chunk["source"] else f"[문서 {i+1}]"
        page = f" p.{chunk['page']}" if chunk.get("page") else ""
        context_parts.append(f"{src}{page}\n{chunk['text']}")
    context = "\n\n---\n\n".join(context_parts)

    # 필터 안내 추가
    filter_note = ""
    if filters:
        parts = [f"{k}={v}" for k, v in filters.items() if v]
        if parts:
            filter_note = f"\n필터 조건: {', '.join(parts)}"

    # 3. LLM 생성 — Circuit Breaker 라우터 경유
    #    우선순위: Exo(로컬) → Grok(xAI) → Claude(Anthropic)
    system_msg = SYSTEM_GUARDRAIL + filter_note
    user_msg = (
        f"다음은 검색된 문서 컨텍스트입니다:\n\n{context}"
        f"\n\n질문: {query}"
    )

    result = await llm_router.complete(
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ],
        temperature=0.1,
        max_tokens=1024,
    )

    answer = result["content"].strip() or "제공된 문서 근거로는 확인할 수 없습니다."

    citations = [
        {
            "text":  chunk["source"],
            "page":  chunk.get("page", ""),
            "score": round(chunk["score"], 3),
        }
        for chunk in chunks if chunk.get("source")
    ]

    return {
        "answer":    answer,
        "citations": citations,
        "latency_ms": int((time.time() - t0) * 1000),
        "provider":  result.get("provider", "unknown"),  # 어떤 LLM이 응답했는지
        "usage":     result.get("usage", {}),
    }
