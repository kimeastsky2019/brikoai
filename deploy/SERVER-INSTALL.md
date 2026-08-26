# 서버 통합 설치 가이드

한 대의 서버에 **RAG-AI_Gov** 와 **LLMWiki** 두 서비스를 함께 올린다.
두 서비스는 저장소가 다르지만 GPU·벡터DB·nginx 를 공유하므로, 설치 순서와
자원 배분을 따로 정하면 반드시 충돌한다. 이 문서가 그 순서다.

각 저장소의 `deploy/README.md` 는 서비스 하나만 다룬다. 서버를 처음 세우거나
통째로 옮길 때는 **이 문서를 먼저** 읽는다.

- RAG-AI_Gov 단독 상세: [`deploy/README.md`](README.md)
- LLMWiki 단독 상세: LLMWiki 저장소의 `deploy/README.md`

---

## 1. 무엇이 올라가는가

```
                    ┌─ rag.ets0404.com      (80 default_server, 443 TLS)
브라우저 ──▶ nginx ─┤     ├ /            정적 프론트  /var/www/rag-ai-gov
                    │     └ /api/        →  127.0.0.1:8000   rag-api
                    │
                    └─ llmwiki.brikoai.com (80, basic auth)
                          └ /            →  127.0.0.1:8722   llmwiki
                                              (앱이 SPA 를 직접 서빙)

공용 기반
  Qdrant   Docker      127.0.0.1:6333   벡터 DB          ← rag-api 전용
  Ollama   네이티브     127.0.0.1:11434  bge-m3 임베딩 + sLM 추론 ← 양쪽 공용
  A30 24GB GPU                          Ollama 가 점유    ← 양쪽 공용
```

| | RAG-AI_Gov | LLMWiki |
|---|---|---|
| 코드 | `/opt/rag-ai-gov` | `/opt/llmwiki` |
| 서비스 계정 | `ragai` | `llmwiki` |
| systemd | `rag-api.service` | `llmwiki.service` |
| 포트 | 8000 | 8722 |
| 프론트 | `/var/www/rag-ai-gov` (nginx 서빙) | `/opt/llmwiki/web/dist` (앱이 서빙) |
| 설정 | `Rag-extended/.env` | `/opt/llmwiki/config.yaml` |
| 키 | `Rag-extended/.env` | `/etc/llmwiki/llmwiki.env` |
| 데이터 | Qdrant 컬렉션 | `/opt/llmwiki/compliance` (감사추적) |
| 인증 | 앱 로그인 (JWT) | nginx basic auth |

**두 서비스는 서로를 호출하지 않는다.** 공유하는 것은 GPU·Ollama·nginx 뿐이다.
한쪽을 내려도 다른 쪽은 계속 돈다.

---

## 2. 사전 요구사항

검증된 구성 (2026-08 기준 운영 서버):

| 항목 | 값 | 비고 |
|---|---|---|
| OS | Ubuntu 24.04 LTS | |
| GPU | NVIDIA A30 24GB | Ollama 가 ~19GB 사용 |
| RAM | 47GB | 최소 32GB |
| CPU | 6코어 | |
| 디스크 | 242GB (28GB 사용) | 모델 파일이 ~20GB |
| Python | 3.12 | 양쪽 동일 |
| Node | **20 또는 22** | 프론트 빌드용 (로컬 PC). §9 함정 2 참고 |

네트워크

- **80/tcp** 는 열려 있어야 한다.
- **443/tcp 가 상위망에서 막혀 있으면** HTTPS 를 쓸 수 없다. 이 경우 basic auth
  자격증명이 평문으로 오간다는 것을 알고 써야 한다 (§9 함정 5).
- 도메인 두 개를 서버 IP 로 A 레코드 연결한다. 도메인 없이 IP 로도 되지만,
  그러면 `default_server` 인 rag 쪽만 보인다.

---

## 3. 0단계 — 공용 기반

**순서가 중요하다.** Ollama 가 GPU 를 잡은 뒤에 앱을 올려야 VRAM 배분이 예측 가능하다.

```bash
sudo apt update && sudo apt install -y nginx docker.io python3.12-venv rsync

# Qdrant (rag-ai-gov 전용, 그러나 기반이므로 먼저)
sudo docker run -d --name qdrant --restart unless-stopped \
  -p 127.0.0.1:6333:6333 -p 127.0.0.1:6334:6334 \
  -v /var/lib/qdrant:/qdrant/storage qdrant/qdrant

# Ollama (양쪽 공용) — 외부에 열지 않는다. 127.0.0.1 만 듣는다
curl -fsSL https://ollama.com/install.sh | sh
ollama pull bge-m3
ollama pull hf.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M
```

