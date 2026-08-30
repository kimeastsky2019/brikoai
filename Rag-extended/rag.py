"""
rag.py — Qdrant + BGE-M3 + LLM Router RAG 파이프라인
[REPLACED] xai_sdk → openai (OpenAI-compatible)
[REPLACED] Grok Collections → Qdrant vector search
[REPLACED] Grok Embeddings → BGE-M3 via Ollama
[ADDED]    Circuit Breaker + 하이브리드 폴백 (Exo → Grok → Claude)
"""
import asyncio
import logging
import time
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Filter, FieldCondition, MatchValue, MatchAny,
    IsEmptyCondition, PayloadField,
    Prefetch, FusionQuery, Fusion, SparseVector,
)

from config import (
    QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY,
    TOP_K, SYSTEM_GUARDRAIL,
    HYBRID_SEARCH, SPARSE_VECTOR_NAME, DENSE_VECTOR_NAME, RRF_PREFETCH,
)
from embeddings import embed_async
from sparse import sparse_embed_query
import contract
# LLM은 직접 호출 대신 라우터 경유
from llm_router import router as llm_router

logger = logging.getLogger(__name__)

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
# Embedding — provider 는 embeddings.py 가 결정 (fastembed | ollama)
# ──────────────────────────────────────────────
async def get_embedding(text: str) -> list[float]:
    return await embed_async(text)


# ──────────────────────────────────────────────
# Vector Search (Qdrant)
# ──────────────────────────────────────────────
async def _is_hybrid(collection_name: str) -> bool:
    """컬렉션이 명명 밀집 벡터 + 스파스 벡터 스키마인지 (구 컬렉션은 아님)."""
    try:
        info = await get_qdrant_client().get_collection(collection_name)
        params = info.config.params
        vectors = params.vectors
        has_dense = isinstance(vectors, dict) and DENSE_VECTOR_NAME in vectors
        sparse = getattr(params, "sparse_vectors", None) or {}
        return bool(has_dense and SPARSE_VECTOR_NAME in sparse)
    except Exception:
        return False


def _build_filter(filters: dict | None, viewer_acl: str | None) -> Filter | None:
    """
    메타데이터 필터 + ACL 게이트.

    ACL 은 호출자가 끌 수 없다 — 권한 밖 문서는 검색 결과에서 아예 빠져야 하며,
    "찾았지만 못 보여준다"는 존재 자체를 노출하므로 필터 단계에서 제외한다.
    """
    must: list = []
    if filters:
        must += [
            FieldCondition(key=k, match=MatchValue(value=v))
            for k, v in filters.items()
            if v is not None
        ]

    if viewer_acl is not None:
        allowed = contract.readable_acls(viewer_acl)
        # acl 키가 없는 구(舊) 청크는 계약 이전 데이터다. PUBLIC 열람자에게는
        # 보이지 않도록 INTERNAL 취급하고, 그 이상 등급에게만 통과시킨다.
        legacy_ok = contract.acl_rank(viewer_acl) >= contract.acl_rank("INTERNAL")
        acl_clause = [FieldCondition(key="acl", match=MatchAny(any=allowed))]
        if legacy_ok:
            acl_clause.append(IsEmptyCondition(is_empty=PayloadField(key="acl")))
        must.append(Filter(should=acl_clause))

    return Filter(must=must) if must else None


async def search_documents(
    collection_name: str,
    query: str,
    filters: dict | None = None,
    top_k: int = TOP_K,
    viewer_acl: str | None = None,
) -> list[dict]:
    """
    하이브리드 검색: BM25(정확한 표기) + 밀집 벡터(의미 유사) → RRF 융합.

    한쪽만 쓰면 각각의 약점이 그대로 드러난다. BM25 는 `MB-300` 같은 품번을
    정확히 잡지만 표현이 다르면 놓치고, 밀집 벡터는 그 반대다.
    RRF 는 두 랭킹의 순위만으로 섞으므로 점수 스케일을 맞출 필요가 없다.

    스파스 벡터가 없는 구 컬렉션에서는 밀집 검색으로 자동 폴백한다.
    """
    qdrant = get_qdrant_client()
    qdrant_filter = _build_filter(filters, viewer_acl)
    query_vector = await get_embedding(query)

    hybrid = HYBRID_SEARCH and await _is_hybrid(collection_name)
    sparse_q = sparse_embed_query(query) if hybrid else None

    if hybrid and sparse_q:
        indices, values = sparse_q
        resp = await qdrant.query_points(
            collection_name=collection_name,
            prefetch=[
                Prefetch(query=query_vector, using=DENSE_VECTOR_NAME, limit=RRF_PREFETCH,
                         filter=qdrant_filter),
                Prefetch(query=SparseVector(indices=indices, values=values),
                         using=SPARSE_VECTOR_NAME, limit=RRF_PREFETCH,
                         filter=qdrant_filter),
            ],
            query=FusionQuery(fusion=Fusion.RRF),
            limit=top_k,
            with_payload=True,
        )
        retrieval = "hybrid_rrf"
    else:
        resp = await qdrant.query_points(
            collection_name=collection_name,
            query=query_vector,
            using=DENSE_VECTOR_NAME if hybrid else None,
            limit=top_k,
            query_filter=qdrant_filter,
            with_payload=True,
        )
        retrieval = "dense"

    results = []
    for hit in resp.points:
        payload = hit.payload or {}
        span = {
            "section_no":    payload.get("section_no"),
            "section_title": payload.get("section_title"),
            "start_line":    payload.get("start_line"),
            "end_line":      payload.get("end_line"),
        }
        results.append({
            "text":      payload.get("text", ""),
            "source":    payload.get("source", ""),
            "page":      payload.get("page", ""),
            "score":     hit.score,
            "retrieval": retrieval,
            "stable_id": payload.get("stable_id"),
            "version":   payload.get("version"),
            "sha256":    payload.get("sha256"),
            "acl":       payload.get("acl"),
            "span":      span,
            "citation":  (
                contract.format_citation(
                    payload["stable_id"], payload.get("version", 1),
                    payload.get("sha256"), span,
                )
                if payload.get("stable_id") else ""
            ),
            "metadata": {k: v for k, v in payload.items() if k != "text"},
        })
    return results


