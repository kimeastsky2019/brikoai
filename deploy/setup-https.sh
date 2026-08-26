#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# setup-https.sh — HTTPS 적용
#
# 두 가지 모드:
#
#   1) 자체 서명 (기본) — 도메인 없이 IP 로만 접속할 때
#      sudo bash deploy/setup-https.sh
#      → 즉시 암호화되지만 브라우저가 경고를 띄웁니다.
#
#   2) Let's Encrypt — 도메인이 이 서버를 가리킬 때
#      sudo bash deploy/setup-https.sh rag.example.com admin@example.com
#      → 브라우저 경고 없는 신뢰 인증서.
#        사전 조건: 도메인 A 레코드가 이 서버 IP 를 향할 것, 80/443 개방
#
# 멱등 — 여러 번 실행해도 안전합니다.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
CERT_DIR=/etc/ssl/rag-ai-gov
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { echo -e "\033[1;32m[+]\033[0m $*"; }
warn() { echo -e "\033[1;33m[!]\033[0m $*"; }
die()  { echo -e "\033[1;31m[x]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root 권한이 필요합니다: sudo bash deploy/setup-https.sh"

# ── Nginx 설정 배치 ───────────────────────────────────────────
log "Nginx HTTPS 설정 배치"
if [ -d /etc/nginx/sites-available ]; then
  NGINX_CONF=/etc/nginx/sites-available/rag-ai-gov.conf
  cp "$SRC_DIR/deploy/nginx-rag-ai-gov.conf" "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/rag-ai-gov.conf
else
  NGINX_CONF=/etc/nginx/conf.d/rag-ai-gov.conf
  cp "$SRC_DIR/deploy/nginx-rag-ai-gov.conf" "$NGINX_CONF"
fi

# ── HTTP/2 구문 호환 ──────────────────────────────────────────
# 'http2 on;' 은 nginx 1.25.1 이상에서만 유효합니다.
# 그 이전(예: Ubuntu 24.04 의 1.24)은 listen 지시자에 http2 플래그를 붙여야 합니다.
NGINX_VER="$(nginx -v 2>&1 | sed -E 's|.*/([0-9.]+).*|\1|')"
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

if ver_ge "$NGINX_VER" "1.25.1"; then
  log "nginx $NGINX_VER — 'http2 on;' 구문 사용"
else
  log "nginx $NGINX_VER — 구 구문으로 변환 (listen ... http2)"
  sed -i '/^\s*# HTTP\/2 활성화/,+2d' "$NGINX_CONF"   # 안내 주석 + http2 on; 제거
  sed -i 's|^\(\s*\)listen 443 ssl;|\1listen 443 ssl http2;|'         "$NGINX_CONF"
  sed -i 's|^\(\s*\)listen \[::\]:443 ssl;|\1listen [::]:443 ssl http2;|' "$NGINX_CONF"
fi

# ══════════════════════════════════════════════════════════════
# 모드 1: Let's Encrypt (도메인 지정 시)
# ══════════════════════════════════════════════════════════════
if [ -n "$DOMAIN" ]; then
  log "Let's Encrypt 모드 — 도메인: $DOMAIN"

  # 도메인이 실제로 이 서버를 가리키는지 먼저 확인 (아니면 발급이 반드시 실패)
  MY_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo '')"
  DOM_IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo '')"
  if [ -n "$MY_IP" ] && [ -n "$DOM_IP" ] && [ "$MY_IP" != "$DOM_IP" ]; then
    warn "도메인이 다른 IP 를 가리킵니다: $DOMAIN → $DOM_IP (이 서버: $MY_IP)"
    die  "DNS A 레코드를 $MY_IP 로 변경한 뒤 다시 실행하세요"
  fi
  [ -n "$DOM_IP" ] || die "도메인 $DOMAIN 을 해석할 수 없습니다 (A 레코드 확인)"

  command -v certbot >/dev/null 2>&1 || {
    log "certbot 설치"
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
    else
      dnf install -y certbot python3-certbot-nginx || yum install -y certbot python3-certbot-nginx
    fi
  }

  # server_name 을 실제 도메인으로 교체 (certbot 이 블록을 찾을 수 있도록)
  sed -i "s/server_name _;/server_name $DOMAIN;/g" "$NGINX_CONF"

  # 검증 경로 준비 + 임시 인증서로 nginx 가 뜨도록 보장
  mkdir -p /var/www/html
  [ -f "$CERT_DIR/fullchain.pem" ] || bash "$0" __selfsigned_only

  nginx -t && systemctl reload nginx

  EMAIL_ARG="--register-unsafely-without-email"
  [ -n "$EMAIL" ] && EMAIL_ARG="--email $EMAIL"

  log "인증서 발급"
  certbot --nginx -d "$DOMAIN" --agree-tos --non-interactive --redirect $EMAIL_ARG

  log "자동 갱신 확인"
  systemctl list-timers 2>/dev/null | grep -q certbot && echo "  certbot 타이머 활성" \
    || warn "certbot 자동 갱신 타이머를 찾지 못했습니다 — 'certbot renew --dry-run' 으로 확인하세요"

  echo
  log "완료 — https://$DOMAIN/"
  exit 0
