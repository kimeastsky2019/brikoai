from datetime import datetime, timezone
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

class Collection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    xai_id: str
    description: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)
    tags: Optional[str] = Field(default=None)  # comma-separated
    created_at: datetime = Field(default_factory=_utcnow)

    documents: List["Document"] = Relationship(back_populates="collection")

class Document(SQLModel, table=True):
    """
    문서 대장(레지스트리) 한 줄 = 하나의 (stable_id, version).

    같은 문서를 갱신하면 행을 새로 추가한다(append-only). 이전 버전 행과
    원본 파일은 남긴다 — 과거 답변이 인용한 근거를 재현할 수 있어야 하기 때문이다.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str                                    # 표시용 파일명 (바뀔 수 있음)
    xai_doc_id: str                              # 레거시 job id
    collection_id: Optional[int] = Field(default=None, foreign_key="collection.id")
    status: str = Field(default="pending")       # 인제스트 처리 상태
    created_at: datetime = Field(default_factory=_utcnow)

    # ── 데이터 계약 6축 ──────────────────────────
    stable_id: Optional[str] = Field(default=None, index=True)   # doc:ets:audit-2026-031
    version: int = Field(default=1)
    sha256: Optional[str] = Field(default=None, index=True)
    acl: str = Field(default="INTERNAL")
    owner: Optional[str] = Field(default=None)
    doc_status: str = Field(default="draft")                     # draft/reviewed/deprecated
    provenance: Optional[str] = Field(default=None)              # JSON
    file_path: Optional[str] = Field(default=None)               # 보관된 원본 경로
    mime: Optional[str] = Field(default=None)
    size_bytes: Optional[int] = Field(default=None)
    chunk_count: int = Field(default=0)
    
    collection: Optional[Collection] = Relationship(back_populates="documents")

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    full_name: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)

    # 이 사용자가 열람할 수 있는 최대 등급. 검색·다운로드가 이 값으로 걸러진다.
    # 신규 가입자는 가장 낮은 등급에서 시작한다 — 권한은 명시적으로 올려야 한다.
    acl: str = Field(default="PUBLIC")
    is_service: bool = Field(default=False)   # 서비스 계정 (LLM Wiki 등 타 서비스용)

class UsageEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    endpoint: str = Field(index=True)
    model: str
    collection_id: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    cost_usd: float = 0.0
    latency_ms: Optional[int] = None
    cached: bool = False
    created_at: datetime = Field(default_factory=_utcnow)