# ──────────────────────────────────────────────
# RAG Pipeline
# ──────────────────────────────────────────────
async def search_many(
    collection_names: list[str],
    query: str,
    filters: dict | None = None,
    top_k: int = TOP_K,
    viewer_acl: str | None = None,
) -> list[dict]:
    """여러 컬렉션을 한 번에 검색해 점수 순으로 합친다.

    보고서를 사업장별 컬렉션으로 나눈 뒤로 "화학 분야 보고서" 처럼 여러 사업장을
    가로지르는 질문을 할 수가 없었다. 컬렉션을 하나 고르게 하는 대신, 전부 뒤져
    점수로 줄 세운다.

    컬렉션마다 top_k 를 받아 합친 뒤 다시 상위 top_k 만 남긴다 — 한 보고서가
    상위를 독식하지 않게 하면서도 근거 개수는 단일 검색과 같게 유지한다.
    """
    tasks = [
        search_documents(name, query, filters, top_k=top_k, viewer_acl=viewer_acl)
        for name in collection_names
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    merged: list[dict] = []
    for name, res in zip(collection_names, results):
        # 컬렉션 하나가 죽어도 나머지 결과는 살린다 — 전부 실패해야 빈 손이다.
        if isinstance(res, Exception):
            logger.warning("컬렉션 검색 실패 %s: %s", name, res)
            continue
        for hit in res:
            hit["collection"] = name
            merged.append(hit)

    merged.sort(key=lambda h: h.get("score", 0.0), reverse=True)
    return merged[:top_k]


async def run_rag(
    collection_name: str,
    query: str,
    filters: dict | None = None,
    # Legacy compat: 구 app.py는 collection_id 키워드를 썼음
    collection_id: str | None = None,
    client=None,  # 무시 (Exo client는 내부 singleton)
    viewer_acl: str | None = None,
    collection_names: list[str] | None = None,   # 주면 전체 검색
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

    # 1. 검색 (ACL 게이트 포함)
    if collection_names:
        chunks = await search_many(collection_names, query, filters, viewer_acl=viewer_acl)
    else:
        chunks = await search_documents(collection_name, query, filters, viewer_acl=viewer_acl)

    if not chunks:
        return {
            "answer":    "제공된 문서 근거로는 확인할 수 없습니다.",
            "citations": [],
            "latency_ms": int((time.time() - t0) * 1000),
            "usage": {},
        }

    # 2. 컨텍스트 빌드 — 계약 인용 표기가 있으면 그것을 앞세운다.
    context_parts = []
    for i, chunk in enumerate(chunks):
        if chunk.get("citation"):
            head = chunk["citation"]
            title = chunk["span"].get("section_title")
            if title:
                head += f" {title}"
        else:
            head = f"[{chunk['source']}]" if chunk["source"] else f"[문서 {i+1}]"
            if chunk.get("page"):
                head += f" p.{chunk['page']}"
        context_parts.append(f"{head}\n{chunk['text']}")
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
            "text":      chunk["source"],
            "page":      chunk.get("page", ""),
            "score":     round(chunk["score"], 3),
            # 계약 필드 — 나중에 "그때 그 문서"를 재현하기 위한 좌표
            "stable_id": chunk.get("stable_id"),
            "version":   chunk.get("version"),
            "sha256":    chunk.get("sha256"),
            "span":      chunk.get("span"),
            "citation":  chunk.get("citation", ""),
        }
        for chunk in chunks if chunk.get("source")
    ]

    return {
        "answer":    answer,
        "citations": citations,
        "latency_ms": int((time.time() - t0) * 1000),
        "provider":  result.get("provider", "unknown"),  # 어떤 LLM이 응답했는지
        "retrieval": chunks[0].get("retrieval", "dense"),
        "usage":     result.get("usage", {}),
    }
