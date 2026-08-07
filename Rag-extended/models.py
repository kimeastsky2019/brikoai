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
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    xai_doc_id: str
    collection_id: Optional[int] = Field(default=None, foreign_key="collection.id")
    status: str = Field(default="pending")
    created_at: datetime = Field(default_factory=_utcnow)
    
    collection: Optional[Collection] = Relationship(back_populates="documents")

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    full_name: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)

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
