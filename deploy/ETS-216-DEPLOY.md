# ETS 3개 서비스 배포 — 211.119.38.216

2026-08-25 기준. 216 은 6 vCPU / 48GB RAM / 240GB / **NVIDIA A30 24GB**, Ubuntu 24.04.
(2026-08-24 에 재설치되어 이전 배포는 남아 있지 않았습니다.)

> **정정** — 8/24 최초 조사 때 `nvidia-smi` 가 실패해 "GPU 없음" 으로 판단하고 Grok API 전용으로
> 설계했으나, 이는 오판이었습니다. 카드는 처음부터 꽂혀 있었고 그 시점에 `/dev/nvidia*` 장치
> 노드가 아직 만들어지지 않았을 뿐입니다. 8/25 에 로컬 추론으로 전환했습니다.

## 구성

| 도메인 | 서비스 | systemd | 포트 | 정적 루트 | 앱 경로 |
|---|---|---|---|---|---|
| `ets0404.com` / `www` | Intro_web (Hono) | `ets-intro` | 9901 | `/var/www/ets0404` | `/opt/ets-intro` |
| `work.ets0404.com` | LLMWiki (FastAPI) | `llmwiki` | 8722 | `/var/www/llmwiki` | `/opt/llmwiki` |
| `rag.ets0404.com` | RAG-AI_Gov (FastAPI) | `rag-api` | 8010 | `/var/www/rag` | `/opt/rag` |

공용 인프라:

- `rag-qdrant` — Qdrant 1.19 네이티브 바이너리, `127.0.0.1:6333`, 스토리지 `/opt/rag/qdrant/storage`
- `ollama` — `127.0.0.1:11434`, **A30 GPU 추론**
  - `hf.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M` (18GB) — 생성
  - `bge-m3` (1024-dim, 664MB) — 임베딩
  - 둘 다 `100% GPU` 상주, VRAM 19.2GB / 24.5GB
- Python 3.12 — uv 로 `/opt/pythons` 에 설치. systemd `ProtectHome=true` 를 쓰므로
  인터프리터가 `/home` 밖에 있어야 합니다.
- 비밀값 — `/etc/ets-intro.env`, `/etc/llmwiki/llmwiki.env`, `/etc/rag-api.env` (전부 0600)

### LLM 선택 근거 — 로컬 추론

A30 24GB 에 `Qwen3-30B-A3B-Instruct-2507` Q4_K_M(18GB)을 올려 **생성·임베딩 모두 로컬**입니다.
Grok 은 폴백으로만 남겨 두었습니다(키 미설정이라 현재는 스킵).

- **MoE** — 총 30B 중 질의당 활성 파라미터가 3B 라 dense 30B 보다 훨씬 빠릅니다.
  CrewAI 는 질의 1건당 LLM 을 여러 번 부르므로 이 차이가 그대로 곱해집니다.
- **비-thinking(`-instruct-`) 변형 필수** — `rag.py` 가 응답을 가공 없이 답변에 넣기 때문에
  thinking 변형을 쓰면 추론 과정이 화면에 그대로 노출됩니다. Ollama 공식 라이브러리의
  `qwen3:30b-a3b` 는 hybrid thinking 이고 `qwen3:30b-a3b-instruct-2507` 태그는 **없어서**,
  HuggingFace 의 unsloth GGUF 를 직접 받습니다. (배포 시 `<think>` 미포함 확인)
- **VRAM 배분** — LLM 18GB + bge-m3 0.9GB. `OLLAMA_KV_CACHE_TYPE=q8_0`,
  `OLLAMA_CONTEXT_LENGTH=8192`, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_KEEP_ALIVE=-1`
  (`/etc/systemd/system/ollama.service.d/override.conf`) 로 두 모델을 함께 상주시킵니다.

**GPU 관련 주의** — ollama 와 `nvidia-persistenced` 는 `/dev/nvidia*` 노드가 만들어지기 전에
기동하면 각각 CPU 전용으로 떨어지거나 실패합니다. 부팅 후 `ollama ps` 의 PROCESSOR 가
`100% GPU` 인지, `systemctl list-units --failed` 가 비어 있는지 확인하세요.
어긋났으면 `sudo systemctl restart nvidia-persistenced ollama` 로 회복됩니다.

## 검증 결과 (서버 내부, `curl --resolve`)

```
ets0404.com   HTTPS 200, 83,140 bytes, <title>에너지의 내일을 설계합니다…</title>
              /api/health → {"ok":true,"data":{"service":"server","runtime":"hono"}}