모델 선택 근거와 A30 VRAM 배분은 [`deploy/README.md`](README.md) 의 '4. LLM 모델 선택' 참고.
요약하면 MoE 라 활성 파라미터가 3B 뿐이라 빠르고, thinking 변형은 추론 과정이
답변에 섞여 나오므로 **Instruct** 변형을 쓴다.

```bash
# 확인 — 둘 다 127.0.0.1 에만 떠야 한다
ss -tlnp | grep -E '6333|11434'
nvidia-smi --query-gpu=memory.used,memory.total --format=csv
```

---

## 4. 1단계 — RAG-AI_Gov

### 4.1 프론트엔드 빌드 (로컬 PC)

서버에 node 가 없다. 로컬에서 빌드해 결과물만 올린다.

```bash
cd RAG-AI_Gov
node -v                      # 20 또는 22 여야 한다 (§9 함정 2)
npm ci
npm run build                # → dist/
```

### 4.2 전송과 설치

```bash
rsync -a --exclude node_modules --exclude .git ./ <서버>:/tmp/rag-up/
ssh <서버> 'sudo bash /tmp/rag-up/deploy/install.sh'
```

`install.sh` 는 멱등이다. 여러 번 돌려도 안전하다. 하는 일:
서비스 계정 `ragai` 생성 → `/opt/rag-ai-gov` 배치 → venv + 의존성 →
`.env` 생성 → systemd 등록 → nginx 설정.

### 4.3 지식 데이터베이스(kb) 모듈

kb 는 PDF 를 4채널로 분해하므로 의존성이 둘 더 필요하다. 없으면 kb 라우터만
조용히 빠지고 본체는 계속 돈다 (`app.py` 의 try/except).

```bash
sudo -u ragai /opt/rag-ai-gov/.venv/bin/pip install pdfplumber openpyxl
sudo systemctl restart rag-api
curl -s localhost:8000/kb/health      # {"status":"ok", "sectors":12, ...}
```

### 4.4 키

`/opt/rag-ai-gov/Rag-extended/.env` 에만 둔다. 유닛 파일은 world-readable 이다.

```ini
EXO_BASE_URL=http://127.0.0.1:11434    # 사내 Ollama
LLM_MODEL=hf.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M
XAI_API_KEY=xai-...                    # Grok — 폴백 2순위
XAI_MODEL=grok-4...
QDRANT_HOST=127.0.0.1
QDRANT_PORT=6333
```

LLM 은 **Exo(사내 Ollama) → Grok → Claude** 순으로 폴백한다. Circuit Breaker 가
붙어 있어 한 공급자가 죽어도 다음으로 넘어간다.

---

## 5. 2단계 — LLMWiki

### 5.1 프론트엔드 빌드 (로컬 PC)

**경로 접두어에 묶여 빌드된다.** 전용 도메인 루트에서 서빙하므로 기본값(`/`)이다.
하위 경로(`/wiki/`)로 붙일 때만 `VITE_BASE` 를 준다. 이 값이 nginx 와 어긋나면
자산을 404 로 받아 **화면이 하얗게 뜬다** (§9 함정 1).

```bash
cd LLMWiki/web && npm ci && npm run build
```

### 5.2 설치

```bash
sudo useradd --system --home-dir /opt/llmwiki --shell /usr/sbin/nologin llmwiki
sudo mkdir -p /opt/llmwiki/{docs,projects,uploads,sources,compliance} /etc/llmwiki
sudo chown -R llmwiki:llmwiki /opt/llmwiki

rsync -a --exclude __pycache__ --exclude '* 2.*' llmwiki pyproject.toml <서버>:/tmp/lw/
rsync -a --delete web/dist/ <서버>:/tmp/lw/dist/
# 서버에서
sudo rsync -a --delete /tmp/lw/llmwiki/ /opt/llmwiki/llmwiki/
sudo rsync -a --delete /tmp/lw/dist/    /opt/llmwiki/web/dist/
sudo -u llmwiki python3 -m venv /opt/llmwiki/.venv
cd /opt/llmwiki && sudo -u llmwiki .venv/bin/pip install -e .
sudo cp deploy/config.server.yaml /opt/llmwiki/config.yaml
sudo install -o root -g llmwiki -m 640 llmwiki.env /etc/llmwiki/llmwiki.env
sudo cp deploy/systemd/llmwiki.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now llmwiki
```

### 5.3 규제 지식그래프 초기 적재

