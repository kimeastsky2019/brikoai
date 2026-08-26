#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# install.sh — RAG-AI_Gov 올인원 설치 (Linux 서버)
#
# 설치 구성:
#   - Qdrant       (Docker, :6333)          벡터 DB
#   - Ollama       (네이티브, :11434)        bge-m3 임베딩 + LLM 로컬 추론
#   - FastAPI      (systemd, :8000)          백엔드 API
#   - Nginx        (:80)                     정적 프론트 + /api 리버스 프록시
#
# 사용법:
#   sudo bash deploy/install.sh
#
# 멱등(idempotent) — 여러 번 실행해도 안전합니다.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/rag-ai-gov}"
APP_USER="${APP_USER:-ragai}"
API_PORT="${API_PORT:-8000}"
# 서버 사양에 맞춰 조정 (deploy/README.md '모델 선택' 참고)
#
# 기본값 Qwen3-30B-A3B: MoE 구조라 총 30B 중 활성 파라미터가 3B뿐 →
# 동급 dense 모델 대비 토큰 생성이 훨씬 빠릅니다. CrewAI는 질의 1건당
# LLM을 여러 번 호출하므로 이 차이가 응답시간에 그대로 곱해집니다.
#
# 비-thinking(Instruct) 변형을 쓰는 이유는 README '알려진 특이사항' 참고 —
# thinking 모델은 추론 과정이 답변 본문에 그대로 섞여 나옵니다.
# Ollama 공식 라이브러리의 qwen3:30b-a3b 는 hybrid thinking 모델이라
# 비-thinking 전용인 Instruct-2507 GGUF 를 HuggingFace 에서 직접 받습니다.
LLM_MODEL="${LLM_MODEL:-hf.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M}"
EMBED_MODEL="${EMBED_MODEL:-bge-m3}"

log()  { echo -e "\033[1;32m[+]\033[0m $*"; }
warn() { echo -e "\033[1;33m[!]\033[0m $*"; }
die()  { echo -e "\033[1;31m[x]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root 권한이 필요합니다: sudo bash deploy/install.sh"

# ── 0. 패키지 매니저 감지 ──────────────────────────────────────
if   command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf     >/dev/null 2>&1; then PM=dnf
elif command -v yum     >/dev/null 2>&1; then PM=yum
else die "지원하지 않는 배포판입니다 (apt/dnf/yum 없음)"
fi
log "패키지 매니저: $PM"

pkg_install() {
  case "$PM" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
  esac
}

log "패키지 목록 갱신"
case "$PM" in
  apt) apt-get update -y ;;
  dnf|yum) $PM makecache -y || true ;;
esac

# ── 1. 기본 패키지 ────────────────────────────────────────────
log "기본 패키지 설치 (python3, nginx, git, curl)"
if [ "$PM" = apt ]; then
  pkg_install python3 python3-venv python3-dev python3-pip build-essential \
              nginx git curl ca-certificates gnupg
else
  pkg_install python3 python3-devel python3-pip gcc gcc-c++ make \
              nginx git curl ca-certificates
fi

PY=python3
$PY -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)' \
  || die "Python 3.10+ 가 필요합니다 (현재: $($PY -V)). 먼저 업그레이드하세요."
log "Python: $($PY -V)"

# ── 2. Docker (Qdrant 용) ─────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Docker 설치"
  curl -fsSL https://get.docker.com | sh
else
  log "Docker 이미 설치됨: $(docker --version)"
fi
systemctl enable --now docker

# ── 3. Qdrant 컨테이너 ────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -qx qdrant; then
  log "Qdrant 컨테이너 존재 — 재시작"
  docker start qdrant >/dev/null || true
else
  log "Qdrant 컨테이너 생성 (:6333)"
  mkdir -p /var/lib/qdrant
  docker run -d --name qdrant --restart unless-stopped \
    -p 127.0.0.1:6333:6333 -p 127.0.0.1:6334:6334 \
    -v /var/lib/qdrant:/qdrant/storage \
    qdrant/qdrant
fi

# ── 3-1. GPU 확인 ─────────────────────────────────────────────
# 드라이버가 없으면 Ollama는 오류 없이 CPU로 폴백합니다.
# 30B 모델을 CPU로 돌리면 응답이 수 분 단위가 되므로 여기서 명확히 걸러냅니다.
GPU_OK=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  GPU_OK=1
  log "GPU 감지:"
  nvidia-smi --query-gpu=name,memory.total,driver_version \
             --format=csv,noheader | sed 's/^/      /'
