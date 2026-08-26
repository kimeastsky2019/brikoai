"""
embeddings.py — 임베딩 provider 추상화

이 서버(211.119.38.148)는 2GB RAM / 1 vCPU 라 Ollama + bge-m3(1.2GB) 를 띄울 수
없습니다. 그래서 ONNX 런타임에서 도는 경량 다국어 모델(fastembed)을 기본으로 쓰고,
사양이 되는 호스트에서는 EMBED_PROVIDER=ollama 로 기존 BGE-M3 경로를 그대로 씁니다.

provider 별 벡터 차원이 다르므로(fastembed 기본 384 / bge-m3 1024) config.EMBED_DIM
을 반드시 맞춰야 합니다 — 컬렉션 생성 시 그 값으로 고정되기 때문입니다.
"""
import asyncio
import logging

import httpx

from config import (
    EMBED_PROVIDER, EMBED_MODEL, EMBED_DIM,
    OLLAMA_BASE_URL, FASTEMBED_MODEL, FASTEMBED_CACHE_DIR,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# fastembed (ONNX, CPU) — 기본 provider
# ──────────────────────────────────────────────
_fastembed_model = None


def _get_fastembed():
    """모델을 지연 로딩한다 — 임포트 시점에 400MB 를 잡아먹지 않도록."""
    global _fastembed_model
    if _fastembed_model is None:
        from fastembed import TextEmbedding

        logger.info(f"fastembed 모델 로딩: {FASTEMBED_MODEL}")
        _fastembed_model = TextEmbedding(
            model_name=FASTEMBED_MODEL,
            cache_dir=FASTEMBED_CACHE_DIR or None,
            # 1 vCPU 서버라 스레드를 늘려도 이득이 없고 메모리만 더 씁니다.
            threads=1,
        )
    return _fastembed_model


def _fastembed_embed(text: str) -> list[float]:
    model = _get_fastembed()
    vector = next(iter(model.embed([text])))
    return [float(x) for x in vector]


# ──────────────────────────────────────────────
# Ollama (BGE-M3) — 고사양 호스트용
# ──────────────────────────────────────────────
def _ollama_embed_sync(text: str) -> list[float]:
    resp = httpx.post(
        f"{OLLAMA_BASE_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


async def _ollama_embed_async(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────
def embed_sync(text: str) -> list[float]:
    """동기 임베딩 — CLI 인제스트·백그라운드 작업용"""
    if EMBED_PROVIDER == "ollama":
        return _ollama_embed_sync(text)
    return _fastembed_embed(text)


async def embed_async(text: str) -> list[float]:
    """비동기 임베딩 — 요청 처리 경로용"""
    if EMBED_PROVIDER == "ollama":
        return await _ollama_embed_async(text)
    # fastembed 는 동기 CPU 연산이라 이벤트 루프를 막지 않도록 스레드로 넘깁니다.
    return await asyncio.to_thread(_fastembed_embed, text)


def embedding_info() -> dict:
    """/health 에서 노출할 현재 임베딩 설정"""
    return {
        "provider": EMBED_PROVIDER,
        "model": FASTEMBED_MODEL if EMBED_PROVIDER == "fastembed" else EMBED_MODEL,
        "dim": EMBED_DIM,
        "loaded": _fastembed_model is not None if EMBED_PROVIDER == "fastembed" else None,
    }
