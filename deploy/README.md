# 서버 배포 가이드 — 211.119.38.216

> **이 서버에는 LLMWiki 도 함께 올라가 있다.** GPU·Ollama·nginx 를 공유하므로
> 서버를 처음 세우거나 통째로 옮길 때는 [`SERVER-INSTALL.md`](SERVER-INSTALL.md)
> (통합 설치 가이드)를 먼저 본다. 이 문서는 RAG-AI_Gov 하나만 다룬다.

올인원 구성(Qdrant + Ollama + FastAPI + Nginx)을 단일 리눅스 서버에 설치합니다.

**접속 주소: http://211.119.38.216/**
**도메인: `rag.ets0404.com` — nginx 바인딩 완료, DNS A 레코드 등록 대기 중 (아래 참고)**

```
브라우저 ──▶ Nginx :80 / :443 ──┬──▶ /      정적 프론트엔드 (dist/)
                                └──▶ /api/  FastAPI :8000 (127.0.0.1 바인딩)
                                              ├──▶ Qdrant  :6333  (Docker, 로컬 전용)
                                              └──▶ Ollama  :11434 (임베딩 bge-m3 + LLM)
```

Qdrant·Ollama·FastAPI는 모두 `127.0.0.1`에만 바인딩되어 외부에 직접 노출되지 않습니다.

## ⚠ 443/tcp 가 상위 네트워크에서 차단되어 있습니다

서버 안에서는 HTTPS가 정상 동작하지만(`curl -sk https://127.0.0.1/` → 200), 외부에서는
443 연결이 타임아웃됩니다. 서버 측 방화벽 문제가 아닙니다 — `ufw`는 inactive이고 `iptables INPUT`도
비어 있으며 nginx는 `0.0.0.0:443`을 리슨 중입니다. 즉 **사내망/ISP 등 서버 바깥에서 막고 있습니다.**

그래서 현재 nginx는 80·443 양쪽에 같은 앱을 서빙합니다. **접속은 `http://211.119.38.216/` 로 하세요.**

- **로그인 토큰이 평문으로 오갑니다.** 임시 상태로만 쓰세요.
- 443이 열리면 [`nginx-rag-ai-gov.conf`](nginx-rag-ai-gov.conf)의 `### HTTPS 전용 전환 ###`
  주석대로 80을 리다이렉트로 되돌리고 `sudo systemctl reload nginx` 하세요.

## 도메인 — rag.ets0404.com

nginx는 `server_name rag.ets0404.com` + `default_server` 로 설정되어 있어, 도메인·IP 어느 쪽으로
들어와도 앱이 응답합니다. Host 헤더를 위조해 검증한 결과 서버 측은 이미 준비 완료입니다:

```bash
curl -H "Host: rag.ets0404.com" http://211.119.38.216/api/health   # → 200
```

**남은 작업은 DNS 한 줄뿐입니다.** `rag.ets0404.com` 은 현재 권한 네임서버에서 NXDOMAIN 입니다.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `rag` | `211.119.38.216` | 300 |

`ets0404.com` 의 네임서버는 `cns1~4.hostcocoa.com` 이므로 **호스트코코아 DNS 관리 페이지**에서
위 A 레코드를 추가하세요. 루트 도메인(`ets0404.com`)은 AWS CloudFront(`3.171.185.x`)를 가리키고
있으니 **건드리지 말고 `rag` 서브도메인만** 추가하면 됩니다.

전파 확인:

```bash
dig +short @cns1.hostcocoa.com rag.ets0404.com A    # 권한 NS 즉시 반영
dig +short rag.ets0404.com A                        # 캐시 전파 (TTL 만큼 소요)
curl -s http://rag.ets0404.com/api/health
```

### 도메인 연결 후 — Let's Encrypt 인증서

80/tcp 는 외부에 열려 있으므로 DNS만 붙으면 HTTP-01 검증이 통과합니다.
(443이 아직 막혀 있어 인증서를 발급해도 외부에서 HTTPS 접속은 안 되지만, 미리 받아둘 수는 있습니다.)

```bash
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html -d rag.ets0404.com
# 발급 후 nginx-rag-ai-gov.conf 의 ssl_certificate 두 줄을 letsencrypt 경로로 교체
sudo nginx -t && sudo systemctl reload nginx
```

