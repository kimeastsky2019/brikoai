#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# enable-letsencrypt-sllm.sh
#
# sllm.ets0404.com 의 자체서명 인증서를 Let's Encrypt 정식 인증서로 교체합니다.
#
# 선행 조건 — DNS A 레코드가 이 서버를 가리켜야 합니다:
#     sllm.ets0404.com.  A  211.119.38.148
#   (ets0404.com / www 는 아임웹 호스팅이므로 건드리지 마세요.)
#
# 사용법:  sudo bash deploy/enable-letsencrypt-sllm.sh
# 멱등 — 여러 번 실행해도 안전합니다.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${DOMAIN:-sllm.ets0404.com}"
EMAIL="${EMAIL:-dhkim@gngmeta.com}"
SITE="/etc/nginx/sites-available/${DOMAIN}"
WEBROOT="/var/www/certbot"

log()  { echo -e "\033[1;32m[+]\033[0m $*"; }
warn() { echo -e "\033[1;33m[!]\033[0m $*"; }
die()  { echo -e "\033[1;31m[x]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root 권한이 필요합니다: sudo bash $0"
[ -f "$SITE" ] || die "nginx 사이트 설정을 찾을 수 없습니다: $SITE"

# ── 1. DNS 가 이 서버를 가리키는지 먼저 확인 ──
# 이 확인 없이 certbot 을 돌리면 실패가 Let's Encrypt 의 시간당 요청 한도에
# 그대로 쌓입니다.
MYIP="$(curl -fsS --max-time 10 https://api.ipify.org || echo '')"
DNSIP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || echo '')"

if [ -z "$DNSIP" ]; then
  die "$DOMAIN 의 A 레코드가 없습니다. DNS 에 'A ${DOMAIN} → ${MYIP:-211.119.38.148}' 를 먼저 추가하세요."
fi
if [ -n "$MYIP" ] && [ "$DNSIP" != "$MYIP" ]; then
  die "$DOMAIN 이 $DNSIP 를 가리킵니다 (이 서버는 $MYIP). DNS 전파를 기다리세요."
fi
log "DNS 확인: $DOMAIN → $DNSIP"

# ── 2. ACME webroot 준비 ──
mkdir -p "$WEBROOT"
chown -R www-data:www-data "$WEBROOT" 2>/dev/null || true

# ── 3. 인증서 발급 ──
log "Let's Encrypt 인증서 발급 (HTTP-01, webroot)"
certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
  --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring

LIVE="/etc/letsencrypt/live/${DOMAIN}"
[ -f "$LIVE/fullchain.pem" ] || die "발급에 실패했습니다: $LIVE/fullchain.pem 없음"

# ── 4. nginx 인증서 경로 교체 ──
if grep -q "/etc/ssl/sllm/fullchain.pem" "$SITE"; then
  cp "$SITE" "${SITE}.bak.$(date +%Y%m%d%H%M%S)"
  sed -i \
    -e "s|ssl_certificate     /etc/ssl/sllm/fullchain.pem;|ssl_certificate     ${LIVE}/fullchain.pem;|" \
    -e "s|ssl_certificate_key /etc/ssl/sllm/privkey.pem;|ssl_certificate_key ${LIVE}/privkey.pem;|" \
    "$SITE"
  log "nginx 인증서 경로를 Let's Encrypt 로 교체"
else
  log "이미 Let's Encrypt 경로를 쓰고 있습니다"
fi

# HSTS 는 정식 인증서가 붙은 뒤에만 켭니다 — 자체서명 상태에서 켜면
# 브라우저가 도메인을 HTTPS 로 고정해 버려 되돌리기 어렵습니다.
if ! grep -q "Strict-Transport-Security" "$SITE"; then
  sed -i "s|    include /etc/nginx/snippets/sllm-app.conf;|    add_header Strict-Transport-Security \"max-age=31536000\" always;\n\n    include /etc/nginx/snippets/sllm-app.conf;|" "$SITE"
  log "HSTS 활성화 (max-age=1년)"
fi

nginx -t
systemctl reload nginx
log "nginx 재적용 완료"

# ── 5. 자동 갱신 확인 ──
systemctl is-enabled certbot.timer >/dev/null 2>&1 \
  && log "자동 갱신: certbot.timer 활성" \
  || warn "certbot.timer 가 꺼져 있습니다: sudo systemctl enable --now certbot.timer"

echo
log "완료 — https://${DOMAIN}/ 확인"
curl -sS -o /dev/null -w "  HTTPS 응답: %{http_code}\n" "https://${DOMAIN}/" || true
