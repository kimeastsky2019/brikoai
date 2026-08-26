"""
sparse.py — BM25 스파스 임베딩 (하이브리드 검색의 키워드 쪽)

왜 필요한가
- 밀집(dense) 벡터는 "비슷한 의미"를 잘 잡지만, `MB-300`, `로트번호 A17`,
  `제3조` 같은 **정확한 표기**는 오히려 놓친다.
- BM25 는 반대다. 정확한 토큰 매칭에 강하고 의미 확장은 못 한다.
- 그래서 둘을 각각 랭킹한 뒤 RRF 로 섞는다. 검색은 rag.py 가 담당한다.

모델은 fastembed 의 `Qdrant/bm25` 를 쓴다. 최초 1회 모델 파일을 내려받아
캐시하며, 실패하면 하이브리드를 끄고 밀집 검색으로 조용히 되돌아간다
(검색이 아예 죽는 것보다 낫다).
"""
from __future__ import annotations

import threading
from typing import Iterable, Optional

from config import SPARSE_MODEL

_model = None
_load_failed = False
_lock = threading.Lock()


def _get_model():
    """지연 로딩 — 임포트 시점에 모델을 내려받지 않는다."""
    global _model, _load_failed
    if _model is not None or _load_failed:
        return _model
    with _lock:
        if _model is not None or _load_failed:
            return _model
        try:
            from fastembed import SparseTextEmbedding
            _model = SparseTextEmbedding(SPARSE_MODEL)
        except Exception as e:  # 모델 다운로드 실패 등
            print(f"⚠ BM25 스파스 모델 로드 실패 ({SPARSE_MODEL}): {e} — 밀집 검색만 사용합니다")
            _load_failed = True
    return _model


def sparse_available() -> bool:
    return _get_model() is not None


def _to_pairs(embeddings: Iterable) -> list[tuple[list[int], list[float]]]:
    out = []
    for e in embeddings:
        out.append(([int(i) for i in e.indices], [float(v) for v in e.values]))
    return out


def sparse_embed_docs(texts: list[str]) -> Optional[list[tuple[list[int], list[float]]]]:
    """색인용 임베딩. 실패하면 None (호출자가 밀집 전용으로 진행)."""
    model = _get_model()
    if model is None or not texts:
        return None
    try:
        return _to_pairs(model.embed(texts))
    except Exception as e:
        print(f"⚠ BM25 문서 임베딩 실패: {e}")
        return None


def sparse_embed_query(text: str) -> Optional[tuple[list[int], list[float]]]:
    """
    질의용 임베딩. BM25 는 질의 쪽에서 IDF 가중을 다르게 주므로
    `query_embed` 를 써야 한다 (embed 로 대신하면 점수가 왜곡된다).
    """
    model = _get_model()
    if model is None or not (text or "").strip():
        return None
    try:
        pairs = _to_pairs(model.query_embed([text]))
        return pairs[0] if pairs else None
    except Exception as e:
        print(f"⚠ BM25 질의 임베딩 실패: {e}")
        return None