### nginx 설정 구조

80·443 서버 블록이 동일한 앱 설정을 공유하도록 공통부를 snippet으로 분리했습니다.

| 파일 | 서버 배치 위치 |
|---|---|
| [`nginx-rag-ai-gov.conf`](nginx-rag-ai-gov.conf) | `/etc/nginx/sites-available/rag-ai-gov.conf` |
| [`snippets/rag-ai-gov-app.conf`](snippets/rag-ai-gov-app.conf) | `/etc/nginx/snippets/` |
| [`snippets/rag-ai-gov-security-headers.conf`](snippets/rag-ai-gov-security-headers.conf) | `/etc/nginx/snippets/` |

`add_header`는 하위 블록에서 재정의되면 상속분이 통째로 사라지므로, 보안 헤더는 별도 snippet으로
빼서 `add_header`를 쓰는 location마다 함께 include합니다.

---

## 1. 로컬에서 프론트엔드 빌드

서버에 Node를 설치하지 않기 위해 빌드는 로컬에서 수행하고 결과물(`dist/`)만 전송합니다.

```bash
cd /Users/donghokim/Documents/Webpage/ETS/RAG-AI_Gov
npm install
VITE_API_BASE_URL=/api npm run build     # → dist/ 생성
```

> `VITE_API_BASE_URL=/api`는 필수입니다. 생략하면 프론트가 API 주소를 런타임에 추측합니다.

## 2. 서버로 전송

```bash
# 접속 정보에 맞게 PORT/USER/HOST 수정
rsync -avz --delete \
  --exclude node_modules --exclude .git --exclude .venv --exclude '*.db' \
  -e "ssh -p 22" \
  ./ USER@211.119.38.216:~/rag-ai-gov/
```

## 3. 설치 실행

```bash
ssh USER@211.119.38.216
cd ~/rag-ai-gov
sudo bash deploy/install.sh
```

스크립트가 수행하는 작업:

| 단계 | 내용 |
|---|---|
| 1 | 배포판 감지(apt/dnf/yum) 후 python3·nginx·git 설치 |
| 2 | Docker 설치 및 기동 |
| 3 | Qdrant 컨테이너 생성 (`127.0.0.1:6333`, 볼륨 `/var/lib/qdrant`) |
| 4 | Ollama 설치 + `bge-m3`(임베딩) · LLM 모델 pull |
| 5 | 서비스 계정 `ragai` 생성, `/opt/rag-ai-gov` 로 소스 동기화 |
| 6 | Python 가상환경 + `requirements.txt` 설치 |
| 7 | `.env` 자동 생성 (`SECRET_KEY`는 `openssl rand`로 무작위 생성) |
| 8 | `rag-api.service` 등록 및 기동 |
| 9 | `dist/` → `/var/www/rag-ai-gov` 배치 |
| 10 | Nginx 설정 + 방화벽 80/tcp 개방 |
| 11 | 헬스체크 출력 |

멱등 스크립트라 재실행해도 안전하며, 기존 `.env`는 덮어쓰지 않습니다.

---

## 4. LLM 모델 선택 — 대상 서버: NVIDIA A30 (24GB)

기본값은 **`qwen3:30b-a3b-instruct-2507`** 입니다.

선택 근거:

- **MoE 구조** — 총 30B 중 질의당 활성 파라미터가 3B뿐이라, 동급 dense 모델보다 토큰 생성이 크게 빠릅니다. CrewAI는 질의 1건당 LLM을 여러 번 호출(`rag_crew` 2회+, `research_crew` 3회+)하므로 이 차이가 응답시간에 그대로 곱해집니다.
- **A30 24GB에 적합** — Q4_K_M 기준 약 18~19GB로 VRAM에 올라갑니다.
- **`-instruct-` (비-thinking) 변형** — 아래 8절 '알려진 특이사항' 참고. thinking 모델은 추론 과정이 답변 본문에 그대로 섞여 나옵니다.

