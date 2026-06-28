"""
agents/tools.py — CrewAI 에이전트가 사용하는 RAG 도구 모음

에이전트는 이 도구들을 통해 Qdrant에서 문서를 검색하고
Exo(Qwen 2.5 72B)로 답변을 생성합니다.
"""
import asyncio
import json
from typing import Optional
from crewai.tools import tool

from rag import search_documents, run_rag, get_embedding
from config import LLM_MODEL, EXO_BASE_URL, EXO_API_KEY


def _run_async(coro):
    """비동기 함수를 동기 컨텍스트에서 실행 (CrewAI는 동기)"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ──────────────────────────────────────────────
# Tool 1: RAG 검색 (컨텍스트 반환)
# ──────────────────────────────────────────────
@tool("문서 검색 (RAG Search)")
def rag_search_tool(query: str, collection_name: str = "default") -> str:
    """
    사내 문서 데이터베이스에서 질문과 관련된 내용을 검색합니다.
    반환값: 관련 문서 청크와 출처 정보 (JSON 형식)

    Args:
        query: 검색할 질문 또는 키워드
        collection_name: Qdrant 컬렉션 이름 (기본값: "default")
    """
    chunks = _run_async(search_documents(collection_name, query))

    if not chunks:
        return json.dumps({"status": "not_found", "results": []}, ensure_ascii=False)

    results = [
        {
            "source": c["source"],
            "page":   c.get("page", ""),
            "score":  round(c["score"], 3),
            "text":   c["text"][:500],  # 청크 미리보기
        }
        for c in chunks
    ]
    return json.dumps({"status": "found", "count": len(results), "results": results}, ensure_ascii=False, indent=2)


# ──────────────────────────────────────────────
# Tool 2: RAG 완전 파이프라인 (답변까지 생성)
# ──────────────────────────────────────────────
@tool("문서 기반 답변 생성 (RAG Answer)")
def rag_answer_tool(query: str, collection_name: str = "default") -> str:
    """
    문서를 검색하고 LLM(Qwen 2.5 72B)으로 한국어 답변을 생성합니다.
    검색 + 생성을 한 번에 실행합니다.

    Args:
        query: 질문
        collection_name: Qdrant 컬렉션 이름
    """
    result = _run_async(run_rag(collection_name=collection_name, query=query))
    answer = result.get("answer", "답변 생성 실패")
    citations = result.get("citations", [])

    if citations:
        sources = "\n".join(
            f"  - [{c['text']}] 유사도: {c.get('score', '')}"
            for c in citations[:5]
        )
        return f"{answer}\n\n📌 참고 문서:\n{sources}"
    return answer


# ──────────────────────────────────────────────
# Tool 3: 문서 분석 (온톨로지 메타데이터 추출)
# ──────────────────────────────────────────────
@tool("문서 분석 및 메타데이터 추출 (Document Analyze)")
def document_analyze_tool(text: str) -> str:
    """
    문서 텍스트를 분석하여 카테고리, 태그, 요약, 컨설팅 의견을 추출합니다.
    온톨로지 구축 및 문서 분류에 사용합니다.

    Args:
        text: 분석할 문서 텍스트 (최대 4000자)
    """
    from openai import OpenAI

    client = OpenAI(base_url=EXO_BASE_URL, api_key=EXO_API_KEY)

    system_prompt = """당신은 문서 온톨로지 구축을 돕는 전문 AI 어시스턴트입니다.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "category": "문서 카테고리 (정책/재무/기술/법률/인사/연구 등)",
  "tags": ["태그1", "태그2", "태그3"],
  "summary": "문서 내용 2-3줄 요약",
  "consulting": "이 문서를 온톨로지에 통합할 때 고려할 점과 추천사항"
}"""

    truncated = text[:4000] if len(text) > 4000 else text

    try:
        resp = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"다음 문서를 분석하세요:\n\n{truncated}"},
            ],
            temperature=0.2,
            max_tokens=512,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return json.dumps({
            "category": "",
            "tags": [],
            "summary": "",
            "consulting": f"분석 실패: {str(e)}",
        }, ensure_ascii=False)


# ──────────────────────────────────────────────
# Tool 4: 컬렉션 목록 조회
# ──────────────────────────────────────────────
@tool("컬렉션 목록 조회 (List Collections)")
def list_collections_tool(dummy: str = "") -> str:
    """
    Qdrant에 존재하는 모든 컬렉션 목록을 조회합니다.
    어떤 컬렉션이 있는지 확인할 때 사용합니다.

    Args:
        dummy: 사용 안 함 (CrewAI tool 형식 요구사항)
    """
    from qdrant_client import QdrantClient
    from config import QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY

    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, api_key=QDRANT_API_KEY)
    collections = client.get_collections().collections
    result = [
        {"name": c.name, "status": str(c.status)}
        for c in collections
    ]
    return json.dumps({"collections": result, "total": len(result)}, ensure_ascii=False, indent=2)
