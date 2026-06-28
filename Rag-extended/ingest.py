"""
ingest.py — Qdrant 문서 인제스트 파이프라인
[REPLACED] Grok Collections API → Qdrant upsert
[REPLACED] xAI Embeddings → BGE-M3 via Ollama

사용법:
    python ingest.py --collection my_collection --folder ./docs --category 정책
    python ingest.py --collection my_collection --file report.pdf --category 재무
"""
import os
import io
import uuid
import argparse
from pathlib import Path
from typing import Optional

import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    OptimizersConfigDiff,
)

from config import (
    QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY,
    OLLAMA_BASE_URL, EMBED_MODEL, EMBED_DIM,
    CHUNK_SIZE, CHUNK_OVERLAP,
)

SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx", ".doc"}


# ──────────────────────────────────────────────
# Embedding (동기 — CLI 인제스트용)
# ──────────────────────────────────────────────
def get_embedding_sync(text: str) -> list[float]:
    """BGE-M3 임베딩 (동기 버전)"""
    resp = httpx.post(
        f"{OLLAMA_BASE_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


# ──────────────────────────────────────────────
# Text Extraction
# ──────────────────────────────────────────────
def extract_text(content: bytes, filename: str) -> str:
    """파일 내용에서 텍스트 추출 (PDF, DOCX, TXT, MD 지원)"""
    ext = Path(filename).suffix.lower()

    if ext in (".txt", ".md"):
        return content.decode("utf-8", errors="replace")

    if ext in (".docx", ".doc"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as e:
            print(f"  ⚠ DOCX 파싱 실패 ({filename}): {e}")
            return content.decode("utf-8", errors="replace")

    if ext == ".pdf":
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(content))
            pages = []
            for i, page in enumerate(reader.pages):
                text = page.extract_text() or ""
                if text.strip():
                    pages.append(f"[Page {i+1}]\n{text}")
            return "\n\n".join(pages) if pages else f"[PDF 텍스트 없음: {filename}]"
        except Exception as e:
            print(f"  ⚠ PDF 파싱 실패 ({filename}): {e}")
            return f"[PDF: {filename}]"

    return content.decode("utf-8", errors="replace")


# ──────────────────────────────────────────────
# Chunking
# ──────────────────────────────────────────────
def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    """오버랩 슬라이딩 윈도우 청킹"""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start += chunk_size - overlap
    return chunks


# ──────────────────────────────────────────────
# Qdrant Collection 관리
# ──────────────────────────────────────────────
def ensure_collection(client: QdrantClient, collection_name: str) -> None:
    """컬렉션이 없으면 생성"""
    existing = {c.name for c in client.get_collections().collections}
    if collection_name not in existing:
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
            optimizers_config=OptimizersConfigDiff(indexing_threshold=20000),
        )
        print(f"✓ 컬렉션 생성: [{collection_name}]")
    else:
        print(f"✓ 기존 컬렉션 사용: [{collection_name}]")


def collection_name_sanitize(name: str) -> str:
    """컬렉션 이름 정규화 (Qdrant 제약: 영숫자, 하이픈, 언더스코어)"""
    import re
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", name).strip("_") or "default"


# ──────────────────────────────────────────────
# File Ingestion
# ──────────────────────────────────────────────
def ingest_file(
    client: QdrantClient,
    collection_name: str,
    filepath: str,
    category: Optional[str] = None,
    tags: Optional[list[str]] = None,
    extra_metadata: Optional[dict] = None,
) -> int:
    """단일 파일 인제스트. 청크 수를 반환."""
    with open(filepath, "rb") as f:
        content = f.read()

    filename = os.path.basename(filepath)
    text = extract_text(content, filename)

    if not text.strip():
        print(f"  ⚠ 스킵 (텍스트 없음): {filename}")
        return 0

    chunks = chunk_text(text)
    points: list[PointStruct] = []

    for i, chunk in enumerate(chunks):
        vector = get_embedding_sync(chunk)
        payload: dict = {
            "text":        chunk,
            "source":      filename,
            "page":        str(i + 1),
            "chunk_index": i,
            "total_chunks": len(chunks),
            "filepath":    filepath,
        }
        if category:
            payload["category"] = category
        if tags:
            payload["tags"] = tags
        if extra_metadata:
            payload.update(extra_metadata)

        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload=payload,
        ))

    # 배치 업서트 (100개씩)
    batch_size = 100
    for i in range(0, len(points), batch_size):
        client.upsert(collection_name=collection_name, points=points[i:i+batch_size])

    print(f"  ✓ {filename}: {len(chunks)}개 청크 인제스트 완료")
    return len(chunks)


def ingest_folder(
    collection_name: str,
    folder: str,
    category: Optional[str] = None,
) -> dict:
    """폴더 전체 인제스트"""
    client = QdrantClient(
        host=QDRANT_HOST,
        port=QDRANT_PORT,
        api_key=QDRANT_API_KEY,
    )
    ensure_collection(client, collection_name)

    total_files = 0
    total_chunks = 0

    for root, _, files in os.walk(folder):
        for fname in sorted(files):
            ext = Path(fname).suffix.lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            filepath = os.path.join(root, fname)
            chunks = ingest_file(client, collection_name, filepath, category=category)
            if chunks > 0:
                total_files += 1
                total_chunks += chunks

    print(f"\n✓ 완료: {total_files}개 파일, {total_chunks}개 청크 → [{collection_name}]")
    return {"files": total_files, "chunks": total_chunks}


def ingest_bytes(
    client: QdrantClient,
    collection_name: str,
    content: bytes,
    filename: str,
    category: Optional[str] = None,
    tags: Optional[list[str]] = None,
    extra_metadata: Optional[dict] = None,
) -> int:
    """
    메모리의 바이트 데이터를 직접 인제스트 (app.py 업로드 핸들러용).
    파일 없이 content bytes에서 직접 처리.
    """
    text = extract_text(content, filename)
    if not text.strip():
        return 0

    chunks = chunk_text(text)
    points: list[PointStruct] = []

    for i, chunk in enumerate(chunks):
        vector = get_embedding_sync(chunk)
        payload: dict = {
            "text":        chunk,
            "source":      filename,
            "page":        str(i + 1),
            "chunk_index": i,
            "total_chunks": len(chunks),
        }
        if category:
            payload["category"] = category
        if tags:
            payload["tags"] = tags
        if extra_metadata:
            payload.update(extra_metadata)

        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload=payload,
        ))

    batch_size = 100
    for i in range(0, len(points), batch_size):
        client.upsert(collection_name=collection_name, points=points[i:i+batch_size])

    return len(chunks)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Qdrant 문서 인제스트")
    subparsers = parser.add_subparsers(dest="command")

    # 폴더 인제스트
    folder_parser = subparsers.add_parser("folder", help="폴더 전체 인제스트")
    folder_parser.add_argument("--collection", required=True)
    folder_parser.add_argument("--folder",     required=True)
    folder_parser.add_argument("--category",   default=None)

    # 단일 파일 인제스트
    file_parser = subparsers.add_parser("file", help="단일 파일 인제스트")
    file_parser.add_argument("--collection", required=True)
    file_parser.add_argument("--file",       required=True)
    file_parser.add_argument("--category",   default=None)

    args = parser.parse_args()

    if args.command == "folder":
        ingest_folder(args.collection, args.folder, args.category)
    elif args.command == "file":
        client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, api_key=QDRANT_API_KEY)
        ensure_collection(client, args.collection)
        ingest_file(client, args.collection, args.file, category=args.category)
    else:
        parser.print_help()