| 상황 | 권장 모델 | VRAM(Q4) |
|---|---|---|
| **A30 24GB (기본)** | `qwen3:30b-a3b-instruct-2507` | ~18.6GB |
| VRAM이 빠듯할 때 | `qwen3:14b` | ~9GB |
| GPU 없음 / 최소 구성 | `qwen3:8b` | ~5GB |
| GPU 80GB+ | `qwen3:32b` 또는 `qwen2.5:72b` | ~20 / ~43GB |

변경 방법:

```bash
sudo LLM_MODEL=qwen3:14b bash deploy/install.sh
# 또는 설치 후: /opt/rag-ai-gov/Rag-extended/.env 의 LLM_MODEL 수정 → sudo systemctl restart rag-api
```

> 태그가 없다고 나오면 `ollama pull` 오류 메시지에서 사용 가능한 변형을 확인하세요. 모델 라인업은 갱신이 잦습니다.

### A30 24GB VRAM 배분 주의

LLM(~18.6GB)과 임베딩 `bge-m3`(~1.2GB)가 **같은 GPU에 동시 상주**하며, 여기에 KV 캐시가 더해집니다. 기본 설정으로 컨텍스트를 크게 잡으면 24GB를 넘겨 CPU 오프로딩이 발생하고 속도가 급락합니다. 아래 설정을 권장합니다.

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
EOF
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

- `OLLAMA_FLASH_ATTENTION=1` — A30은 Ampere라 지원됩니다
- `OLLAMA_KV_CACHE_TYPE=q8_0` — KV 캐시를 8bit로 눌러 VRAM 절약
- `OLLAMA_MAX_LOADED_MODELS=2` — LLM + 임베딩 동시 상주 보장 (언로드/리로드 반복 방지)
- `OLLAMA_KEEP_ALIVE=-1` — **필수.** 기본값은 5분 유휴 후 언로드라, 이게 없으면 5분 넘게 요청이 없을 때마다 재로딩에 60~90초를 다시 씁니다. `ollama ps`의 `UNTIL`이 `Forever`인지 확인하세요

배분 확인:

```bash
nvidia-smi                    # VRAM 사용량
ollama ps                     # 100% GPU 인지 확인 — CPU 비율이 보이면 오프로딩 중
```

임베딩 모델 `bge-m3`(1024-dim)는 **변경하지 마세요.** Qdrant 컬렉션이 `EMBED_DIM=1024`로 생성되므로, 차원이 다른 모델로 바꾸면 기존 컬렉션을 모두 재생성해야 합니다.

---

## 5. 설치 후 확인

```bash
sudo systemctl status rag-api
curl -s http://127.0.0.1:8000/health | python3 -m json.tool
curl -s http://211.119.38.216/api/health

# 로그인 테스트
curl -s -X POST http://211.119.38.216/api/token \
  -d "username=info@gngmeta.com&password=admin1234"
```

브라우저: `http://211.119.38.216/`

---

## 6. 설치 직후 필수 조치

1. **기본 계정 비밀번호 변경** — `info@gngmeta.com / admin1234`가 코드에 하드코딩되어 최초 기동 시 자동 생성됩니다. 외부 노출 서버라면 즉시 변경하세요.
2. **443/tcp 개방 요청** — 위 경고 참고. 서버 바깥에서 막혀 있어 현재 HTTP로만 접속됩니다. 네트워크 담당자에게 443 인바운드 허용을 요청하세요.
3. **HTTPS 전환** — 443이 열린 뒤, 도메인이 있다면 자체 서명 인증서를 신뢰 인증서로 바꾸세요:
   ```bash
   sudo certbot --nginx -d your-domain.com
   ```
   그다음 [`nginx-rag-ai-gov.conf`](nginx-rag-ai-gov.conf)에서 80을 HTTPS 리다이렉트로 되돌립니다.

---

## 7. 운영 명령

```bash
sudo systemctl restart rag-api          # 백엔드 재시작
sudo journalctl -u rag-api -f           # 실시간 로그
docker restart qdrant                   # 벡터 DB 재시작
sudo systemctl restart ollama           # 추론 엔진 재시작

# 프론트엔드만 재배포 (로컬 빌드 후)
rsync -avz --delete dist/ USER@211.119.38.216:/tmp/dist/ && \
  ssh USER@211.119.38.216 "sudo rsync -a --delete /tmp/dist/ /var/www/rag-ai-gov/"
```

