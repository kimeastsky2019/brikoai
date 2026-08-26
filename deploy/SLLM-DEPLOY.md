# sLLM 서비스 배포 — sllm.ets0404.com (211.119.38.148)

기존 `deploy/install.sh` 는 4×Mac mini 클러스터(Exo + Qwen 72B + Ollama)를 전제로 합니다.
이 문서는 **2GB RAM / 1 vCPU 클라우드 서버**에 올린 경량 변형을 기록합니다.

## 1. 무엇이 어떻게 다른가

| 구성요소 | 원본 (211.119.38.216) | sLLM (211.119.38.148) | 이유 |
|---|---|---|---|
| LLM | Exo + Qwen3-30B (로컬) | **Grok / xAI API** | 로컬 30B 모델은 2GB RAM 에 올라가지 않음 |
| 임베딩 | Ollama + BGE-M3 (1024-dim, 1.2GB) | **fastembed ONNX, paraphrase-multilingual-MiniLM-L12-v2 (384-dim, 0.22GB)** | 동일 사유. 한↔영 교차언어 유사도 0.83 으로 한국어 검색 품질 확인 |
| 벡터 DB | Qdrant (Docker) | **Qdrant 네이티브 바이너리 + systemd** | Docker 데몬(≈80MB)을 아끼고 설치 표면을 줄임. RSS 38MB |
| Python | 배포판 기본 | **uv 로 받은 3.12** (`/opt/sllm/pythons`) | Ubuntu 26.04 는 3.14 만 제공 — 휠 미비. `ProtectHome=true` 와 공존하려고 `/home` 밖에 설치 |

## 2. 서비스 구성

```
인터넷 :443
   │
   ├─ nginx  sllm.ets0404.com
   │    ├─ /            → /var/www/sllm            (Vite SPA, HashRouter)
   │    └─ /api/        → 127.0.0.1:8010           (접두사 제거 후 프록시)
   │
   ├─ sllm-api.service     uvicorn app:app  :8010  (venv: /opt/sllm/.venv)
   └─ sllm-qdrant.service  qdrant           :6333  (스토리지: /opt/sllm/qdrant/storage)
                                │
                                └─ Grok API (api.x.ai) ← 유일한 추론 경로
```

경로 요약:

| 항목 | 위치 |
|---|---|
| 백엔드 소스 | `/opt/sllm/app` |
| 가상환경 | `/opt/sllm/.venv` |
| 환경설정(비밀값) | `/etc/sllm-api.env` (0600, root) |
| SQLite | `/opt/sllm/data/rag.db` |
| 임베딩 모델 캐시 | `/opt/sllm/fastembed_cache` |
| 벡터 스토리지 | `/opt/sllm/qdrant/storage` |
| 프론트엔드 | `/var/www/sllm` |
| nginx | `/etc/nginx/sites-available/sllm.ets0404.com` + `snippets/sllm-app.conf` |

## 3. 도메인

`ets0404.com` 과 `www.ets0404.com` 은 **아임웹(IMWEB) 호스팅**(3.171.185.x)입니다.
이 서버로 붙일 수 없으므로 서브도메인만 분리합니다 — 아임웹 사이트는 그대로 둡니다.

```
sllm.ets0404.com.  A  211.119.38.148     ← 추가해야 할 레코드
```

레코드 전파 후:

```bash
sudo bash /opt/sllm/enable-letsencrypt-sllm.sh
```