else
  warn "NVIDIA 드라이버를 찾을 수 없습니다 (nvidia-smi 실패)."
  warn "이 상태로 진행하면 Ollama가 CPU 추론으로 폴백해 응답이 수 분 단위가 됩니다."
  warn "드라이버 설치 후 재실행을 권장합니다:"
  case "$PM" in
    apt) warn "  sudo apt-get install -y nvidia-driver-550 && sudo reboot" ;;
    *)   warn "  sudo dnf install -y nvidia-driver && sudo reboot" ;;
  esac
  if [ "${FORCE_CPU:-0}" != "1" ]; then
    die "GPU 없이 강행하려면 FORCE_CPU=1 을 붙여 재실행하세요 (작은 모델 권장: LLM_MODEL=qwen3:8b)"
  fi
  warn "FORCE_CPU=1 — CPU 추론으로 계속 진행합니다"
fi

# ── 4. Ollama ─────────────────────────────────────────────────
if ! command -v ollama >/dev/null 2>&1; then
  log "Ollama 설치"
  curl -fsSL https://ollama.com/install.sh | sh
else
  log "Ollama 이미 설치됨: $(ollama --version 2>/dev/null || echo unknown)"
fi
systemctl enable --now ollama
sleep 3

# GPU 환경이면 VRAM 절약 설정 적용 (A30 24GB 기준: LLM ~18.6GB + bge-m3 ~1.2GB + KV 캐시)
if [ "$GPU_OK" = 1 ]; then
  log "Ollama GPU 튜닝 적용 (flash attention, KV 캐시 q8_0, ctx 8192)"
  mkdir -p /etc/systemd/system/ollama.service.d
  cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
Environment="OLLAMA_KEEP_ALIVE=-1"
EOF
  systemctl daemon-reload
  systemctl restart ollama
  sleep 3
fi

log "임베딩 모델 pull: $EMBED_MODEL (약 1.2GB)"
ollama pull "$EMBED_MODEL"

log "LLM pull: $LLM_MODEL (약 19GB — 수 분 소요)"
if ! ollama pull "$LLM_MODEL"; then
  warn "LLM pull 실패: $LLM_MODEL"
  warn "태그가 변경되었을 수 있습니다. 사용 가능한 변형을 확인 후 재실행하세요:"
  warn "  sudo LLM_MODEL=<태그> bash deploy/install.sh"
  die "LLM 모델 없이는 서비스가 동작하지 않습니다"
fi

# ── 5. 서비스 계정 & 배포 디렉터리 ─────────────────────────────
id -u "$APP_USER" >/dev/null 2>&1 || {
  log "서비스 계정 생성: $APP_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null \
    || useradd --system --create-home --shell /sbin/nologin "$APP_USER"
}

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log "소스: $SRC_DIR  →  배포: $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .venv --exclude '*.db' \
  "$SRC_DIR/" "$APP_DIR/"

# ── 6. Python 가상환경 ────────────────────────────────────────
log "Python 가상환경 + 의존성 설치 (수 분 소요)"
$PY -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip wheel setuptools
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/Rag-extended/requirements.txt"

# ── 7. .env 생성 (없을 때만) ──────────────────────────────────
ENV_FILE="$APP_DIR/Rag-extended/.env"
if [ -f "$ENV_FILE" ]; then
  log ".env 이미 존재 — 유지"
else
  log ".env 생성"
  SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
# ── LLM: Ollama 로컬 추론 (OpenAI 호환 엔드포인트) ──
EXO_BASE_URL=http://127.0.0.1:11434/v1
EXO_API_KEY=ollama
LLM_MODEL=$LLM_MODEL

# ── Embedding: Ollama BGE-M3 ──
OLLAMA_BASE_URL=http://127.0.0.1:11434
EMBED_MODEL=$EMBED_MODEL
EMBED_DIM=1024

# ── Vector DB: Qdrant ──
QDRANT_HOST=127.0.0.1
QDRANT_PORT=6333

# ── 검색 파라미터 ──
TOP_K=5
CHUNK_SIZE=512
CHUNK_OVERLAP=64

# ── 캐시 ──
CACHE_TTL_SEC=300
CACHE_MAXSIZE=2048

# ── 에이전트 ──
AGENT_VERBOSE=false
AGENT_MAX_ITER=5

# ── 인증 ──
SECRET_KEY=$SECRET
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# ── Circuit Breaker ──
CB_FAILURE_THRESHOLD=3
CB_TIMEOUT_SEC=120.0
CB_RECOVERY_SEC=60

