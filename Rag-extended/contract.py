"""
contract.py — 데이터 계약 (Data Contract)

문서를 "파일"이 아니라 "계약된 데이터"로 다루기 위한 최소 규약.
6개 축: stable_id / version+hash / source span / ACL / provenance / owner·status

핵심 원칙
- stable_id 는 절대 바뀌지 않는다. 내용이 바뀌면 version 이 올라간다.
- 같은 (stable_id, version) 이면 sha256 이 같아야 한다 — 다르면 무결성 위반.
- 청크 ID 는 stable_id 를 확장해서 만든다 (문서→청크 추적이 ID 만으로 가능).
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Optional

# ──────────────────────────────────────────────
# ACL — 접근 등급
# ──────────────────────────────────────────────
# 숫자가 클수록 민감하다. 요청자 등급 >= 문서 등급 이어야 열람 가능.
ACL_LEVELS: dict[str, int] = {
    "PUBLIC":       0,
    "INTERNAL":     1,
    "CONFIDENTIAL": 2,
    "RESTRICTED":   3,
}
DEFAULT_ACL = "INTERNAL"

# RESTRICTED 는 임베딩(벡터)조차 유출면이므로 기본적으로 벡터 DB에 넣지 않는다.
ACL_NO_INDEX = {"RESTRICTED"}


def normalize_acl(value: Optional[str]) -> str:
    """입력값을 표준 ACL 등급으로. 알 수 없으면 가장 안전한 기본값."""
    if not value:
        return DEFAULT_ACL
    v = value.strip().upper()
    return v if v in ACL_LEVELS else DEFAULT_ACL


def acl_rank(value: Optional[str]) -> int:
    return ACL_LEVELS.get(normalize_acl(value), ACL_LEVELS[DEFAULT_ACL])


def can_read(viewer_acl: Optional[str], doc_acl: Optional[str]) -> bool:
    """요청자 등급이 문서 등급 이상이면 열람 가능."""
    return acl_rank(viewer_acl) >= acl_rank(doc_acl)


def readable_acls(viewer_acl: Optional[str]) -> list[str]:
    """요청자가 읽을 수 있는 ACL 등급 목록 — 벡터 검색 필터에 사용."""
    limit = acl_rank(viewer_acl)
    return [name for name, rank in ACL_LEVELS.items() if rank <= limit]


# ──────────────────────────────────────────────
# 문서 상태 (owner · status)
# ──────────────────────────────────────────────
DOC_STATUSES = ("draft", "reviewed", "deprecated")
DEFAULT_DOC_STATUS = "draft"


def normalize_doc_status(value: Optional[str]) -> str:
    if not value:
        return DEFAULT_DOC_STATUS
    v = value.strip().lower()
    return v if v in DOC_STATUSES else DEFAULT_DOC_STATUS


# ──────────────────────────────────────────────
# stable ID
# ──────────────────────────────────────────────
# doc:ets:<slug>-<year>-<seq>   예) doc:ets:audit-2026-031
STABLE_ID_RE = re.compile(r"^doc:[a-z0-9]+:[a-z0-9\-]+$")

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(text: str, fallback: str = "doc") -> str:
    """
    표시용 문자열 → ID 조각.
    한글은 ASCII 로 옮길 방법이 없으므로 해시 접두사로 대체한다
    (한글 파일명이 전부 같은 slug 로 뭉개지는 것을 막는다).
    """
    s = _SLUG_STRIP.sub("-", (text or "").lower()).strip("-")
    if not s:
        digest = hashlib.sha1((text or fallback).encode("utf-8")).hexdigest()[:8]
        return f"{fallback}-{digest}"
    return s[:40]


def make_stable_id(
    slug: str,
    seq: int,
    *,
    namespace: str = "ets",
    year: Optional[int] = None,
) -> str:
    """
    stable_id 생성. 시각(초 단위)을 넣지 않는 이유:
    같은 문서가 갱신됐다는 사실을 추적하려면 ID 가 고정되어야 하기 때문이다.
    시간 정보는 version 과 provenance 가 담당한다.
    """
    y = year or datetime.now(timezone.utc).year
    return f"doc:{namespace}:{slugify(slug)}-{y}-{seq:03d}"


def is_valid_stable_id(value: Optional[str]) -> bool:
    return bool(value) and bool(STABLE_ID_RE.match(value))


# ──────────────────────────────────────────────
# 청크 ID — stable_id 의 확장
# ──────────────────────────────────────────────
def make_chunk_key(stable_id: str, version: int, index: int) -> str:
    """사람이 읽을 수 있는 청크 키. Qdrant point id 는 별도 UUID 를 쓴다."""
    return f"{stable_id}@v{version}#{index:04d}"


def make_chunk_uuid(stable_id: str, version: int, index: int) -> str:
    """
    청크 키에서 결정적으로 파생한 UUID.
    같은 문서·버전을 다시 인제스트하면 같은 point id 가 나오므로
    중복 삽입 대신 덮어쓰기가 되어 청크가 두 배로 늘지 않는다.
    """
    import uuid as _uuid
    return str(_uuid.uuid5(_uuid.NAMESPACE_URL, make_chunk_key(stable_id, version, index)))


# ──────────────────────────────────────────────
# 해시 / provenance
# ──────────────────────────────────────────────
def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def short_hash(sha256: Optional[str], length: int = 12) -> str:
    return (sha256 or "")[:length]


def build_provenance(
    *,
    original_name: str,
    parser: str,
    parser_version: str = "",
    source_path: Optional[str] = None,
    extra: Optional[dict] = None,
) -> str:
    """이 문서가 어떻게 만들어졌는가 — JSON 문자열로 저장."""
    payload = {
        "original_name": original_name,
        "source_path":   source_path or "",
        "parser":        parser,
        "parser_version": parser_version,
        "converted_at":  datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        payload.update(extra)
    return json.dumps(payload, ensure_ascii=False)


def parse_provenance(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {"raw": raw}


# ──────────────────────────────────────────────
# 인용 표기
# ──────────────────────────────────────────────
def format_citation(
    stable_id: str,
    version: int,
    sha256: Optional[str],
    span: Optional[dict] = None,
) -> str:
    """
    [doc:ets:audit-2026-031 v3 #a1b2c3d4e5f6 s02:14-29]

    버전과 해시가 함께 있어야 "그때 그 문서"를 나중에 재현할 수 있다.
    """
    parts = [stable_id, f"v{version}"]
    if sha256:
        parts.append(f"#{short_hash(sha256)}")
    if span:
        sec = span.get("section_no")
        start, end = span.get("start_line"), span.get("end_line")
        if sec and start is not None and end is not None:
            parts.append(f"{sec}:{start}-{end}")
        elif start is not None and end is not None:
            parts.append(f"L{start}-{end}")
    return "[" + " ".join(parts) + "]"