rag.ets0404   HTTPS 200 / api/health → qdrant=up, exo=up, provider=exo, embed=ollama/1024dim
              로그인 → 컬렉션 → 업로드 → Qdrant points=1 dim=1024
              /chat 로컬 30B 생성 성공 (콜드 9.7초, 워밍 4.4~7.7초, 근거 인용 정상)
              컨텍스트 밖 질문 → "제공된 문서 근거로는 확인할 수 없습니다" (가드레일 동작)
work.ets0404  정적 200 / api → 502 (백엔드 미기동, 아래 참조)
```

## 남은 작업 3가지

### 1) 상위 방화벽 — 80/443 개방

두 서버 모두 인바운드 **80·443 이 막혀 있습니다** (216 은 22 만 열림).
서버 안에서는 전부 정상이지만 외부에서는 아무것도 보이지 않고,
Let's Encrypt HTTP-01 검증도 실패합니다. 이게 풀리기 전에는 자체서명 인증서
(`/etc/ssl/ets/*`)로만 뜹니다.

개방 후:
```bash
sudo certbot certonly --webroot -w /var/www/certbot -d rag.ets0404.com
# 발급되면 해당 sites-available 파일의 ssl_certificate 두 줄을
# /etc/letsencrypt/live/<도메인>/ 경로로 교체하고 nginx -t && systemctl reload nginx
```

### 2) DNS

| 도메인 | 현재 | 필요한 조치 |
|---|---|---|
| `rag.ets0404.com` | → 216 ✅ | 없음 |
| `work.ets0404.com` | 레코드 없음 | `A work.ets0404.com → 211.119.38.216` 추가 |
| `ets0404.com` / `www` | **아임웹(IMWEB)** 3.171.185.x | 216 으로 옮기려면 A 레코드 변경. **그 순간 아임웹 사이트가 내려갑니다** — 전환 시점을 정해야 합니다 |

### 3) Grok API 키 (선택 — 폴백용)

로컬 30B 로 전환했으므로 **키 없이도 동작합니다**. 키는 로컬 추론이 죽었을 때의
폴백으로만 쓰입니다. `/etc/rag-api.env` 와 `/etc/llmwiki/llmwiki.env` 의 `XAI_API_KEY`
가 비어 있으면 폴백이 스킵되고, 로컬까지 실패하면 `/chat` 이 503(원인 포함)을 냅니다.

```bash
sudo sed -i 's|^XAI_API_KEY=.*|XAI_API_KEY=xai-...|' /etc/rag-api.env
sudo sed -i 's|^XAI_API_KEY=.*|XAI_API_KEY=xai-...|' /etc/llmwiki/llmwiki.env
sudo systemctl restart rag-api llmwiki
```

## LLMWiki 기동 불가 — iCloud 축출

`llmwiki.service` 는 등록·enable 만 해 두고 시작하지 않았습니다.
`llmwiki/server/app.py:848` 이 `from .ediag import bind` 를 조건 없이 import 하는데
그 모듈 파일이 로컬에서 iCloud 스텁(`.ediag.py.icloud`)입니다.

복구가 필요한 파일 (**git 에도 없는 미추적 파일**이라 저장소에서 되살릴 수 없습니다):

```
llmwiki/server/ediag.py      ← 이게 없으면 서버가 아예 기동하지 않음
llmwiki/server/engines.py
llmwiki/kb/sources.py
llmwiki/ediag/cli.py
llmwiki/ediag/assist.py
llmwiki/ediag/route.py
```

Finder 에서 `Documents/Sloution/LLMWiki` 우클릭 → **"지금 다운로드"** 로 받은 뒤:

```bash
rsync -az --exclude '__pycache__' --exclude '.venv' --exclude '.git' \
  --exclude 'node_modules' --exclude 'web/dist' --exclude '.*.icloud' \
  -e "ssh -i dhkim-key.pem" \
  ~/Documents/Sloution/LLMWiki/ ubuntu@211.119.38.216:/opt/llmwiki/
ssh -i dhkim-key.pem ubuntu@211.119.38.216 'sudo systemctl start llmwiki && sleep 5 && systemctl is-active llmwiki'
```

프론트엔드는 이미 빌드해 올려 두었습니다(`/var/www/llmwiki`, mermaid 의 누락 의존성
`es-toolkit` 을 추가해 빌드했습니다).

## Intro_web 소스 상태

`apps/client/dist` 317개와 서버 `routes/`·`services/` 소스가 모두 iCloud 스텁입니다.
프론트는 `ETS/website-019ff25c-*.zip`(494 파일)의 `apps/client` 를 pnpm 으로 빌드해
복구했고, 결과 `index.html` 이 83,140 bytes 로 기존 서빙본과 일치합니다.
백엔드는 이미 빌드된 번들 `apps/server/dist/index.js`(1.6MB)를 그대로 올렸습니다.

⚠ zip 은 ETS 커스터마이징 **이전** 스냅샷이라 `wiki.route.ts`·`energy-calc.ts` 같은
최신 서버 기능의 **소스**가 없습니다. 번들에는 컴파일되어 들어 있으므로 API 는 동작하지만,
앞으로 이 기능들을 수정하려면 iCloud 에서 소스를 복구해야 합니다.

## 갱신 방법

```bash
# RAG 프론트
cd RAG-AI_Gov && VITE_API_BASE_URL=/api npm run build
rsync -az --delete -e "ssh -i dhkim-key.pem" dist/ ubuntu@211.119.38.216:/var/www/rag/

# RAG 백엔드
rsync -az --exclude '__pycache__' --exclude 'tests' --exclude '.env' \
  -e "ssh -i dhkim-key.pem" RAG-AI_Gov/Rag-extended/ ubuntu@211.119.38.216:/opt/rag/app/
ssh -i dhkim-key.pem ubuntu@211.119.38.216 'sudo systemctl restart rag-api'

# 상태
ssh -i dhkim-key.pem ubuntu@211.119.38.216 \
  'systemctl is-active nginx ets-intro rag-api rag-qdrant ollama llmwiki'
```

## LLMWiki 설정

`deploy/config.server.yaml` 을 `/opt/llmwiki/config.yaml` 로 배치했습니다
(그전에는 개발용 `provider: claude` 설정이 올라가 있었습니다). 변경점:

- `provider: ollama` — 로컬 A30 사용 (Grok 키 불필요)
- `base_url: http://127.0.0.1:11434` — ollama 는 루프백에만 바인딩돼 있어
  원래 값이던 공인 IP(`211.119.38.216:11434`)로는 붙지 않습니다
- `num_ctx: 8192` — ollama 서버가 `OLLAMA_CONTEXT_LENGTH=8192` 로 떠 있어 맞췄습니다

## 코드 변경 사항

[SLLM-DEPLOY.md](SLLM-DEPLOY.md) 5절과 동일하며, 추가로:

- **`app.py` `/health` 의 로컬 추론 점검** — 원래 `EXO_BASE_URL.rstrip('/v1') + '/health'`
  를 찔렀는데 두 군데가 틀렸습니다. ① `str.rstrip` 은 접미사가 아니라 문자 집합
  `{'/','v','1'}` 을 깎아 `http://host:1/v1` 이 `http://host:` 가 됩니다. ② 이 자리에
  Exo 대신 Ollama 가 오면 `/health` 가 없어 404 → 정상 동작 중에도 항상 down 으로
  보고됐습니다(README 9절에 "항상 unknown" 으로 기록돼 있던 그 건).
  OpenAI 호환 규격의 `/v1/models` 로 점검하도록 바꿔 둘 다 해결했습니다.
