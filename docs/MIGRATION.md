# 마이그레이션 가이드 — xAI/Grok → Exo + Qdrant

> **대상**: RAG_search 기존 운영자  
> **예상 소요 시간**: 2~4시간

---

## 변경 내용 요약

| 항목 | Before (xAI 클라우드) | After (온프레미스) |
|------|----------------------|-------------------|
| LLM | `grok-4-1-fast` (xAI API) | `qwen2.5:72b` (Exo 1.0) |
| 임베딩 | Grok Embeddings | BGE-M3 (Ollama) |
| 벡터 DB | Grok Collections + Pinecone | Qdrant |
| API 키 | `XAI_API_KEY` 필수 | 불필요 |
| 비용 | 토큰당 과금 | $0 (로컬) |
| 에이전트 | 없음 | CrewAI 3-모드 |
| 인터넷 의존 | 필수 | 완전 에어갭 |

---

## 사전 요건

### 하드웨어
- Mac mini M4 Pro (48GB) × 4대
- TB5 케이블 연결 (Ring 토폴로지: A→B→C→D→A)
- macOS 26.2 Tahoe

### 소프트웨어 (전 노드 설치)

```bash
# 1. Exo 설치
pip install exo-explore

# 2. RDMA 활성화 (Recovery Mode에서 실행)
rdma_ctl enable

# 3. Exo 클러스터 실행 (각 노드)
exo
```

### Node 1만 추가 설치

```bash
# Ollama 설치
curl -fsSL https://ollama.ai/install.sh | sh

# BGE-M3 임베딩 모델 다운로드
ollama pull bge-m3

# Qdrant 실행 (Docker 또는 바이너리)
docker run -p 6333:6333 qdrant/qdrant:latest
# 또는 macOS ARM 바이너리: https://github.com/qdrant/qdrant/releases
```

---

## Step 1: 코드 교체

```bash
cd RAG_search/Rag-extended

# 기존 파일 백업
cp config.py config.py.xai.bak
cp rag.py rag.py.xai.bak
cp app.py app.py.xai.bak

# 새 파일 복사 (migration/ 디렉토리에서)
cp ../migration/Rag-extended/config.py .
cp ../migration/Rag-extended/rag.py .
cp ../migration/Rag-extended/ingest.py .
cp ../migration/Rag-extended/app.py .
cp -r ../migration/Rag-extended/agents ./agents
```

---

## Step 2: 의존성 설치

```bash
# 가상 환경 재생성 (권장)
python -m venv .venv
source .venv/bin/activate

# 기존 xai-sdk 제거
pip uninstall xai-sdk -y

# 새 의존성 설치
pip install -r requirements.txt
```

---

## Step 3: 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일 수정:

```env
EXO_BASE_URL=http://localhost:52415/v1
LLM_MODEL=qwen2.5:72b
OLLAMA_BASE_URL=http://localhost:11434
QDRANT_HOST=localhost
QDRANT_PORT=6333
```

`.env`에서 **제거**해야 할 항목:
```
# 이 항목들은 더 이상 필요 없습니다
XAI_API_KEY=...
XAI_MANAGEMENT_API_KEY=...
XAI_MODEL=...
COLLECTION_NAME=...
COLLECTION_ID=...
```

---

## Step 4: 기존 데이터 마이그레이션

### 4-1. Qdrant 컬렉션 재생성

Grok Collections에 있던 문서들을 Qdrant로 재인제스트해야 합니다.

```bash
# 예: 기존 문서가 ./docs 폴더에 있는 경우
python ingest.py folder --collection my_collection --folder ./docs --category 정책

# 단일 파일
python ingest.py file --collection my_collection --file report.pdf --category 재무
```

### 4-2. DB 마이그레이션 (선택)

기존 SQLite DB의 `Collection.xai_id` 필드를 Qdrant 컬렉션 이름으로 업데이트합니다.

```python
# 마이그레이션 스크립트 예시
from ingest import collection_name_sanitize

# 기존 컬렉션 이름 → Qdrant 이름 변환
# 예: "내 컬렉션" → "my_collection"
qdrant_name = collection_name_sanitize("내 컬렉션")
```

---

## Step 5: 서버 실행

```bash
# 기존과 동일
uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## Step 6: 동작 확인

```bash
# 헬스 체크
curl http://localhost:8000/health
# 예상 응답: {"ok": true, "model": "qwen2.5:72b", "qdrant": "up", "exo": "up"}

# 문서 인제스트 테스트
python ingest.py file --collection test --file test_doc.txt

# RAG 채팅 테스트
curl -X POST http://localhost:8000/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "문서 핵심 요약해줘", "collection_id": 1}'

# CrewAI 에이전트 테스트 (신규)
curl -X POST http://localhost:8000/agent \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "3분기 성과를 분석해줘", "collection_id": 1, "mode": "rag_crew"}'
```

---

## 자주 발생하는 문제

### Ollama 임베딩 실패
```bash
# BGE-M3가 설치됐는지 확인
ollama list | grep bge-m3
# 없으면: ollama pull bge-m3
```

### Exo 연결 실패
```bash
# Exo 포트 확인
curl http://localhost:52415/v1/models
# 실패 시: exo 재실행
```

### Qdrant 컬렉션 없음 오류
```bash
# 컬렉션이 자동 생성됩니다. 아니면 수동:
python -c "
from qdrant_client import QdrantClient
from ingest import ensure_collection
c = QdrantClient('localhost', port=6333)
ensure_collection(c, 'my_collection')
"
```

### `xai_sdk` import 오류
기존 `.py` 파일에 `from xai_sdk import ...` 가 남아있으면 migration 파일로 교체가 필요합니다.

---

## 롤백

문제 발생 시 기존 xAI 버전으로 복원:

```bash
cp config.py.xai.bak config.py
cp rag.py.xai.bak rag.py
cp app.py.xai.bak app.py
pip install xai-sdk
```