# ──────────────────────────────────────────────
# 폴백 체인 — 로컬(Ollama) 장애 시 자동 전환
#   1순위 로컬 → 2순위 Grok → 3순위 ChatGPT → 4순위 Claude
# 키가 비어 있는 provider 는 건너뜁니다. 키를 채우고 재시작하면 즉시 적용됩니다.
#   sudo systemctl restart rag-api
# ──────────────────────────────────────────────

# [Fallback 1] Grok / xAI
# XAI_API_KEY=xai-...
XAI_MODEL=grok-3-mini

# [Fallback 2] ChatGPT / OpenAI
# OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# [Fallback 3] Claude / Anthropic
# ANTHROPIC_API_KEY=sk-ant-...
EOF
  chmod 600 "$ENV_FILE"
fi

# CrewAI 저장소 디렉터리 (systemd 유닛의 HOME/XDG/CREWAI_STORAGE_DIR 이 여기를 가리킴)
mkdir -p "$APP_DIR/.local/share" "$APP_DIR/.cache" "$APP_DIR/.crewai"

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ── 8. systemd 서비스 ─────────────────────────────────────────
log "systemd 유닛 등록: rag-api.service"
sed -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@APP_USER@|$APP_USER|g" \
    -e "s|@API_PORT@|$API_PORT|g" \
    "$SRC_DIR/deploy/rag-api.service" > /etc/systemd/system/rag-api.service
systemctl daemon-reload
systemctl enable rag-api
systemctl restart rag-api

# ── 9. 프론트엔드 빌드 결과 배치 ───────────────────────────────
WEB_ROOT=/var/www/rag-ai-gov
mkdir -p "$WEB_ROOT"
if [ -d "$SRC_DIR/dist" ]; then
  log "프론트엔드 배치: $WEB_ROOT"
  rsync -a --delete "$SRC_DIR/dist/" "$WEB_ROOT/"
  chown -R nginx:nginx "$WEB_ROOT" 2>/dev/null || chown -R www-data:www-data "$WEB_ROOT" 2>/dev/null || true
else
  warn "dist/ 없음 — 로컬에서 'VITE_API_BASE_URL=/api npm run build' 후 dist/ 를 함께 업로드하세요"
fi

# ── 10. Nginx ────────────────────────────────────────────────
log "Nginx 설정"
# 서버 블록이 include 하는 공통 snippet 을 먼저 배치해야 nginx -t 가 통과합니다.
mkdir -p /etc/nginx/snippets
cp "$SRC_DIR"/deploy/snippets/rag-ai-gov-*.conf /etc/nginx/snippets/
if [ -d /etc/nginx/sites-available ]; then
  cp "$SRC_DIR/deploy/nginx-rag-ai-gov.conf" /etc/nginx/sites-available/rag-ai-gov.conf
  ln -sf /etc/nginx/sites-available/rag-ai-gov.conf /etc/nginx/sites-enabled/rag-ai-gov.conf
  rm -f /etc/nginx/sites-enabled/default
else
  cp "$SRC_DIR/deploy/nginx-rag-ai-gov.conf" /etc/nginx/conf.d/rag-ai-gov.conf
fi
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

# ── 10-1. 방화벽 (HTTP/HTTPS 개방) ───────────────────────────
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "ufw: 80/tcp, 443/tcp 개방"
  ufw allow 80/tcp
  ufw allow 443/tcp
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  log "firewalld: http/https 서비스 개방"
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --reload
else
  warn "방화벽 미감지 — 클라우드 보안그룹에서 80/tcp, 443/tcp 인바운드를 직접 허용하세요"
fi

# ── 11. 헬스체크 ─────────────────────────────────────────────
log "기동 대기 (15초)"
sleep 15
echo
echo "──────────── 상태 ────────────"
systemctl is-active rag-api  && echo "rag-api : active"  || warn "rag-api 비정상 → journalctl -u rag-api -n 50"
systemctl is-active nginx    && echo "nginx   : active"  || warn "nginx 비정상"
docker ps --filter name=qdrant --format 'qdrant  : {{.Status}}'
curl -fsS "http://127.0.0.1:$API_PORT/health" && echo || warn "/health 응답 없음"
echo "──────────────────────────────"
echo
log "설치 완료"
echo "  웹      : http://<서버주소>/"
echo "  API     : http://<서버주소>/api/health"
echo "  기본계정: info@gngmeta.com / admin1234   ← 반드시 변경하세요"