```bash
L="sudo -u llmwiki HOME=/opt/llmwiki /opt/llmwiki/.venv/bin/llmwiki reg"
$L seed -c /opt/llmwiki/config.yaml       # 데모 데이터 — 한 번만 (§9 함정 4)
$L validate -c /opt/llmwiki/config.yaml
$L goldset  -c /opt/llmwiki/config.yaml
```

### 5.4 접근 제어

뷰어에는 로그인이 없다. nginx basic auth 로 막는다.

```bash
sudo openssl passwd -apr1                       # 해시 출력
echo '사용자명:<해시>' | sudo tee -a /etc/nginx/.llmwiki-htpasswd
sudo chown root:www-data /etc/nginx/.llmwiki-htpasswd && sudo chmod 640 $_
sudo systemctl reload nginx
```

`auth_basic` 은 location 사이에 **상속되지 않는다.** 프록시 location 마다 적어야 하고,
하나라도 빠지면 그 경로만 무인증으로 열린다 (§9 함정 6).

---

## 6. 3단계 — nginx

서버 블록 두 개를 각각 둔다. rag 쪽이 `default_server` 라 도메인 없이 IP 로
들어오면 rag 가 응답한다.

```bash
sudo cp deploy/nginx-rag-ai-gov.conf /etc/nginx/sites-available/rag-ai-gov.conf
sudo cp deploy/snippets/*.conf       /etc/nginx/snippets/
sudo cp <LLMWiki>/deploy/nginx/llmwiki-site.conf \
        /etc/nginx/sites-available/llmwiki.conf
sudo ln -sf /etc/nginx/sites-available/rag-ai-gov.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/llmwiki.conf    /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

443 을 쓸 수 있으면 `deploy/setup-https.sh` 로 인증서를 발급한다.

---

## 7. 검증 체크리스트

설치 직후 이 순서로 확인한다. 위에서 실패하면 아래는 볼 필요가 없다.

```bash
# 기반
systemctl is-active nginx ollama rag-api llmwiki      # 전부 active
sudo docker ps --filter name=qdrant                   # Up
nvidia-smi --query-gpu=memory.used --format=csv       # 유휴 시 ~1GB,
                                                      # 모델 적재 후 ~19GB

# rag-ai-gov
curl -s localhost:8000/health
curl -s localhost:8000/kb/health                      # sectors:12
curl -s localhost:8000/kb/sectors | head -c 120

# llmwiki
curl -s -o /dev/null -w '%{http_code}\n' localhost:8722/api/meta        # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:8722/api/reg/graph   # 200
sudo -u llmwiki HOME=/opt/llmwiki /opt/llmwiki/.venv/bin/llmwiki reg \
     validate -c /opt/llmwiki/config.yaml                               # 적합

# 외부 경유 — 인증이 실제로 걸려 있는지
curl -s -o /dev/null -w 'rag  %{http_code}\n'     http://<서버>/api/kb/health   # 200
curl -s -o /dev/null -w 'wiki %{http_code}\n' -H 'Host: llmwiki.brikoai.com' \
     http://<서버>/                                                     # 401
```

마지막 줄이 **401 이어야 한다.** 200 이면 basic auth 가 빠진 것이다.

---

## 8. 운영

```bash
# 상태·로그
systemctl status rag-api llmwiki
journalctl -u rag-api -f
journalctl -u llmwiki -f
tail -f /var/log/nginx/{rag-ai-gov,llmwiki}.error.log

# 코드만 다시 올리기 (백엔드)
rsync -a --exclude __pycache__ Rag-extended/kb/ <서버>:/tmp/up/ && \
  ssh <서버> 'sudo rsync -a --delete /tmp/up/ /opt/rag-ai-gov/Rag-extended/kb/ &&
              sudo chown -R ragai:ragai /opt/rag-ai-gov/Rag-extended/kb &&
              sudo systemctl restart rag-api'

# 프론트만 다시 올리기
npm run build && rsync -a --delete dist/ <서버>:/tmp/dist/ && \
  ssh <서버> 'sudo rsync -a --delete /tmp/dist/ /var/www/rag-ai-gov/ &&
              sudo chown -R www-data:www-data /var/www/rag-ai-gov'
