"""
agents/crew.py — CrewAI 에이전트 크루 정의

3가지 실행 모드:
1. run_rag_crew()  — 2-에이전트 (리서처 + 분석가)
2. run_single_agent() — 단일 에이전트 빠른 답변
3. run_research_crew() — 3-에이전트 심층 분석 (리서처 + 팩트체커 + 보고서 작성자)
"""
import logging

from crewai import Agent, Task, Crew, LLM, Process
from config import (
    EXO_BASE_URL, EXO_API_KEY, LLM_MODEL,
    XAI_API_KEY, XAI_MODEL, XAI_BASE_URL,
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL,
    AGENT_VERBOSE, AGENT_MAX_ITER,
)
from llm_router import router as llm_router
from agents.tools import (
    rag_search_tool, rag_answer_tool,
    document_analyze_tool, list_collections_tool,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# LLM 팩토리
# ──────────────────────────────────────────────
# CrewAI 는 litellm 을 통해 LLM 을 직접 호출하므로 llm_router.complete() 를
# 거치지 않습니다. 그래서 폴백이 적용되지 않는 문제가 있었습니다.
# 대신 라우터가 관리하는 Circuit Breaker 상태를 읽어, 로컬 추론이 죽어 있으면
# 크루 생성 시점에 클라우드 provider 로 전환합니다.
#
# 우선순위는 llm_router 와 동일: 로컬 → Grok → ChatGPT
# (Claude 는 Anthropic 전용 API 라 OpenAI 호환 경로로 붙지 않아 제외)
_CREW_CHAIN = [
    ("exo",    lambda: (LLM_MODEL,    EXO_BASE_URL,    EXO_API_KEY or "local")),
    ("grok",   lambda: (XAI_MODEL,    XAI_BASE_URL,    XAI_API_KEY)),
    ("openai", lambda: (OPENAI_MODEL, OPENAI_BASE_URL, OPENAI_API_KEY)),
]


def _pick_provider() -> tuple[str, str, str, str]:
    """라우터의 Circuit Breaker 상태 기준으로 사용 가능한 provider 선택."""
    status = llm_router.status()["providers"]

    for name, resolve in _CREW_CHAIN:
        model, base_url, api_key = resolve()
        st = status.get(name, {})
        # 키가 없으면 스킵 (로컬은 키 불필요)
        if name != "exo" and not api_key:
            continue
        # Circuit 이 OPEN 이면 스킵
        if st.get("state") == "open":
            logger.warning(f"[Crew] {name} Circuit OPEN — 다음 provider 로 전환")
            continue
        return name, model, base_url, api_key

    # 전부 막혀 있으면 로컬로 재시도 (실패는 호출부에서 처리)
    logger.error("[Crew] 사용 가능한 provider 없음 — 로컬로 재시도")
    return "exo", LLM_MODEL, EXO_BASE_URL, EXO_API_KEY or "local"


def create_llm(temperature: float = 0.1) -> LLM:
    """현재 살아있는 provider 로 CrewAI LLM 생성 (OpenAI 호환 경로)"""
    name, model, base_url, api_key = _pick_provider()
    if name != "exo":
        logger.info(f"[Crew] 폴백 provider 사용: {name} ({model})")
    return LLM(
        model=f"openai/{model}",
        base_url=base_url,
        api_key=api_key,
        temperature=temperature,
        max_tokens=1024,
    )


# ──────────────────────────────────────────────
# 에이전트 정의
# ──────────────────────────────────────────────
def create_researcher(llm: LLM) -> Agent:
    return Agent(
        role="문서 리서처",
        goal="사용자 질문에 관련된 내부 문서를 검색하고 핵심 정보를 추출한다",
        backstory=(
            "당신은 기업 문서 데이터베이스에서 정확한 정보를 찾아내는 전문가입니다. "
            "복잡한 질문을 세부 쿼리로 분해하여 검색하는 능력이 뛰어납니다."
        ),
        tools=[rag_search_tool, list_collections_tool],
        llm=llm,
        verbose=AGENT_VERBOSE,
        max_iter=AGENT_MAX_ITER,
        allow_delegation=False,
    )


def create_analyst(llm: LLM) -> Agent:
    return Agent(
        role="데이터 분석가",
        goal="검색된 문서를 분석하고 정확하고 명확한 한국어 답변을 작성한다",
        backstory=(
            "당신은 복잡한 기업 문서를 분석하고 명확한 인사이트를 도출하는 전문가입니다. "
            "항상 근거 문서를 인용하며 사실 기반의 답변만 작성합니다."
        ),
        tools=[],
        llm=llm,
        verbose=AGENT_VERBOSE,
        allow_delegation=False,
    )


def create_fact_checker(llm: LLM) -> Agent:
    return Agent(
        role="팩트 체커",
        goal="분석가의 답변이 실제 문서 근거와 일치하는지 검증한다",
        backstory=(
            "당신은 정보의 정확성을 검증하는 전문가입니다. "
            "컨텍스트에 없는 내용이 답변에 포함되어 있는지 꼼꼼하게 확인합니다."
        ),
        tools=[rag_search_tool],
        llm=llm,
        verbose=AGENT_VERBOSE,
        allow_delegation=False,
    )


def create_report_writer(llm: LLM) -> Agent:
    return Agent(
        role="보고서 작성자",
        goal="분석 결과를 구조화된 한국어 보고서로 작성한다",
        backstory=(
            "당신은 복잡한 분석 결과를 경영진도 이해할 수 있는 명확한 보고서로 "
            "작성하는 전문가입니다. 항상 결론, 근거, 권고사항 순으로 작성합니다."
        ),
        tools=[document_analyze_tool],
        llm=create_llm(temperature=0.3),  # 작성은 약간 창의적으로
        verbose=AGENT_VERBOSE,
        allow_delegation=False,
    )


# ──────────────────────────────────────────────
# Mode 1: 단일 에이전트 (빠른 RAG)
# ──────────────────────────────────────────────
def run_single_agent(query: str, collection_name: str = "default") -> dict:
    """
    단일 에이전트로 빠른 RAG 답변 생성.
    일반 /chat 대체 또는 간단한 질문에 사용.
    """
    llm = create_llm()

    agent = Agent(
        role="RAG 어시스턴트",
        goal="문서를 검색하여 사용자 질문에 정확하게 답한다",
        backstory="당신은 사내 문서 검색 전문가입니다.",
        tools=[rag_answer_tool],
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )

    task = Task(
        description=(
            f"다음 질문에 대해 컬렉션 '{collection_name}'에서 문서를 검색하여 답하세요.\n"
            f"질문: {query}\n\n"
            f"rag_answer_tool을 사용하세요. collection_name='{collection_name}'"
        ),
        expected_output="질문에 대한 한국어 답변 (근거 문서 포함)",
        agent=agent,
    )

    crew = Crew(agents=[agent], tasks=[task], verbose=False)
    result = crew.kickoff()
    return {"answer": str(result), "mode": "single_agent"}


# ──────────────────────────────────────────────
# Mode 2: 2-에이전트 크루 (표준 RAG)
# ──────────────────────────────────────────────
def run_rag_crew(query: str, collection_name: str = "default") -> dict:
    """
    리서처 → 분석가 2단계 크루.
    복잡한 질문이나 여러 문서 종합이 필요할 때 사용.
    """
    llm = create_llm()
    researcher = create_researcher(llm)
    analyst    = create_analyst(llm)

    research_task = Task(
        description=(
            f"다음 질문과 관련된 문서를 컬렉션 '{collection_name}'에서 검색하세요.\n"
            f"질문: {query}\n\n"
            "rag_search_tool을 사용하여 여러 각도로 검색하고 핵심 내용을 요약하세요.\n"
            f"collection_name='{collection_name}'"
        ),
        expected_output="검색된 문서의 핵심 내용 요약 (출처 및 유사도 포함)",
        agent=researcher,
    )

    analysis_task = Task(
        description=(
            f"리서처가 찾은 문서 내용을 바탕으로 다음 질문에 답하세요:\n"
            f"질문: {query}\n\n"
            "규칙:\n"
            "1. 반드시 검색된 문서 근거에만 기반하여 답변\n"
            "2. 한국어로 명확하게 작성\n"
            "3. 컨텍스트에 없는 내용은 추측하지 않음\n"
            "4. 답변 끝에 참고 문서 목록 포함"
        ),
        expected_output="구조화된 한국어 답변 (결론 + 근거 + 참고 문서)",
        agent=analyst,
        context=[research_task],
    )

    crew = Crew(
        agents=[researcher, analyst],
        tasks=[research_task, analysis_task],
        process=Process.sequential,
        verbose=False,
    )
    result = crew.kickoff()
    return {"answer": str(result), "mode": "rag_crew_2agent"}


# ──────────────────────────────────────────────
# Mode 3: 3-에이전트 크루 (심층 분석)
# ──────────────────────────────────────────────
def run_research_crew(query: str, collection_name: str = "default") -> dict:
    """
    리서처 → 팩트체커 → 보고서작성자 3단계 심층 분석.
    보고서 작성이나 정확도가 중요한 케이스에 사용.
    """
    llm = create_llm()
    researcher   = create_researcher(llm)
    fact_checker = create_fact_checker(llm)
    writer       = create_report_writer(llm)

    research_task = Task(
        description=(
            f"'{collection_name}' 컬렉션에서 다음 주제에 관련된 모든 문서를 검색하세요:\n"
            f"주제: {query}\n\n"
            "다양한 키워드로 여러 번 검색하여 포괄적인 정보를 수집하세요."
        ),
        expected_output="관련 문서 전체 목록과 핵심 내용 (출처 포함)",
        agent=researcher,
    )

    fact_check_task = Task(
        description=(
            f"리서처가 수집한 문서 정보를 검증하세요.\n"
            f"원래 질문: {query}\n\n"
            "확인 사항:\n"
            "1. 수집된 정보가 실제 문서와 일치하는지\n"
            "2. 누락된 중요 정보가 있는지 추가 검색\n"
            "3. 상충되는 정보가 있으면 명시"
        ),
        expected_output="검증 완료된 정보와 신뢰도 평가",
        agent=fact_checker,
        context=[research_task],
    )

    report_task = Task(
        description=(
            f"검증된 정보를 바탕으로 다음 주제에 대한 보고서를 작성하세요:\n"
            f"주제: {query}\n\n"
            "보고서 구조:\n"
            "1. 요약 (Executive Summary)\n"
            "2. 핵심 발견사항\n"
            "3. 세부 분석\n"
            "4. 결론 및 권고사항\n"
            "5. 참고 문서 목록"
        ),
        expected_output="전문적인 한국어 분석 보고서",
        agent=writer,
        context=[research_task, fact_check_task],
    )

    crew = Crew(
        agents=[researcher, fact_checker, writer],
        tasks=[research_task, fact_check_task, report_task],
        process=Process.sequential,
        verbose=False,
    )
    result = crew.kickoff()
    return {"answer": str(result), "mode": "research_crew_3agent"}