이 스크립트는 DNS 가 실제로 이 서버를 가리키는지 먼저 확인한 뒤(실패한 certbot 호출도
Let's Encrypt 요청 한도에 쌓이므로) 인증서를 발급하고, nginx 의 자체서명 경로를 교체하고,
HSTS 를 켭니다. 그 전까지는 자체서명 인증서라 브라우저 경고가 뜹니다.

## 4. 갱신 방법

프론트엔드:
```bash
cd RAG-AI_Gov && VITE_API_BASE_URL=/api npm run build
rsync -az --delete -e "ssh -i dhkim-key.pem" dist/ ubuntu@211.119.38.148:/var/www/sllm/
```

백엔드:
```bash
rsync -az --exclude '__pycache__' --exclude 'tests' --exclude '.env' \
  -e "ssh -i dhkim-key.pem" RAG-AI_Gov/Rag-extended/ ubuntu@211.119.38.148:/opt/sllm/app/
ssh -i dhkim-key.pem ubuntu@211.119.38.148 'sudo systemctl restart sllm-api'
```

상태 확인:
```bash
curl -sk https://sllm.ets0404.com/api/health | python3 -m json.tool
sudo journalctl -u sllm-api -n 100 --no-pager
sudo systemctl status sllm-api sllm-qdrant
```

## 5. 코드 변경 사항 (원본 대비)

저사양 서버 대응과 배포 중 드러난 결함 수정입니다. 모두 기존 고사양 배포와 호환됩니다.

- **`embeddings.py` (신규)** — 임베딩 provider 추상화. `EMBED_PROVIDER=fastembed|ollama`.
  기존 호스트는 `EMBED_PROVIDER=ollama` 로 두면 BGE-M3 경로 그대로입니다.
- **`config.py`** — `EMBED_PROVIDER` / `FASTEMBED_MODEL` / `EXO_ENABLED` 추가.
  `EMBED_DIM` 기본값이 provider 에 따라 384 또는 1024 로 갈립니다.
- **`rag.py` / `ingest.py`** — 임베딩 호출을 `embeddings.py` 로 위임.
- **`llm_router.py`** — `EXO_ENABLED=false` 면 Exo 를 아예 건너뜁니다.
  켜 두면 매 요청이 1순위 Exo 에서 타임아웃을 먹고 폴백해 첫 응답이 그만큼 느려집니다.
  `active_provider` 초기값을 `"exo"` 하드코딩에서 `None` 으로 — Exo 가 없는데도
  활성인 것처럼 보고하던 문제.
- **`app.py`**
  - `/health` 의 Exo 판정: `EXO_BASE_URL.rstrip('/v1')` 은 접미사가 아니라 문자 집합
    `{'/','v','1'}` 을 깎습니다. `http://host:1/v1` → `http://host:` 가 되어 포트가
    비고 80 번(nginx)을 찔러 **Exo 가 없는데 "up" 으로 보고**했습니다. 접미사 제거로 수정.
  - `/health` 에 `embedding` 블록 추가 (provider/model/dim).
  - `/chat`: 모든 LLM 실패 시 맨 500 대신 **503 + 원인 메시지**.
  - 기본 관리자 계정을 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 로 덮어쓸 수 있게. 기본값은
    기존과 동일(`info@gngmeta.com` / `admin1234`)이라 기존 배포는 영향 없습니다.
    **공개 도메인에 올릴 때는 반드시 덮어쓰세요.**
- **`ingest.py` — `collection_name_sanitize()`** — 한글 전용 이름("배포검증")은 치환 후
  빈 문자열이 되어 전부 `default` 로 뭉개졌습니다. `app.py` 의 중복 가드가 uuid 접미사를
  붙여 문서 혼입 자체는 막지만, 이름이 불투명해지고 DB 를 초기화했는데 Qdrant 가 남아
  있으면 가드가 무력해집니다. 원본 이름 해시를 붙여 항상 고유·안정적인 이름이 나오게 했습니다
  (`에너지진단` → `col_37dfd6b9a4`). 기존 컬렉션은 생성 시점의 `xai_id` 를 DB 에 저장해
  두고 재사용하므로 영향받지 않습니다.
- **`database.py`** — `DATABASE_URL` 환경변수화, `echo=True` → `DB_ECHO`(기본 off).
  켜져 있으면 모든 SQL 이 journal 로 쏟아집니다.

## 6. 서버에서 손댄 것

- swap 2GB (`/swapfile`, fstab 등록) — 1 vCPU / 2GB 에서 빌드·임포트 피크 대비
- `sllm-qdrant.service`, `sllm-api.service` 신규 등록 (둘 다 enable)
- `/etc/nginx/sites-available/sllm.ets0404.com`, `snippets/sllm-app.conf` 신규
- 기존 `ets-server.service`, `ets0404-http`, `gov.agrisky` 는 **건드리지 않았습니다**

메모리 여유 (임베딩 모델 로드 전): 사용 573MB / 1962MB. 모델 로드 시 +약 350MB.