```

### 백업 대상

| 경로 | 성격 | 재생성 |
|---|---|---|
| `/opt/llmwiki/compliance/` | **감사 추적** (append-only 저널) | ✕ 불가 |
| `/var/lib/qdrant/` | 벡터 인덱스 | △ 원문 재적재 필요 |
| `/opt/rag-ai-gov/Rag-extended/rag.db` | 사용자·컬렉션 메타 | ✕ 불가 |
| `/etc/llmwiki/llmwiki.env`, `.env` | 키 | ✕ 불가 |
| `/opt/llmwiki/docs/`, `projects/` | 생성 산출물 | ○ 재생성 |

`compliance/` 는 지우면 **과거 판정의 근거가 사라진다.** `docs/` 와 성격이 완전히 다르다.

---

## 9. 함정 — 실제로 겪은 것들

### 1. 프론트 경로 접두어 불일치 → 화면이 하얗게

`VITE_BASE` 가 nginx 의 경로와 다르면 자산을 404 로 받아 빈 화면이 뜬다.
콘솔에 `Failed to load module script ... MIME type of "text/html"` 이 찍힌다.
전용 도메인 루트면 기본값, 하위 경로면 `VITE_BASE=/wiki/`. 로컬 확인용과
서버 배포용 빌드가 다르므로 **섞이지 않게 한다.**

### 2. Node 24 에서 vite 5.4 빌드가 멈춘다

`transforming...` 에서 **CPU 0% 로 정지**한다. 파일 변환을 시작하기도 전이다.
vite 5.4 가 공식 지원하는 것은 Node 18/20/22 다. Node 20 또는 22 로 빌드한다.

부수적으로 npm 의 optional dependency 버그(`Cannot find module
@rollup/rollup-darwin-arm64`)도 만날 수 있다. `npm i @rollup/rollup-<플랫폼>`
으로 개별 설치하거나 `node_modules` 와 lock 파일을 지우고 다시 설치한다.

### 3. Ollama 는 외부에 열려 있지 않다 (그게 맞다)

`127.0.0.1:11434` 만 듣는다. 로컬 PC 에서 `base_url` 을 서버 IP 로 잡으면
연결 타임아웃이 난다. sLM 을 쓰는 명령은 **서버에서** 실행한다.
망분리 관점에서 이 구성이 옳으므로 열지 않는다.

### 4. `reg seed` 를 두 번 넣지 않는다

저널이 append-only 라 두 번 실행하면 이력이 겹친다. 이미 저널이 있으면
명령이 막고 `--force` 를 요구한다. 처음부터 다시 하려면 디렉터리를 **옮긴다**
(지우지 말 것 — 감사 추적이다).

### 5. 443 이 막힌 환경이면 basic auth 가 평문이다

상위망이 443 을 막고 있으면 HTTPS 를 쓸 수 없고, 자격증명이 그대로 오간다.
그 사실을 아는 사람에게만 계정을 주고, 다른 곳에서 쓰는 비밀번호를 재사용하지 않는다.

### 6. `auth_basic` 은 location 사이에 상속되지 않는다

프록시 location 이 여러 개면 **전부** 적어야 한다. 업로드 전용 location 을
따로 둔 구성에서 특히 빠뜨리기 쉽다. 확인은 §7 의 마지막 줄로 한다.

### 7. GPU 를 두 서비스가 나눠 쓴다

A30 24GB 중 ~19GB 를 Ollama 의 sLM 이 점유한다. `llm.ollama.concurrency` 는
1 로 둔다. 대량 생성 작업은 Grok 쪽이 빠르다.

### 8. `.env` 는 서비스 계정만 읽는다

`ubuntu` 로 `python -c "import app"` 하면 `PermissionError: .env` 가 난다.
코드 문제가 아니다. `sudo -u ragai` 로 실행한다.

### 9. 워커는 1개 고정

두 앱 모두 작업 상태(jobs)·업로드 세션이 프로세스 메모리에 있다. 워커를 늘리면
진행률 폴링이 엉뚱한 워커로 가 작업을 잃는다.

### 10. kb 의존성이 없으면 kb 만 조용히 빠진다

`pdfplumber`/`openpyxl` 이 없으면 `app.py` 가 경고만 찍고 kb 라우터를 건너뛴다.
본체는 정상 동작하므로 **알아채기 어렵다.** `/kb/health` 로 확인한다.

---

## 10. 되돌리기

배포 스크립트는 덮어쓰기 전에 백업을 남긴다.

```bash
ls /opt/rag-ai-gov/Rag-extended/*.bak-*      # app.py.bak-<타임스탬프>
ls /opt/llmwiki/*.bak-*                      # config.yaml.bak-, llmwiki-pkg.bak-*.tgz
ls /etc/nginx/snippets/*.bak*

# 예: llmwiki 패키지 되돌리기
sudo tar xzf /opt/llmwiki/llmwiki-pkg.bak-<STAMP>.tgz -C /opt/llmwiki
sudo systemctl restart llmwiki
```

서비스 하나만 내리려면 그것만 멈춘다. 두 서비스는 독립이다.

```bash
sudo systemctl stop llmwiki      # rag-ai-gov 는 계속 동작
```