fi

# ══════════════════════════════════════════════════════════════
# 모드 2: 자체 서명 (기본)
# ══════════════════════════════════════════════════════════════
log "자체 서명 인증서 모드"

mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/fullchain.pem" ] && [ "${1:-}" != "__selfsigned_only" ]; then
  # 만료가 30일 이상 남았으면 재생성하지 않음
  if openssl x509 -checkend 2592000 -noout -in "$CERT_DIR/fullchain.pem" >/dev/null 2>&1; then
    log "기존 인증서 유효 — 재생성 건너뜀"
    SKIP_GEN=1
  fi
fi

if [ "${SKIP_GEN:-0}" != 1 ]; then
  # 접속에 쓰이는 IP 를 SAN 에 넣어야 브라우저/클라이언트가 대상으로 인정합니다.
  PUB_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo '')"
  LOCAL_IPS="$(hostname -I 2>/dev/null || echo '')"

  SAN="DNS:localhost,IP:127.0.0.1"
  for ip in $PUB_IP $LOCAL_IPS; do
    case ",$SAN," in *",IP:$ip,"*) continue ;; esac
    SAN="$SAN,IP:$ip"
  done
  log "인증서 SAN: $SAN"

  openssl req -x509 -nodes -newkey rsa:2048 \
    -days 3650 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out    "$CERT_DIR/fullchain.pem" \
    -subj   "/C=KR/O=GnG Meta/CN=${PUB_IP:-rag-ai-gov}" \
    -addext "subjectAltName=$SAN" \
    -addext "basicConstraints=CA:FALSE" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth" \
    2>/dev/null

  chmod 600 "$CERT_DIR/privkey.pem"
  chmod 644 "$CERT_DIR/fullchain.pem"
  log "인증서 생성 완료 (유효기간 10년)"
fi

# certbot 내부 호출이면 여기서 종료
[ "${1:-}" = "__selfsigned_only" ] && exit 0

nginx -t
systemctl reload nginx || systemctl restart nginx

# ── 방화벽 443 ────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 443/tcp && log "ufw: 443/tcp 개방"
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=https && firewall-cmd --reload && log "firewalld: https 개방"
else
  warn "방화벽 미감지 — 클라우드 보안그룹에서 443/tcp 인바운드를 반드시 허용하세요"
fi

echo
echo "──────────── 확인 ────────────"
curl -sk -o /dev/null -w "HTTPS 로컬 응답 : %{http_code}\n" https://127.0.0.1/
curl -s  -o /dev/null -w "HTTP  리다이렉트: %{http_code} → %{redirect_url}\n" http://127.0.0.1/
openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -subject -enddate -ext subjectAltName 2>/dev/null | sed 's/^/  /'
echo "──────────────────────────────"
echo
log "완료 — https://<서버주소>/"
warn "자체 서명이라 브라우저가 '연결이 비공개가 아닙니다' 경고를 띄웁니다."
warn "통신은 암호화되지만, 경고 없는 인증서를 원하면 도메인 연결 후:"
echo "    sudo bash deploy/setup-https.sh <도메인> <이메일>"
