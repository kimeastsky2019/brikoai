"""
app.py — FastAPI 메인 애플리케이션
[MIGRATION] xAI/Grok → Exo 1.0 + Qdrant + CrewAI

변경 사항:
- xai_sdk, xai_helpers 제거
- mgmt_client (Grok Collections) → Qdrant QdrantClient
- chat_client (xAI) → openai.AsyncOpenAI (Exo 호환)
- /analyze → Exo(Qwen 72B) 직접 호출
- /agent 엔드포인트 신규 추가 (CrewAI)
- Collection.xai_id 필드 = Qdrant 컬렉션 이름으로 재사용
- Document.xai_doc_id 필드 = 인제스트 작업 UUID로 재사용
"""
import asyncio
import uuid
import time
import os
import json
import re
import io
from typing import Optional
from contextlib import asynccontextmanager
from datetime import timedelta

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Form, status, BackgroundTasks
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlalchemy import delete, func
from sqlmodel.ext.asyncio.session import AsyncSession
from openai import AsyncOpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, OptimizersConfigDiff

from config import (
    EXO_BASE_URL, EXO_API_KEY, LLM_MODEL,
    QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY,
    EMBED_DIM, CACHE_TTL_SEC, CACHE_MAXSIZE,
    COST_PER_1M_INPUT, COST_PER_1M_OUTPUT,
    SYSTEM_GUARDRAIL,
)
from llm_router import router as llm_router
from cache import cache_get, cache_set
from rag import run_rag
from ingest import ingest_bytes, ensure_collection, collection_name_sanitize
from database import init_db, get_session
from models import Collection, Document, User, UsageEvent
from auth_utils import (
    verify_password, get_password_hash,
    create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES,
)

# ──────────────────────────────────────────────
# Qdrant 동기 클라이언트 (컬렉션 관리용)
# ──────────────────────────────────────────────
def get_qdrant() -> QdrantClient:
    return QdrantClient(
        host=QDRANT_HOST,
        port=QDRANT_PORT,
        api_key=QDRANT_API_KEY,
    )

# ──────────────────────────────────────────────
# Exo LLM 클라이언트 (분석 엔드포인트용)
# ──────────────────────────────────────────────
def get_exo_client() -> AsyncOpenAI:
    return AsyncOpenAI(base_url=EXO_BASE_URL, api_key=EXO_API_KEY)


# ──────────────────────────────────────────────
# App lifecycle
# ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # 기본 유저 생성 (최초 실행 시)
    async for session in get_session():
        statement = select(User).where(User.email == "info@gngmeta.com")
        results = await session.exec(statement)
        user = results.first()
        if not user:
            default_user = User(
                email="info@gngmeta.com",
                hashed_password=get_password_hash("admin1234"),
                full_name="GnG Admin",
            )
            session.add(default_user)
            await session.commit()
        break

    yield


app = FastAPI(title="RAG API — Exo + Qdrant + CrewAI", lifespan=lifespan)

# CORS
allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in allowed_origins else allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# --- 지식 데이터베이스 구축 (업종별 온톨로지 · 규제 준수) ------------------
# 의존성(pdfplumber/openpyxl)이 없으면 본체는 계속 동작한다. 지식DB 화면만 죽는다.
try:
    from kb.router import router as kb_router
    app.include_router(kb_router)
except Exception as _e:
    print(f"Warning: knowledge-base router not loaded: {_e}")


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


# ──────────────────────────────────────────────
# Auth helpers
# ──────────────────────────────────────────────
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
):
    from jose import JWTError, jwt
    from auth_utils import SECRET_KEY, ALGORITHM

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    statement = select(User).where(User.email == email)
    result = await session.exec(statement)
    user = result.first()
    if user is None:
        raise credentials_exception
    return user


# ──────────────────────────────────────────────
# Pydantic Models
# ──────────────────────────────────────────────
class Filters(BaseModel):
    category: str | None = None
    tags: list[str] | None = None
    version: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    # 지식 데이터베이스 축. sector 는 업종(닫힌 집합), channel 은 글/표/그림.
    # 표만 검색하면 수치 질의의 정확도가 크게 오른다.
    sector: str | None = None
    channel: str | None = None


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    collection_id: int = Field(..., description="검색할 컬렉션 ID")
    filters: Filters | None = None


