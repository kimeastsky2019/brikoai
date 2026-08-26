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
import re
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
    EMBED_DIM, CHUNK_SIZE, CHUNK_OVERLAP,
    SECTION_AWARE_CHUNKING, HYBRID_SEARCH,
    SPARSE_VECTOR_NAME, DENSE_VECTOR_NAME,
)
from embeddings import embed_sync
from sparse import sparse_embed_docs, sparse_available
import contract

SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx", ".doc"}


# ──────────────────────────────────────────────
# Embedding (동기 — CLI 인제스트용)
# ──────────────────────────────────────────────
def get_embedding_sync(text: str) -> list[float]:
    """provider 는 embeddings.py 가 결정 (fastembed | ollama)"""
    return embed_sync(text)


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
    """오버랩 슬라이딩 윈도우 청킹 (기계적 분할)"""
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


# 섹션 경계로 인정하는 헤딩 패턴.
#  - 마크다운 헤딩:            ## 2. 설비 현황
#  - 번호 항목:                2. 설비 현황 / 2.1 보일러
#  - 한국 법령·규정 조문:      제3조(적용범위)
#  - PDF 추출기가 넣는 페이지: [Page 12]
_HEADING_PATTERNS = [
    re.compile(r"^(#{1,6})\s+(.*\S)\s*$"),
    re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(\S.*)$"),
    re.compile(r"^(제\s*\d+\s*[조장절관])\s*[\(（]?(.*?)[\)）]?\s*$"),
    re.compile(r"^\[Page\s+(\d+)\]\s*$"),
]


def _heading_of(line: str) -> Optional[tuple[int, str]]:
    """헤딩이면 (레벨, 제목) 반환. 아니면 None."""
    s = line.strip()
    if not s or len(s) > 120:
        return None

    m = _HEADING_PATTERNS[0].match(s)
    if m:
        return len(m.group(1)), m.group(2).strip()

    m = _HEADING_PATTERNS[1].match(s)
    if m:
        # "2024. 6. 30" 같은 날짜가 헤딩으로 잡히지 않도록 제목 쪽을 확인한다.
        title = m.group(2).strip()
        if title and not title[0].isdigit():
            return m.group(1).count(".") + 1, f"{m.group(1)} {title}"
        return None

    m = _HEADING_PATTERNS[2].match(s)
    if m:
        title = (m.group(2) or "").strip()
        return 2, f"{m.group(1)}{f'({title})' if title else ''}"

    m = _HEADING_PATTERNS[3].match(s)
    if m:
        return 1, f"Page {m.group(1)}"

    return None


def split_sections(text: str) -> list[dict]:
    """
    본문을 섹션 단위로 나눈다. 각 섹션은 제목 경로와 원문 줄 범위를 갖는다.
    헤딩이 하나도 없으면 문서 전체가 섹션 1개다.
    """
    lines = text.splitlines()
    sections: list[dict] = []
    path: list[tuple[int, str]] = []      # (레벨, 제목) 스택
    buf: list[str] = []
    buf_start = 1                          # 1-based 줄 번호
    current_path: list[str] = []

    def flush(end_line: int) -> None:
        body = "\n".join(buf).strip()
        if body:
            sections.append({
                "title_path": list(current_path),
                "text":       body,
                "start_line": buf_start,
                "end_line":   end_line,
            })

    for idx, line in enumerate(lines, start=1):
        head = _heading_of(line)
        if head:
            flush(idx - 1)
            level, title = head
            while path and path[-1][0] >= level:
                path.pop()
            path.append((level, title))
            current_path = [t for _, t in path]
            buf = []
            buf_start = idx
        else:
            buf.append(line)

    flush(len(lines))
    if not sections:
        body = text.strip()
        if body:
            sections = [{
                "title_path": [],
                "text":       body,
                "start_line": 1,
                "end_line":   max(1, len(lines)),
            }]
    return sections


