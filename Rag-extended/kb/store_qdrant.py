"""4채널 청크 → Qdrant 적재.

`kb/ingest.py` 의 `ingest()` 는 xAI Grok Collections 를 전제로 쓰여 있다
(`mgmt_client.collections.upload_document`). 이 앱은 그 뒤 Qdrant + BGE-M3 로
이전했으므로 그 경로는 여기서 동작하지 않는다. 같은 규칙을 Qdrant 위에서 다시 세운다.

바꾸지 않은 것이 셋 있다.

1. **게이트를 우회하지 않는다.** 적재는 `analyze()` 가 `upload_allowed=True` 를
   준 뒤에만 일어난다. 이 모듈에 "그냥 올리기" 인자는 없다.
2. **채널을 유지한다.** 표는 표 단위로 한 점(point)에 넣는다. 행을 쪼개면
   "어느 행 어느 열의 값인가" 가 사라져 표를 파싱한 의미가 없어진다.
3. **업종이 컬렉션을 가른다.** 원단위 분모가 업종마다 달라 섞으면 비교가 깨진다.

기존 `ingest.py` 의 임베딩·컬렉션 헬퍼를 그대로 쓴다. 검증된 경로를 두고
같은 코드를 다시 쓰면 임베딩 모델이 바뀔 때 한쪽만 낡는다.
"""

from __future__ import annotations

import uuid
from typing import Any, Iterable

from . import compliance, taxonomy


def prepare(chunks: list[dict], *, mask: bool = True) -> tuple[list[dict], dict]:
    """적재 직전 비식별 처리와 **검산**.

    마스킹한 결과를 탐지기에 다시 넣어 잔존을 센다. 마스킹 규칙에 구멍이 있으면
    치환했다고 믿고 그대로 내보내게 되는데, 그건 마스킹을 안 한 것보다 나쁘다.
    잔존이 있으면 빈 목록을 돌려주고 호출 측이 적재를 포기한다.
    """
    if not mask:
        residual = sum(len(compliance.detect_pii(c["content"])) for c in chunks)
        return (chunks if not residual else []), {
            "masked": False, "residual_count": residual,
        }

    cleaned = []
    masked_count = 0
    for c in chunks:
        text, n = compliance.mask_text(c["content"])
        masked_count += n
        cleaned.append({**c, "content": text})
    residual = sum(len(compliance.detect_pii(c["content"])) for c in cleaned)
    return (cleaned if not residual else []), {
        "masked": True, "masked_count": masked_count, "residual_count": residual,
    }


def _helpers():
    """앱 본체의 적재 헬퍼. kb 단독 테스트에서는 import 하지 않는다."""
    from ingest import (  # type: ignore[import-not-found]
        collection_name_sanitize,
        ensure_collection,
        get_embedding_sync,
    )
    from qdrant_client import QdrantClient
    from qdrant_client.models import PointStruct

    return (collection_name_sanitize, ensure_collection, get_embedding_sync,
            QdrantClient, PointStruct)


def channel_documents(chunks: Iterable[dict], *, max_chars: int = 6000) -> list[dict]:
    """채널별 청크를 검색 단위로 묶는다.

    글은 이어 붙이되 너무 길면 나눈다. 표와 그림은 **하나씩** 따로 둔다 —
    표 두 개를 한 점에 넣으면 검색이 엉뚱한 표를 근거로 답한다.
    """
    out: list[dict] = []
    buffer: list[dict] = []
    size = 0

    def flush() -> None:
        nonlocal buffer, size
        if not buffer:
            return
        out.append({
            "channel": buffer[0]["channel"],
            "page": buffer[0].get("page"),
            "anchor": buffer[0].get("anchor", ""),
            "content": "\n\n".join(
                f"### {c.get('anchor','')} (p.{c.get('page','?')})\n{c['content']}"
                for c in buffer
            ),
            "parts": len(buffer),
        })
        buffer, size = [], 0

    for chunk in chunks:
        if chunk["channel"] != "text":
            flush()
            out.append({
                "channel": chunk["channel"],
                "page": chunk.get("page"),
                "anchor": chunk.get("anchor", ""),
                "content": f"### {chunk.get('anchor','')} (p.{chunk.get('page','?')})\n"
                           f"{chunk['content']}",
                "parts": 1,
            })
            continue
        if size + len(chunk["content"]) > max_chars:
            flush()
        buffer.append(chunk)
        size += len(chunk["content"])
    flush()
    return out


def upload(
    result: Any,
    chunks: list[dict],
    *,
    mask: bool = True,
    qdrant_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """적재. `result.upload_allowed` 가 False 면 아무것도 하지 않는다.

    반환값에 올린 점 수와 컬렉션 이름을 담아, 호출 측이 화면에 그대로 쓸 수 있게 한다.
    """
    if not getattr(result, "upload_allowed", False):
        return {
            "uploaded": 0,
            "collection": None,
            "skipped": "규제 게이트가 적재를 허용하지 않았습니다",
        }

    chunks, masking = prepare(chunks, mask=mask)
    if not chunks:
        return {
            "uploaded": 0, "collection": None, "masking": masking,
            "skipped": (f"비식별 처리 후에도 개인정보 {masking['residual_count']}건이 "
                        "남아 적재를 중단했습니다"),
        }

    (sanitize, ensure_collection, embed, QdrantClient, PointStruct) = _helpers()

    from config import QDRANT_API_KEY, QDRANT_HOST, QDRANT_PORT  # type: ignore

    client = QdrantClient(
        url=qdrant_url or f"http://{QDRANT_HOST}:{QDRANT_PORT}",
        api_key=api_key or QDRANT_API_KEY or None,
    )
    collection = sanitize(result.collection_name)
    ensure_collection(client, collection)

    documents = channel_documents(chunks)
    points = []
    for i, doc in enumerate(documents):
        payload = {
            "text": doc["content"],
            "source": result.filename,
            "page": str(doc.get("page") or ""),
            "chunk_index": i,
            "total_chunks": len(documents),
            # 검색 필터 축 — rag.py 가 Filter(must=...) 로 실제로 건다
            "category": result.sector,
            "sector": result.sector,
            "sector_name": result.sector_name,
            "channel": doc["channel"],
            "doc_hash": result.doc_hash,
            "masked": masking.get("masked", True),
            "unit_basis": taxonomy.get(result.sector).unit_basis,
        }
        points.append(PointStruct(
            id=str(uuid.uuid4()), vector=embed(doc["content"]), payload=payload))

    if points:
        client.upsert(collection_name=collection, points=points)

    by_channel: dict[str, int] = {}
    for doc in documents:
        by_channel[doc["channel"]] = by_channel.get(doc["channel"], 0) + 1
    return {
        "uploaded": len(points),
        "collection": collection,
        "by_channel": dict(sorted(by_channel.items())),
    }
