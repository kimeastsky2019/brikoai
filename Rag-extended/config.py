"""
config.py — Exo + Qdrant + BGE-M3 설정
xAI/Grok 의존성 완전 제거
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# LLM: Exo 1.0 (OpenAI-compatible, 로컬 클러스터)
# ──────────────────────────────────────────────
# 로컬 추론 노드가 없는 호스트(예: 2GB 클라우드 서버)에서는 EXO_ENABLED=false 로
# 꺼 둡니다. 켜 두면 라우터가 매번 1순위로 시도했다가 실패하고 폴백하느라
# 첫 요청이 타임아웃만큼 느려집니다.
EXO_ENABLED  = os.getenv("EXO_ENABLED", "true").lower() == "true"
EXO_BASE_URL = os.getenv("EXO_BASE_URL", "http://localhost:52415/v1")
EXO_API_KEY  = os.getenv("EXO_API_KEY", "local")   # Exo는 키 불필요
LLM_MODEL    = os.getenv("LLM_MODEL", "qwen2.5:72b")  # 한국어 최적

# ──────────────────────────────────────────────
# Embedding
#   fastembed : ONNX 경량 다국어 모델 (저사양 서버 기본값, 384-dim)
#   ollama    : BGE-M3 via Ollama   (고사양 호스트, 1024-dim)
# provider 를 바꾸면 EMBED_DIM 도 함께 바꿔야 합니다 — 컬렉션 생성 시 고정됩니다.
# ──────────────────────────────────────────────
EMBED_PROVIDER  = os.getenv("EMBED_PROVIDER", "fastembed").lower()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL     = os.getenv("EMBED_MODEL", "bge-m3")

# 한국어를 포함한 50여 개 언어를 지원하는 384-dim 모델. ONNX 가중치 약 0.44GB 로
# 2GB RAM 서버에서도 상주 가능합니다.
FASTEMBED_MODEL = os.getenv(
    "FASTEMBED_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
)
FASTEMBED_CACHE_DIR = os.getenv("FASTEMBED_CACHE_DIR", "")

_DEFAULT_EMBED_DIM = "384" if EMBED_PROVIDER == "fastembed" else "1024"
EMBED_DIM       = int(os.getenv("EMBED_DIM", _DEFAULT_EMBED_DIM))

# ──────────────────────────────────────────────
# Vector DB: Qdrant (로컬, ARM 네이티브)
# ──────────────────────────────────────────────
QDRANT_HOST    = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT    = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", None)  # 로컬은 None

# ──────────────────────────────────────────────
# Search & Chunking
# ──────────────────────────────────────────────
TOP_K          = int(os.getenv("TOP_K", "5"))
CHUNK_SIZE     = int(os.getenv("CHUNK_SIZE", "512"))    # 문자 단위
CHUNK_OVERLAP  = int(os.getenv("CHUNK_OVERLAP", "64"))

# 섹션 인지 청킹 — 마크다운/번호 헤딩으로 먼저 자르고, 섹션이 크면 그 안에서만 쪼갠다.
SECTION_AWARE_CHUNKING = os.getenv("SECTION_AWARE_CHUNKING", "true").lower() == "true"

# 하이브리드 검색 (dense 벡터 + BM25 스파스, RRF 융합)
HYBRID_SEARCH  = os.getenv("HYBRID_SEARCH", "true").lower() == "true"
SPARSE_MODEL   = os.getenv("SPARSE_MODEL", "Qdrant/bm25")
SPARSE_VECTOR_NAME = "bm25"      # Qdrant 내 스파스 벡터 이름 (변경 시 재색인 필요)
DENSE_VECTOR_NAME  = "dense"     # 신규 컬렉션의 명명 벡터. 구 컬렉션은 무명 벡터.
RRF_PREFETCH   = int(os.getenv("RRF_PREFETCH", "40"))   # 융합 전 각 경로가 가져올 후보 수

# ──────────────────────────────────────────────
# 원본 파일 보관소 (데이터 계약 P1)
# ──────────────────────────────────────────────
# rag.db 와 같은 백업 단위로 묶여야 대장과 원본의 정합이 유지된다.
FILES_ROOT     = os.getenv("FILES_ROOT", "/opt/rag/data/files")

# ──────────────────────────────────────────────
# LLM Wiki 연동 (work.ets0404.com)
#
# 지식DB 화면의 '위키에 저장' 이 원본 PDF 를 위키의 /api/wiki/ingest 로 넘긴다.
# 브라우저에서 직접 부르지 않고 서버가 중계하는 이유:
#   - work.ets0404.com 은 nginx basic auth 뒤에 있어 브라우저가 인증창을 띄운다
#   - 교차 출처라 CORS 를 따로 열어야 한다
# 같은 호스트의 루프백으로 부르면 둘 다 우회하면서 자격증명도 브라우저에 안 남는다.
# 비어 있으면 연동 기능이 꺼진다.
# ──────────────────────────────────────────────
# 서비스 간(rag-api ↔ llmwiki) 호출용 공유 토큰. 사용자 JWT 가 아니라 서버끼리
# 쓰는 자격증명이라 별도로 둔다. 비어 있으면 내부 API 가 열리지 않는다.
INTERNAL_API_TOKEN  = os.getenv("INTERNAL_API_TOKEN", "")

LLMWIKI_BASE_URL    = os.getenv("LLMWIKI_BASE_URL", "")            # 예: http://127.0.0.1:8722
LLMWIKI_PUBLIC_URL  = os.getenv("LLMWIKI_PUBLIC_URL", "")          # 예: https://work.ets0404.com
# 위키 적재는 PDF 파싱 + LLM 서술 생성이라 수 분이 걸린다.
LLMWIKI_TIMEOUT_SEC = float(os.getenv("LLMWIKI_TIMEOUT_SEC", "840"))

# ──────────────────────────────────────────────
# Cache (in-memory LRU)
# ──────────────────────────────────────────────
CACHE_TTL_SEC  = int(os.getenv("CACHE_TTL_SEC", "300"))
CACHE_MAXSIZE  = int(os.getenv("CACHE_MAXSIZE", "2048"))

# ──────────────────────────────────────────────
# CrewAI Agent Settings
# ──────────────────────────────────────────────
AGENT_VERBOSE  = os.getenv("AGENT_VERBOSE", "false").lower() == "true"
AGENT_MAX_ITER = int(os.getenv("AGENT_MAX_ITER", "5"))

# ──────────────────────────────────────────────
# System Prompt (RAG Guardrail)
# ──────────────────────────────────────────────
SYSTEM_GUARDRAIL = os.getenv(
    "SYSTEM_GUARDRAIL",
    "당신은 사내 문서 기반 RAG 어시스턴트입니다. "
    "반드시 제공된 컨텍스트(검색 결과)에 근거해 한국어로 답변하라. "
    "컨텍스트에 없는 내용은 추측하지 말고 '제공된 문서 근거로는 확인할 수 없습니다'라고 답하라. "
    "답변 끝에 핵심 근거(문서명/페이지)를 2~5개 bullet로 제공하라. "
    "문서에 'relationship_note'나 'policy_note' 메타데이터가 있으면 답변에 반영하라."
)

# ──────────────────────────────────────────────
# Cost Tracking (로컬 추론은 $0 이지만 기록 유지)
# ──────────────────────────────────────────────
COST_PER_1M_INPUT  = float(os.getenv("COST_PER_1M_INPUT", "0.0"))
COST_PER_1M_OUTPUT = float(os.getenv("COST_PER_1M_OUTPUT", "0.0"))

# ──────────────────────────────────────────────
# Hybrid Fallback: Grok (xAI) — Fallback 1
# ──────────────────────────────────────────────
XAI_API_KEY = os.getenv("XAI_API_KEY", "")              # 비어있으면 Grok 스킵
XAI_MODEL   = os.getenv("XAI_MODEL", "grok-3-mini")     # 속도 우선

# ──────────────────────────────────────────────
# Hybrid Fallback: ChatGPT (OpenAI) — Fallback 2
# ──────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")        # 비어있으면 ChatGPT 스킵
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

# ──────────────────────────────────────────────
# Hybrid Fallback: Claude (Anthropic) — Fallback 3
# ──────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")  # 비어있으면 Claude 스킵
CLAUDE_MODEL      = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")  # 비용 효율 최우선

# xAI(Grok) 엔드포인트 — OpenAI 호환
XAI_BASE_URL = os.getenv("XAI_BASE_URL", "https://api.x.ai/v1")

# ──────────────────────────────────────────────
# Circuit Breaker 설정
# ──────────────────────────────────────────────
CB_FAILURE_THRESHOLD = int(os.getenv("CB_FAILURE_THRESHOLD", "3"))   # 연속 실패 N회 → OPEN
CB_TIMEOUT_SEC       = float(os.getenv("CB_TIMEOUT_SEC", "30.0"))    # 응답 제한 시간(초)
CB_RECOVERY_SEC      = int(os.getenv("CB_RECOVERY_SEC", "60"))       # OPEN 후 재시도 대기(초)
