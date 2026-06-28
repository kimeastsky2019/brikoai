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
EXO_BASE_URL = os.getenv("EXO_BASE_URL", "http://localhost:52415/v1")
EXO_API_KEY  = os.getenv("EXO_API_KEY", "local")   # Exo는 키 불필요
LLM_MODEL    = os.getenv("LLM_MODEL", "qwen2.5:72b")  # 한국어 최적

# ──────────────────────────────────────────────
# Embedding: BGE-M3 via Ollama (한/영/중 다국어)
# ──────────────────────────────────────────────
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL     = os.getenv("EMBED_MODEL", "bge-m3")
EMBED_DIM       = int(os.getenv("EMBED_DIM", "1024"))

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
# Hybrid Fallback: Claude (Anthropic) — Fallback 2
# ──────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")  # 비어있으면 Claude 스킵
CLAUDE_MODEL      = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")  # 비용 효율 최우선

# ──────────────────────────────────────────────
# Circuit Breaker 설정
# ──────────────────────────────────────────────
CB_FAILURE_THRESHOLD = int(os.getenv("CB_FAILURE_THRESHOLD", "3"))   # 연속 실패 N회 → OPEN
CB_TIMEOUT_SEC       = float(os.getenv("CB_TIMEOUT_SEC", "30.0"))    # 응답 제한 시간(초)
CB_RECOVERY_SEC      = int(os.getenv("CB_RECOVERY_SEC", "60"))       # OPEN 후 재시도 대기(초)