class ChatResponse(BaseModel):
    request_id: str
    answer: str
    citations: list[dict] = []
    cached: bool
    latency_ms: int


class AgentRequest(BaseModel):
    query: str = Field(..., min_length=1)
    collection_id: int = Field(..., description="검색할 컬렉션 ID")
    mode: str = Field(
        default="rag_crew",
        description="에이전트 모드: single | rag_crew | research_crew",
    )


class AgentResponse(BaseModel):
    request_id: str
    answer: str
    mode: str
    latency_ms: int


class CollectionCreate(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None
    tags: str | None = None


class CollectionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    tags: str | None = None


class CollectionRead(BaseModel):
    id: int
    name: str
    xai_id: str          # Qdrant 컬렉션 이름 저장
    description: str | None = None
    category: str | None = None
    tags: str | None = None
    created_at: str
    documents_count: int | None = None
    processing_count: int | None = None
    failed_count: int | None = None
    status: str | None = None


class DocumentRead(BaseModel):
    id: int
    name: str
    xai_doc_id: str      # 인제스트 작업 UUID
    status: str
    created_at: str


class Token(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None


class UserRead(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None


# ──────────────────────────────────────────────
# Auth Endpoints
# ──────────────────────────────────────────────
@app.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
):
    statement = select(User).where(User.email == form_data.username)
    result = await session.exec(statement)
    user = result.first()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/register", response_model=UserRead)
async def register(
    user_in: UserCreate,
    session: AsyncSession = Depends(get_session),
):
    statement = select(User).where(User.email == user_in.email)
    result = await session.exec(statement)
    if result.first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return UserRead(id=user.id, email=user.email, full_name=user.full_name)


@app.get("/users/me", response_model=UserRead)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return UserRead(id=current_user.id, email=current_user.email, full_name=current_user.full_name)


# ──────────────────────────────────────────────
# Health — Circuit Breaker 상태 포함
# ──────────────────────────────────────────────
@app.get("/health")
async def health():
    qdrant_ok = False
    exo_ok = False
    try:
        qdrant = get_qdrant()
        qdrant.get_collections()
        qdrant_ok = True
    except Exception:
        pass
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{EXO_BASE_URL.rstrip('/v1')}/health")
            exo_ok = r.status_code == 200
    except Exception:
        pass

    # Circuit Breaker 현황
    cb_status = llm_router.status()

    return {
        "ok":     True,
        "qdrant": "up" if qdrant_ok else "down",
        "exo":    "up" if exo_ok else "unknown",
        "llm":    cb_status,   # active_provider, providers 별 state
    }


# ──────────────────────────────────────────────
# Circuit Breaker 수동 초기화 (관리자용)
# ──────────────────────────────────────────────
class ResetRequest(BaseModel):
    provider: Optional[str] = None  # None → 전체 초기화


@app.post("/admin/circuit-reset")
async def circuit_reset(
    body: ResetRequest,
    current_user: User = Depends(get_current_user),
):
    """Circuit Breaker 수동 초기화. provider 생략 시 전체 초기화."""
    llm_router.reset(body.provider)
    return {
        "reset": body.provider or "all",
        "status": llm_router.status(),
    }


# ──────────────────────────────────────────────
# Stats
# ──────────────────────────────────────────────
@app.get("/stats")
async def get_stats(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    total_collections = (await session.exec(select(func.count(Collection.id)))).one()
    total_documents   = (await session.exec(select(func.count(Document.id)))).one()
    total_users       = (await session.exec(select(func.count(User.id)))).one()
    total_queries     = (await session.exec(select(func.count(UsageEvent.id)))).one()
    avg_latency       = (await session.exec(select(func.avg(UsageEvent.latency_ms)))).one() or 0
    total_cost        = (await session.exec(select(func.sum(UsageEvent.cost_usd)))).one() or 0

    return {
        "collections":  total_collections,
        "documents":    total_documents,
        "users":        total_users,
        "queries":      total_queries,
        "avg_latency_ms": int(avg_latency),
        "cost_usd":     float(total_cost),
        "stack":        f"Exo/{LLM_MODEL} + Qdrant + CrewAI",
    }


# ──────────────────────────────────────────────
# Collection Endpoints
# ──────────────────────────────────────────────
@app.get("/collections", response_model=list[CollectionRead])
async def list_collections(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = await session.exec(select(Collection))
    collections = result.all()
    output: list[CollectionRead] = []
    for c in collections:
        total_docs = (await session.exec(
            select(func.count(Document.id)).where(Document.collection_id == c.id)
        )).one()
        processing = (await session.exec(
            select(func.count(Document.id)).where(
                (Document.collection_id == c.id) & (Document.status == "processing")
            )
        )).one()
        failed = (await session.exec(
            select(func.count(Document.id)).where(
                (Document.collection_id == c.id) & (Document.status == "failed")
            )
        )).one()
        output.append(CollectionRead(
            id=c.id,
            name=c.name,
            xai_id=c.xai_id,
            description=c.description,
            category=c.category,
            tags=c.tags,
            created_at=c.created_at.isoformat(),
            documents_count=total_docs,
            processing_count=processing,
            failed_count=failed,
            status="processing" if processing > 0 else "active",
        ))
    return output


@app.post("/collections", response_model=CollectionRead)
async def create_collection(
    collection: CollectionCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    # Qdrant 컬렉션 이름 생성 (정규화)
    qdrant_name = collection_name_sanitize(collection.name)

    # 중복 이름 방지
    existing = (await session.exec(
        select(Collection).where(Collection.xai_id == qdrant_name)
    )).first()
    if existing:
        qdrant_name = f"{qdrant_name}_{uuid.uuid4().hex[:6]}"

    # Qdrant에 컬렉션 생성
    try:
        qdrant = get_qdrant()
        ensure_collection(qdrant, qdrant_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Qdrant Error: {str(e)}")

    # DB에 저장
    db_collection = Collection(
        name=collection.name,
        xai_id=qdrant_name,           # ← Qdrant 컬렉션 이름 저장
        description=collection.description,
        category=collection.category,
        tags=collection.tags,
    )
    session.add(db_collection)
    await session.commit()
    await session.refresh(db_collection)

    return CollectionRead(
        id=db_collection.id,
        name=db_collection.name,
        xai_id=db_collection.xai_id,
        description=db_collection.description,
        category=db_collection.category,
        tags=db_collection.tags,
        created_at=db_collection.created_at.isoformat(),
    )


@app.put("/collections/{collection_id}", response_model=CollectionRead)
async def update_collection(
    collection_id: int,
    body: CollectionUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    collection = await session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if body.name is not None:
        collection.name = body.name.strip()
    if body.description is not None:
        collection.description = body.description.strip() or None
    if body.category is not None:
        collection.category = body.category.strip() or None
    if body.tags is not None:
        collection.tags = body.tags.strip() or None

    session.add(collection)
    await session.commit()
    await session.refresh(collection)

    total_docs = (await session.exec(
        select(func.count(Document.id)).where(Document.collection_id == collection.id)
    )).one()

    return CollectionRead(
        id=collection.id,
        name=collection.name,
        xai_id=collection.xai_id,
        description=collection.description,
        category=collection.category,
        tags=collection.tags,
        created_at=collection.created_at.isoformat(),
        documents_count=total_docs,
    )


@app.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    collection = await session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Qdrant 컬렉션 삭제 시도
    try:
        qdrant = get_qdrant()
        qdrant.delete_collection(collection.xai_id)
    except Exception as e:
        print(f"Warning: Qdrant 컬렉션 삭제 실패: {e}")

    # DB 삭제
    await session.exec(delete(Document).where(Document.collection_id == collection_id))
    await session.exec(delete(Collection).where(Collection.id == collection_id))
    await session.commit()

    return {"status": "deleted", "id": collection_id}


# ──────────────────────────────────────────────
# Document Endpoints
# ──────────────────────────────────────────────
@app.get("/collections/{collection_id}", response_model=list[DocumentRead])
async def get_collection_documents(
    collection_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    collection = await session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    statement = select(Document).where(Document.collection_id == collection_id)
    results = await session.exec(statement)
    documents = results.all()

    return [
        DocumentRead(
            id=d.id,
            name=d.name,
            xai_doc_id=d.xai_doc_id,
            status=d.status,
            created_at=d.created_at.isoformat(),
        )
        for d in documents
    ]


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    doc = await session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Qdrant에서 해당 파일 청크 삭제
    try:
        collection = await session.get(Collection, doc.collection_id)
        if collection:
            qdrant = get_qdrant()
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            qdrant.delete(
                collection_name=collection.xai_id,
                points_selector=Filter(
                    must=[FieldCondition(key="source", match=MatchValue(value=doc.name))]
                ),
            )
    except Exception as e:
        print(f"Warning: Qdrant 청크 삭제 실패: {e}")

    await session.delete(doc)
    await session.commit()
    return {"status": "deleted", "id": document_id}


MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx", ".doc"}


def _extract_text_for_analyze(content: bytes, filename: str) -> str:
    """분석용 텍스트 추출 (간단 버전)"""
    ext = os.path.splitext(filename.lower())[1]
    if ext in (".txt", ".md"):
        return content.decode("utf-8", errors="replace")
    if ext in (".docx", ".doc"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception:
            return content.decode("utf-8", errors="replace")
    if ext == ".pdf":
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            return f"[PDF: {filename}]"
    return content.decode("utf-8", errors="replace")


@app.post("/collections/{collection_id}/upload")
async def upload_document(
    collection_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    version: Optional[str] = Form(None),
    date: Optional[str] = Form(None),
    relatedDocs: Optional[str] = Form(None),
    relationship_note: Optional[str] = Form(None),
    policy_note: Optional[str] = Form(None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    # 컬렉션 확인
    collection = await session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    file_ext = os.path.splitext(file.filename.lower())[1]
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. 지원: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기 초과 (최대 100MB)")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다")

    # 메타데이터 빌드
    extra_meta: dict = {}
    if version:
        extra_meta["version"] = version
    if date:
        extra_meta["date"] = date
    if relatedDocs:
        extra_meta["related_docs"] = relatedDocs
    if relationship_note:
        extra_meta["relationship_note"] = relationship_note
    if policy_note:
        extra_meta["policy_note"] = policy_note

    tag_list = [t.strip() for t in tags.split(",")] if tags else None

    # DB에 먼저 기록 (processing 상태)
    job_id = str(uuid.uuid4())
    doc = Document(
        name=file.filename,
        xai_doc_id=job_id,
        collection_id=collection.id,
        status="processing",
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    # 백그라운드에서 Qdrant 인제스트
    qdrant_name = collection.xai_id
    doc_id = doc.id
    file_content = content

    async def do_ingest():
        try:
            qdrant = get_qdrant()
            ensure_collection(qdrant, qdrant_name)
            chunks = ingest_bytes(
                client=qdrant,
                collection_name=qdrant_name,
                content=file_content,
                filename=file.filename,
                category=category,
                tags=tag_list,
                extra_metadata=extra_meta,
            )
            new_status = "processed" if chunks > 0 else "failed"
        except Exception as e:
            print(f"인제스트 실패 ({file.filename}): {e}")
            new_status = "failed"

        # 상태 업데이트
        async for s in get_session():
            d = await s.get(Document, doc_id)
            if d:
                d.status = new_status
                s.add(d)
                await s.commit()
            break

    background_tasks.add_task(do_ingest)

    return {
        "status": "processing",
        "document_id": doc.id,
        "job_id": job_id,
        "message": "백그라운드에서 인제스트 중입니다. /collections/{id} 에서 상태를 확인하세요.",
    }


# ──────────────────────────────────────────────
# AI Analyze (온톨로지 메타데이터 추천)
# ──────────────────────────────────────────────
ANALYZE_SYSTEM_PROMPT = """당신은 문서 온톨로지 구축을 돕는 전문 AI 어시스턴트입니다.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "category": "문서 카테고리 (정책/재무/기술/법률/인사/연구 등)",
  "tags": ["태그1", "태그2", "태그3"],
  "summary": "문서 내용 2-3줄 요약",
  "consulting": "이 문서를 온톨로지에 통합할 때 고려할 점과 추천사항"
}"""


@app.post("/analyze")
async def analyze_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """문서를 AI(Qwen 2.5 72B)로 분석하여 온톨로지 메타데이터를 추천합니다."""
    content = await file.read()
    filename = file.filename or "unknown"
    text = _extract_text_for_analyze(content, filename)
    if len(text) > 8000:
        text = text[:8000] + "\n...(이하 생략)"

    try:
        client = get_exo_client()
        completion = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
                {"role": "user",   "content": f"파일명: {filename}\n\n내용:\n{text}"},
            ],
            temperature=0.3,
            max_tokens=512,
        )
        answer = completion.choices[0].message.content.strip()

        # JSON 파싱 (```json ... ``` 블록 처리)
        cleaned = answer
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned)
        result = json.loads(cleaned)
        return {
            "category":   result.get("category", ""),
            "tags":       result.get("tags", []),
            "summary":    result.get("summary", ""),
            "consulting": result.get("consulting", ""),
        }
    except json.JSONDecodeError:
        return {"category": "", "tags": [], "summary": "", "consulting": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 분석 실패: {str(e)}")


COLLECTION_ANALYZE_PROMPT = """당신은 문서 컬렉션 온톨로지 구축을 돕는 전문 AI 어시스턴트입니다.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "description": "컬렉션 설명 (2-3줄)",
  "category": "컬렉션 카테고리",
  "tags": "태그1, 태그2, 태그3",
  "consulting": "이 컬렉션을 온톨로지에 통합할 때 고려할 점"
}"""


@app.post("/collections/{collection_id}/analyze")
async def analyze_collection(
    collection_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """컬렉션의 문서 목록을 AI로 분석하여 메타데이터를 추천합니다."""
    collection = await session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    statement = select(Document).where(Document.collection_id == collection_id)
    results = await session.exec(statement)
    documents = results.all()

    doc_list = "\n".join(f"- {d.name} (상태: {d.status})" for d in documents) if documents else "(문서 없음)"
    user_msg = (
        f"컬렉션 이름: {collection.name}\n"
        f"현재 설명: {collection.description or '(없음)'}\n"
        f"현재 카테고리: {collection.category or '(없음)'}\n"
        f"현재 태그: {collection.tags or '(없음)'}\n"
        f"문서 수: {len(documents)}\n\n"
        f"포함된 문서 목록:\n{doc_list}"
    )

    try:
        client = get_exo_client()
        completion = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": COLLECTION_ANALYZE_PROMPT},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.3,
            max_tokens=512,
        )
        answer = completion.choices[0].message.content.strip()
        cleaned = answer
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned)
        result = json.loads(cleaned)
        return {
            "description": result.get("description", ""),
            "category":    result.get("category", ""),
            "tags":        result.get("tags", ""),
            "consulting":  result.get("consulting", ""),
        }
    except json.JSONDecodeError:
        return {"description": "", "category": "", "tags": "", "consulting": answer}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 분석 실패: {str(e)}")


# ──────────────────────────────────────────────
# Chat Endpoint (RAG)
# ──────────────────────────────────────────────
@app.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    db_collection = await session.get(Collection, req.collection_id)
    if not db_collection:
        raise HTTPException(status_code=404, detail="지정한 컬렉션을 찾을 수 없습니다.")

    qdrant_collection = db_collection.xai_id
    request_id = str(uuid.uuid4())
    t0 = time.time()

    # 문서 없는 경우 조기 반환
    doc_count = (await session.exec(
        select(func.count(Document.id)).where(
            (Document.collection_id == db_collection.id) & (Document.status == "processed")
        )
    )).one()
    if doc_count == 0:
        return ChatResponse(
            request_id=request_id,
            answer="인덱싱된 문서가 없습니다. 먼저 문서를 업로드하고 인제스트를 기다려 주세요.",
            citations=[],
            cached=False,
            latency_ms=int((time.time() - t0) * 1000),
        )

    filters_dict = req.filters.model_dump(exclude_none=True) if req.filters else None

    # 캐시 확인
    cached = cache_get(qdrant_collection, LLM_MODEL, req.query, filters_dict)
    if cached:
        return ChatResponse(
            request_id=request_id,
            answer=cached["answer"],
            citations=cached.get("citations", []),
            cached=True,
            latency_ms=int((time.time() - t0) * 1000),
        )

    # RAG 실행
    result = await run_rag(
        collection_name=qdrant_collection,
        query=req.query,
        filters=filters_dict,
    )

    # 사용량 기록
    usage = result.get("usage", {})
    prompt_tokens     = usage.get("prompt_tokens")
    completion_tokens = usage.get("completion_tokens")
    total_tokens      = usage.get("total_tokens")
    cost = 0.0
    if prompt_tokens and completion_tokens:
        cost = (
            (prompt_tokens / 1_000_000) * COST_PER_1M_INPUT
            + (completion_tokens / 1_000_000) * COST_PER_1M_OUTPUT
        )

    try:
        session.add(UsageEvent(
            endpoint="/chat",
            model=LLM_MODEL,
            collection_id=db_collection.id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost,
            latency_ms=result.get("latency_ms"),
            cached=False,
        ))
        await session.commit()
    except Exception as e:
        print(f"Warning: 사용량 기록 실패: {e}")

    cache_set(qdrant_collection, LLM_MODEL, req.query, filters_dict, result)

    return ChatResponse(
        request_id=request_id,
        answer=result["answer"],
        citations=result.get("citations", []),
        cached=False,
        latency_ms=int((time.time() - t0) * 1000),
    )


# ──────────────────────────────────────────────
# Agent Endpoint (CrewAI) — NEW
# ──────────────────────────────────────────────
@app.post("/agent", response_model=AgentResponse)
async def agent_chat(
    req: AgentRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """
    CrewAI 멀티 에이전트 RAG 엔드포인트.

    mode:
    - "single"        : 단일 에이전트 (빠름)
    - "rag_crew"      : 리서처 + 분석가 2-에이전트 (기본값, 균형)
    - "research_crew" : 리서처 + 팩트체커 + 작성자 3-에이전트 (심층 분석)
    """
    db_collection = await session.get(Collection, req.collection_id)
    if not db_collection:
        raise HTTPException(status_code=404, detail="지정한 컬렉션을 찾을 수 없습니다.")

    qdrant_collection = db_collection.xai_id
    request_id = str(uuid.uuid4())
    t0 = time.time()

    try:
        from agents.crew import run_single_agent, run_rag_crew, run_research_crew

        # crew.kickoff() 는 동기 호출이라 실행 중인 이벤트 루프 안에서 직접 부르면
        # CrewAI 가 거부합니다(1.x). 워커 스레드로 넘겨 실행하면 그 스레드에는
        # 이벤트 루프가 없어 정상 동작하고, 동시에 API 이벤트 루프도 막히지 않습니다.
        if req.mode == "single":
            result = await asyncio.to_thread(run_single_agent, req.query, qdrant_collection)
        elif req.mode == "research_crew":
            result = await asyncio.to_thread(run_research_crew, req.query, qdrant_collection)
        else:  # rag_crew (default)
            result = await asyncio.to_thread(run_rag_crew, req.query, qdrant_collection)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"에이전트 실행 실패: {str(e)}")

    latency_ms = int((time.time() - t0) * 1000)
    return AgentResponse(
        request_id=request_id,
        answer=result.get("answer", ""),
        mode=result.get("mode", req.mode),
        latency_ms=latency_ms,
    )