### 문서 인제스트 (CLI)

```bash
cd /opt/rag-ai-gov/Rag-extended
sudo -u ragai ../.venv/bin/python ingest.py folder \
  --collection 내문서 --folder ./docs --category 정책
```

---

## 8. 배포 중 수정한 코드 (2026-08-07)

최신 라이브러리 버전과 맞지 않아 런타임에 실패한 부분을 고쳤습니다. `requirements.txt`가 버전을 고정하지 않아 설치 시점의 최신 버전이 잡힌 결과입니다.

| 파일 | 증상 | 수정 |
|---|---|---|
| [`rag.py:76`](../Rag-extended/rag.py#L76) | `/chat` 500 — `AsyncQdrantClient has no attribute 'search'` | qdrant-client 1.12에서 제거된 `.search()` → `query_points()` + `.points` |
| [`requirements.txt`](../Rag-extended/requirements.txt) | 위 원인 | `qdrant-client>=1.9.0` → `>=1.12` |
| [`app.py:946`](../Rag-extended/app.py#L946) | `/agent` 500 — 이벤트 루프 내 동기 `kickoff()` 거부 | `asyncio.to_thread()`로 워커 스레드 실행 (이벤트 루프 블로킹도 함께 해소) |
| [`rag-api.service`](rag-api.service) | `/agent` 500 — `Permission denied: /home/ragai/.local/share` | CrewAI 저장 경로를 `HOME`/`XDG_*`/`CREWAI_STORAGE_DIR`로 `APP_DIR` 아래로 이동 (`ProtectHome=true` 유지) |

검증 시점 버전: qdrant-client 1.19.0 · crewai 1.15.12 · 드라이버 580.173.02 (CUDA 13.0)

---

## 9. 알려진 특이사항

- **`/health`의 `exo` 항목이 항상 `unknown`** — 이 필드는 Exo 클러스터의 `/health` 엔드포인트를 찔러보는데, 그 자리에 Ollama를 쓰므로 404가 납니다. 실제 LLM 상태는 같은 응답의 `llm.providers[].state`(Circuit Breaker)로 확인하세요. 동작에는 영향이 없습니다.

- **thinking 모델 금지** — [`rag.py:164`](../Rag-extended/rag.py#L164)가 LLM 응답을 `result["content"].strip()`으로 가공 없이 답변에 넣습니다. Qwen3의 thinking 변형처럼 추론 과정을 본문에 출력하는 모델을 쓰면 그 내용이 사용자 화면에 그대로 노출됩니다. 반드시 `-instruct-`(비-thinking) 변형을 쓰거나, 굳이 thinking 모델을 쓰려면 프롬프트에 `/no_think`를 넣거나 `rag.py`에서 `<think>` 블록을 제거하는 후처리를 추가해야 합니다.

- **Circuit Breaker와 폴백** — 로컬 추론이 `CB_TIMEOUT_SEC`(기본 120초)를 3회 연속 초과하면 회로가 OPEN 되어 Grok → Claude 순으로 폴백을 시도합니다. `.env`에 API 키가 없으면 폴백이 모두 스킵되어 요청이 실패합니다. CPU 추론처럼 느린 환경이라면 `CB_TIMEOUT_SEC`를 올리거나, 폴백 키를 넣어 두세요.
  ```bash
  # 회로 수동 초기화 (로그인 토큰 필요)
  curl -X POST http://211.119.38.216/api/admin/circuit-reset \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
  ```

- **워커 1개 고정** — 백엔드가 SQLite(`rag.db`) 단일 파일과 프로세스 내 메모리 캐시를 쓰기 때문입니다. 처리량 증설이 필요하면 PostgreSQL 전환이 선행되어야 합니다.

- **저장소 보완분** — GitHub `brikoai` 저장소에는 `app.py`가 import하는 `models.py`·`database.py`·`cache.py`·`auth_utils.py`와 프론트엔드 소스가 누락되어 있어, 로컬 기존 프로젝트에서 보완했습니다. 이 상태를 원격에 반영하려면 별도로 커밋·푸시가 필요합니다.
