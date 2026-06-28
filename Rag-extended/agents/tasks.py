"""
agents/tasks.py — 재사용 가능한 태스크 템플릿

공통 비즈니스 시나리오에 대한 Task 팩토리 함수 모음.
crew.py에서 import하거나 커스텀 크루 구성 시 사용.
"""
from crewai import Task, Agent


def make_search_task(agent: Agent, query: str, collection_name: str) -> Task:
    """기본 문서 검색 태스크"""
    return Task(
        description=(
            f"컬렉션 '{collection_name}'에서 다음 질문과 관련된 문서를 검색하세요:\n"
            f"질문: {query}\n\n"
            f"rag_search_tool(query='{query}', collection_name='{collection_name}')을 호출하세요."
        ),
        expected_output="관련 문서 청크 목록 (출처, 유사도 포함)",
        agent=agent,
    )


def make_answer_task(agent: Agent, query: str, collection_name: str, context_tasks=None) -> Task:
    """RAG 답변 생성 태스크"""
    return Task(
        description=(
            f"다음 질문에 한국어로 답변하세요:\n질문: {query}\n\n"
            "반드시 제공된 컨텍스트 문서에 근거하여 답변하세요.\n"
            "컨텍스트에 없는 내용은 추측하지 마세요.\n"
            "답변 끝에 참고 문서 목록을 포함하세요."
        ),
        expected_output="한국어 답변 + 참고 문서 목록",
        agent=agent,
        context=context_tasks or [],
    )


def make_summary_task(agent: Agent, document_text: str) -> Task:
    """단일 문서 요약 태스크"""
    preview = document_text[:3000] if len(document_text) > 3000 else document_text
    return Task(
        description=(
            f"다음 문서를 분석하고 구조화된 요약을 작성하세요:\n\n{preview}\n\n"
            "요약 형식:\n"
            "- 문서 목적 (1~2문장)\n"
            "- 핵심 내용 bullet 3~5개\n"
            "- 주요 수치/날짜 (있는 경우)\n"
            "- 권장 액션 (있는 경우)"
        ),
        expected_output="구조화된 한국어 문서 요약",
        agent=agent,
    )


def make_comparison_task(agent: Agent, query: str, collection_name: str, context_tasks=None) -> Task:
    """문서 비교 분석 태스크"""
    return Task(
        description=(
            f"다음 주제에 대한 여러 문서를 비교 분석하세요:\n"
            f"주제: {query}\n컬렉션: {collection_name}\n\n"
            "분석 절차:\n"
            "1. 관련 문서 검색\n"
            "2. 각 문서의 핵심 주장/데이터 추출\n"
            "3. 공통점과 차이점 비교\n"
            "4. 종합 결론 도출"
        ),
        expected_output="문서 비교 분석 보고서 (표 또는 bullet 형식)",
        agent=agent,
        context=context_tasks or [],
    )


def make_fact_check_task(agent: Agent, claim: str, collection_name: str, context_tasks=None) -> Task:
    """팩트 체크 태스크"""
    return Task(
        description=(
            f"다음 주장을 내부 문서를 기반으로 검증하세요:\n"
            f"주장: {claim}\n컬렉션: {collection_name}\n\n"
            "검증 절차:\n"
            "1. 관련 문서 검색\n"
            "2. 주장을 지지하거나 반박하는 근거 탐색\n"
            "3. 판정: 사실 / 거짓 / 불확실 중 하나 선택\n"
            "4. 근거 문서 인용"
        ),
        expected_output="팩트체크 결과 (판정 + 근거 + 인용 문서)",
        agent=agent,
        context=context_tasks or [],
    )


def make_report_task(agent: Agent, topic: str, context_tasks=None) -> Task:
    """보고서 작성 태스크"""
    return Task(
        description=(
            f"다음 주제에 대한 전문 보고서를 한국어로 작성하세요:\n"
            f"주제: {topic}\n\n"
            "보고서 구조:\n"
            "1. 요약 (Executive Summary)\n"
            "2. 배경 및 목적\n"
            "3. 핵심 발견사항\n"
            "4. 세부 분석\n"
            "5. 결론 및 권고사항\n"
            "6. 참고 문서"
        ),
        expected_output="전문적인 한국어 보고서 (마크다운 형식)",
        agent=agent,
        context=context_tasks or [],
    )
