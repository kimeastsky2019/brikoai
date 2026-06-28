# 시스템 아키텍처 — RAG + CrewAI on TB5 RDMA 클러스터

> **버전**: v3.0  
> **최종 업데이트**: 2026-06

---

## 1. 개요

기존 xAI/Grok 클라우드 의존 RAG 시스템을 **TB5 RDMA Mac mini M4 Pro 클러스터**에 완전 온프레미스로 이전한 통합 아키텍처입니다.  
LLM은 **Qwen 2.5 72B** (Alibaba, 한국어 최적화), 멀티에이전트는 **CrewAI**, 벡터 DB는 **Qdrant**를 사용합니다.

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    클라이언트 (브라우저)                        │
│              React + Vite + TypeScript + Tailwind            │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / REST
┌────────────────────────▼────────────────────────────────────┐
│                FastAPI Backend  (Node 1 — Primary)           │
│                                                              │
│  /chat     → RAG Pipeline (rag.py)                          │
│  /agent    → CrewAI Crew  (agents/crew.py)          [NEW]   │
│  /analyze  → Exo LLM 직접 호출                               │
│  /collections/* → Qdrant 컬렉션 관리                          │
│  /token    → JWT 인증                                        │
└────┬──────────────────────────┬──────────────────────────────┘
     │                          │
     ▼                          ▼
┌─────────────────┐    ┌────────────────────────────────────┐
│  Qdrant         │    │     Exo 1.0 RDMA Cluster           │
│  (Vector DB)    │    │                                    │
│  Port: 6333     │    │  4 × Mac mini M4 Pro (TB5 Ring)    │
│  ARM 네이티브    │    │  192 GB RDMA Unified Memory Pool   │
│                 │    │                                    │
│  Collections:   │    │  Model: Qwen 2.5 72B               │
│  - per 컬렉션   │    │  Port: 52415 (OpenAI-compatible)   │
│  Chunks: 512자  │    │  Throughput: 30+ tok/s             │
└─────────────────┘    └────────────────────────────────────┘
     │
     ▼
┌─────────────────┐
│  Ollama         │
│  (Embedding)    │
│  BGE-M3 1024d   │
│  Port: 11434    │
│  한/영/중 다국어  │
└─────────────────┘
```

---

## 3. 레이어별 상세

### 3.1 인프라 레이어

| 항목 | 사양 |
|------|------|
| 노드 | 4 × Apple Mac mini M4 Pro (12c CPU / 20c GPU) |
| 메모리 | 48 GB Unified Memory × 4 = **192 GB RDMA Pool** |
| 네트워크 | Thunderbolt 5 RDMA 80Gbps Ring + 1GbE Management |
| OS | macOS 26.2 Tahoe (RDMA 활성화) |

### 3.2 AI 런타임 레이어

| 컴포넌트 | 버전 | 역할 |
|----------|------|------|
| Exo 1.0 | RDMA | 4노드 텐서 병렬 LLM 추론 |
| Qwen 2.5 72B | Alibaba | 한국어/영어/중국어 LLM |
| Ollama | 최신 | BGE-M3 임베딩 서빙 |
| BGE-M3 | BAAI | 다국어 1024-dim 임베딩 |
| Qdrant | 1.9+ | 벡터 DB (ARM 네이티브) |

### 3.3 에이전트 레이어 (CrewAI)

```
CrewAI 3가지 실행 모드

Mode 1 — Single Agent   : 빠른 단일 RAG 답변
Mode 2 — RAG Crew       : 리서처 → 분석가 (2-Agent, 균형)
Mode 3 — Research Crew  : 리서처 → 팩트체커 → 작성자 (3-Agent, 심층)
```

**에이전트 역할**

| 에이전트 | 도구 | 역할 |
|----------|------|------|
| 문서 리서처 | `rag_search_tool`, `list_collections_tool` | Qdrant 검색, 정보 수집 |
| 데이터 분석가 | 없음 (LLM only) | 검색 결과 분석, 답변 작성 |
| 팩트 체커 | `rag_search_tool` | 답변 정확도 검증 |
| 보고서 작성자 | `document_analyze_tool` | 전문 보고서 작성 |

### 3.4 RAG 파이프라인

```
사용자 질문
    │
    ▼
BGE-M3 임베딩 (Ollama)
    │ 1024-dim vector
    ▼
Qdrant 벡터 검색 (코사인 유사도, Top-K=5)
    │ 메타데이터 필터 적용 (category, tags, ...)
    ▼
컨텍스트 빌드 (청크 조합)
    │
    ▼
Exo / Qwen 2.5 72B 생성
    │ system: SYSTEM_GUARDRAIL + 필터 안내
    │ user: 컨텍스트 + 질문
    ▼
답변 + 인용(citations) 반환
```

---

## 4. API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/token` | JWT 로그인 |
| POST | `/register` | 회원가입 |
| GET | `/health` | 시스템 상태 확인 |
| GET | `/stats` | 사용량 통계 |
| GET | `/collections` | 컬렉션 목록 |
| POST | `/collections` | 컬렉션 생성 |
| PUT | `/collections/{id}` | 컬렉션 수정 |
| DELETE | `/collections/{id}` | 컬렉션 삭제 |
| GET | `/collections/{id}` | 문서 목록 |
| POST | `/collections/{id}/upload` | 문서 업로드 + 인제스트 |
| POST | `/collections/{id}/analyze` | 컬렉션 AI 분석 |
| POST | `/analyze` | 단일 문서 AI 분석 |
| POST | `/chat` | RAG 채팅 **(기존)** |
| POST | `/agent` | CrewAI 에이전트 **(신규)** |
| DELETE | `/documents/{id}` | 문서 삭제 |

### `/agent` 요청 형식

```json
{
  "query": "2025년 3분기 매출 분석 보고서를 작성해줘",
  "collection_id": 1,
  "mode": "research_crew"
}
```

**mode 옵션**: `single` / `rag_crew` (기본값) / `research_crew`

---

## 5. 데이터 모델 변경사항

| 필드 | 기존 (xAI) | 변경 후 (Qdrant) |
|------|-----------|-----------------|
| `Collection.xai_id` | Grok Collection UUID | **Qdrant 컬렉션 이름** |
| `Document.xai_doc_id` | xAI Document UUID | **인제스트 작업 UUID** |
| 인증 키 | `XAI_API_KEY` 필요 | 불필요 (로컬) |
| 비용 | 토큰당 과금 | **$0 (온프레미스)** |

---

## 6. 청킹 전략

| 파라미터 | 값 | 설명 |
|----------|-----|------|
| CHUNK_SIZE | 512자 | 한국어 문서 최적 (약 256 토큰) |
| CHUNK_OVERLAP | 64자 | 문맥 연속성 유지 |
| 임베딩 차원 | 1024 | BGE-M3 기본 |
| 유사도 함수 | Cosine | Qdrant 기본 |

---

## 7. 배포 구성

```
Node 1 (Primary)  — FastAPI + Qdrant + Ollama(BGE-M3)
Node 2~4          — Exo RDMA Worker (Qwen 2.5 72B 텐서 병렬)

모든 노드:
  - macOS 26.2 Tahoe
  - TB5 RDMA 활성화 (rdma_ctl enable)
  - Exo 1.0 실행
```
