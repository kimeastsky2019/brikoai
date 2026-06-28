# RAG_search — 온프레미스 RAG + CrewAI 에이전트 시스템

> **Stack**: Exo 1.0 · Qwen 2.5 72B · Qdrant · BGE-M3 · CrewAI  
> **Cluster**: 4 × Mac mini M4 Pro (TB5 RDMA 80Gbps, 192GB 통합 메모리)  
> **언어 지원**: 한국어 · 영어 · 중국어

---

## 특징

- **완전 온프레미스** — 클라우드 API 키 불필요, 인터넷 차단 환경에서도 동작
- **한국어 최적화** — Qwen 2.5 72B (Alibaba) 한/영/중 다국어 지원
- **멀티에이전트** — CrewAI 기반 리서처·분석가·팩트체커·작성자 에이전트
- **고성능 추론** — TB5 RDMA 텐서 병렬, 30+ tok/s (70B 모델)
- **기업 문서 관리** — 컬렉션별 벡터 DB, 메타데이터 필터, 온톨로지 분석

---

## 빠른 시작

### 1. 의존성 설치

```bash
cd Rag-extended
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 환경 설정

```bash
cp .env.example .env
# .env 파일에서 EXO_BASE_URL, QDRANT_HOST 등 확인
```

### 3. 인프라 실행

```bash
# Qdrant (Node 1)
docker run -d -p 6333:6333 qdrant/qdrant

# Ollama + BGE-M3 (Node 1)
ollama pull bge-m3

# Exo (전 노드)
exo
```

### 4. 문서 인제스트

```bash
python ingest.py folder --collection 내문서 --folder ./docs --category 정책
```

### 5. 서버 실행

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

### 6. 프론트엔드 실행

```bash
# 프로젝트 루트에서
npm install && npm run dev
```

---

## API 사용 예시

### RAG 채팅

```bash
# 로그인
TOKEN=$(curl -s -X POST http://localhost:8000/token \
  -d "username=info@gngmeta.com&password=admin1234" \
  | jq -r .access_token)

# RAG 질의
curl -X POST http://localhost:8000/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "3분기 매출 현황은?", "collection_id": 1}'
```

### CrewAI 에이전트

```bash
# 2-에이전트 크루 (리서처 + 분석가)
curl -X POST http://localhost:8000/agent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "계약 조항 중 위험 요소를 분석해줘", "collection_id": 1, "mode": "rag_crew"}'

# 3-에이전트 크루 (심층 보고서)
curl -X POST http://localhost:8000/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "경쟁사 대비 당사 포지셔닝 분석 보고서", "collection_id": 1, "mode": "research_crew"}'
```

---

## 프로젝트 구조

```
RAG_search/
├── src/                    # React 프론트엔드 (기존 유지)
├── Rag-extended/           # Python 백엔드
│   ├── app.py              # FastAPI 메인 (xAI → Exo 마이그레이션)
│   ├── rag.py              # RAG 파이프라인 (Qdrant + BGE-M3 + Exo)
│   ├── ingest.py           # 문서 인제스트 (Qdrant upsert)
│   ├── config.py           # 환경 설정
│   ├── agents/             # CrewAI 에이전트
│   │   ├── crew.py         # 크루 정의 (3가지 모드)
│   │   ├── tools.py        # RAG 도구 (rag_search, rag_answer, analyze)
│   │   └── tasks.py        # 재사용 태스크 템플릿
│   ├── requirements.txt
│   └── .env.example
├── docs/
│   ├── ARCHITECTURE.md     # 시스템 아키텍처
│   └── MIGRATION.md        # xAI → Exo 마이그레이션 가이드
└── README.md
```

---

## 에이전트 모드

| 모드 | 에이전트 수 | 적합한 사용 사례 | 응답 시간 |
|------|------------|----------------|----------|
| `single` | 1 | 단순 질의응답 | ~10초 |
| `rag_crew` | 2 (리서처 + 분석가) | 복잡한 질문, 여러 문서 종합 | ~30초 |
| `research_crew` | 3 (리서처 + 팩트체커 + 작성자) | 보고서 작성, 팩트체크 | ~60초 |

---

## 인제스트 지원 파일 형식

- PDF (`.pdf`) — 페이지별 텍스트 추출
- Word (`.docx`, `.doc`) — 단락 추출
- 텍스트 (`.txt`, `.md`) — 직접 처리

청킹: 512자 슬라이딩 윈도우, 64자 오버랩

---

## 하드웨어 요구사항

| 구성 | 최소 | 권장 |
|------|------|------|
| 노드 | Mac mini M4 Pro 48GB × 2 | × 4 |
| 메모리 풀 | 96 GB RDMA | 192 GB RDMA |
| OS | macOS 26.2 Tahoe | 동일 |
| 네트워크 | TB5 RDMA | 동일 |

---

## 관련 문서

- [시스템 아키텍처](docs/ARCHITECTURE.md)
- [마이그레이션 가이드](docs/MIGRATION.md)
- [xAI → Exo 변경 이력](UPGRADE_PLAN.md)