def chunk_sections(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[dict]:
    """
    섹션 인지 청킹.

    이미 구조가 있는 문서를 문자 수로만 자르면 문장·표가 중간에서 끊긴다.
    먼저 헤딩으로 섹션을 나누고, 섹션이 chunk_size 를 넘을 때만 그 안에서 기계적으로 쪼갠다.
    (의미 기반 청킹은 문서가 늘어날수록 비용이 급격히 커져서 채택하지 않는다.)

    반환: [{text, span:{section_no, section_title, start_line, end_line}}, ...]
    """
    if not SECTION_AWARE_CHUNKING:
        return [
            {"text": c, "span": {"section_no": None, "section_title": "",
                                 "start_line": None, "end_line": None}}
            for c in chunk_text(text, chunk_size, overlap)
        ]

    out: list[dict] = []
    for s_idx, sec in enumerate(split_sections(text), start=1):
        section_no = f"s{s_idx:02d}"
        title = " > ".join(sec["title_path"]) if sec["title_path"] else ""
        body = sec["text"]
        base_line = sec["start_line"]

        if len(body) <= chunk_size:
            parts = [body]
        else:
            parts = chunk_text(body, chunk_size, overlap)

        # 섹션 내부 조각의 줄 번호는 조각 앞까지의 개행 수로 추정한다.
        cursor = 0
        for part in parts:
            pos = body.find(part, cursor)
            if pos < 0:
                pos = cursor
            start_line = base_line + body.count("\n", 0, pos)
            end_line = start_line + part.count("\n")
            cursor = pos + max(1, len(part) - overlap)

            out.append({
                "text": part,
                "span": {
                    "section_no":    section_no,
                    "section_title": title,
                    "start_line":    start_line,
                    "end_line":      end_line,
                },
            })
    return out


# ──────────────────────────────────────────────
# Qdrant Collection 관리
# ──────────────────────────────────────────────
def collection_is_hybrid(client, collection_name: str) -> bool:
    """
    이 컬렉션이 하이브리드(명명 벡터 dense + 스파스 bm25) 스키마인지.

    구 컬렉션은 무명(unnamed) 밀집 벡터 하나만 갖는다. 스키마를 바꾸려면
    재생성 + 재인제스트가 필요하므로, 코드가 두 형태를 모두 다루게 한다.
    """
    try:
        info = client.get_collection(collection_name)
        params = info.config.params
        vectors = params.vectors
        has_named_dense = isinstance(vectors, dict) and DENSE_VECTOR_NAME in vectors
        sparse = getattr(params, "sparse_vectors", None) or {}
        has_sparse = SPARSE_VECTOR_NAME in sparse
        return bool(has_named_dense and has_sparse)
    except Exception:
        return False


def ensure_collection(client: QdrantClient, collection_name: str) -> None:
    """
    컬렉션이 없으면 생성.

    신규 컬렉션은 하이브리드 스키마로 만든다:
      - 명명 밀집 벡터 `dense`
      - 스파스 벡터 `bm25` (IDF 보정을 Qdrant 쪽에서 적용)
    이미 있는 컬렉션은 스키마를 건드리지 않는다 (재색인이 필요하기 때문).
    """
    from qdrant_client.models import SparseVectorParams, Modifier

    existing = {c.name for c in client.get_collections().collections}
    if collection_name in existing:
        mode = "hybrid" if collection_is_hybrid(client, collection_name) else "dense-only"
        print(f"✓ 기존 컬렉션 사용: [{collection_name}] ({mode})")
        return

    use_sparse = HYBRID_SEARCH and sparse_available()
    if use_sparse:
        client.create_collection(
            collection_name=collection_name,
            vectors_config={
                DENSE_VECTOR_NAME: VectorParams(size=EMBED_DIM, distance=Distance.COSINE)
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: SparseVectorParams(modifier=Modifier.IDF)
            },
            optimizers_config=OptimizersConfigDiff(indexing_threshold=20000),
        )
        print(f"✓ 컬렉션 생성 (하이브리드): [{collection_name}]")
    else:
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
            optimizers_config=OptimizersConfigDiff(indexing_threshold=20000),
        )
        print(f"✓ 컬렉션 생성 (밀집 전용): [{collection_name}]")


def collection_name_sanitize(name: str) -> str:
    """컬렉션 이름 정규화 (Qdrant 제약: 영숫자, 하이픈, 언더스코어)"""
    import re, hashlib

    # Qdrant 컬렉션 이름은 ASCII 영숫자/_/- 만 안전합니다. 그런데 "배포검증" 처럼
    # 전부 한글이면 치환 결과가 빈 문자열이 되어 모두 "default" 하나로 뭉개졌습니다.
    # (app.py 의 중복 가드가 uuid 접미사를 붙여 혼입 자체는 막지만, 이름이
    #  default / default_a1b2c3 처럼 불투명해지고, DB 를 초기화했는데 Qdrant 가
    #  남아 있으면 가드가 무력해져 실제로 충돌합니다.)
    # 원본 이름의 해시를 붙여 언제나 고유하고 안정적인 이름이 나오게 합니다.
    slug = re.sub(r"[^a-zA-Z0-9_\-]", "_", name).strip("_")
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
    return f"{slug}_{digest}" if slug else f"col_{digest}"


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
    *,
    stable_id: Optional[str] = None,
    version: int = 1,
    sha256: Optional[str] = None,
    acl: Optional[str] = None,
    owner: Optional[str] = None,
    doc_status: Optional[str] = None,
) -> int:
    """
    메모리의 바이트를 직접 인제스트 (app.py 업로드 핸들러용).

    stable_id 가 주어지면 청크마다 데이터 계약 메타데이터가 함께 저장된다:
      chunk_key / stable_id / version / sha256 / acl / doc_status / span
    point id 는 (stable_id, version, index) 에서 결정적으로 파생하므로
    같은 버전을 다시 인제스트해도 청크가 중복되지 않고 덮어써진다.
    """
    text = extract_text(content, filename)
    if not text.strip():
        return 0

    acl_norm = contract.normalize_acl(acl)
    if acl_norm in contract.ACL_NO_INDEX:
        # RESTRICTED 는 임베딩 자체가 유출면이다. 대장에는 남기되 벡터화하지 않는다.
        print(f"  ⚠ {filename}: ACL={acl_norm} — 벡터 색인 생략 (원본만 보관)")
        return 0

    pieces = chunk_sections(text)
    if not pieces:
        return 0

    texts = [p["text"] for p in pieces]
    hybrid = collection_is_hybrid(client, collection_name)
    sparse_vecs = sparse_embed_docs(texts) if hybrid else None

    points: list[PointStruct] = []
    for i, piece in enumerate(pieces):
        chunk = piece["text"]
        span = piece["span"]
        dense = get_embedding_sync(chunk)

        payload: dict = {
            "text":         chunk,
            "source":       filename,
            "page":         str(i + 1),
            "chunk_index":  i,
            "total_chunks": len(pieces),
            # 섹션 인지 청킹의 산물 — 문서가 아니라 문단을 인용하기 위한 좌표
            "section_no":    span.get("section_no"),
            "section_title": span.get("section_title"),
            "start_line":    span.get("start_line"),
            "end_line":      span.get("end_line"),
        }

        if stable_id:
            payload.update({
                "chunk_key":  contract.make_chunk_key(stable_id, version, i),
                "stable_id":  stable_id,
                "version":    version,
                "sha256":     sha256 or "",
                "acl":        acl_norm,
                "doc_status": contract.normalize_doc_status(doc_status),
                "owner":      owner or "",
            })

        if category:
            payload["category"] = category
        if tags:
            payload["tags"] = tags
        if extra_metadata:
            payload.update(extra_metadata)

        point_id = (
            contract.make_chunk_uuid(stable_id, version, i)
            if stable_id else str(uuid.uuid4())
        )

        if hybrid:
            from qdrant_client.models import SparseVector
            vector: dict = {DENSE_VECTOR_NAME: dense}
            if sparse_vecs:
                idx, val = sparse_vecs[i]
                vector[SPARSE_VECTOR_NAME] = SparseVector(indices=idx, values=val)
        else:
            vector = dense

        points.append(PointStruct(id=point_id, vector=vector, payload=payload))

    batch_size = 100
    for i in range(0, len(points), batch_size):
        client.upsert(collection_name=collection_name, points=points[i:i+batch_size])

    return len(pieces)


def delete_document_chunks(
    client: QdrantClient,
    collection_name: str,
    stable_id: str,
    version: Optional[int] = None,
) -> None:
    """stable_id(선택적으로 특정 버전)에 속한 청크를 지운다."""
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    must = [FieldCondition(key="stable_id", match=MatchValue(value=stable_id))]
    if version is not None:
        must.append(FieldCondition(key="version", match=MatchValue(value=version)))
    client.delete(collection_name=collection_name, points_selector=Filter(must=must))


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
