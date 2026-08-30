"""
llm_router.py — Circuit Breaker + 자동 폴백 LLM 라우터

우선순위:
  1순위 (Primary)   : 로컬 추론 (Ollama / Exo, OpenAI 호환 엔드포인트)
  2순위 (Fallback 1): Grok / xAI API           (속도 우선 클라우드)
  3순위 (Fallback 2): ChatGPT / OpenAI API
  4순위 (Fallback 3): Claude / Anthropic API   (품질 우선 클라우드)

API 키가 비어 있는 provider 는 자동으로 건너뜁니다.

Circuit Breaker 상태:
  CLOSED    → 정상 동작
  OPEN      → 장애 감지, 폴백으로 전환
  HALF_OPEN → recovery_sec 경과 후 재시도 테스트

사용법:
  from llm_router import router

  response = await router.complete(
      messages=[{"role": "user", "content": "안녕"}],
      max_tokens=512,
  )
  # response: {"content": "...", "provider": "exo|grok|claude", "model": "..."}
"""

import asyncio
import time
import logging
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

import httpx
from openai import AsyncOpenAI

from config import (
    # Exo (Primary)
    EXO_ENABLED, EXO_BASE_URL, EXO_API_KEY, LLM_MODEL,
    # Grok (Fallback 1)
    XAI_API_KEY, XAI_MODEL, XAI_BASE_URL,
    # ChatGPT (Fallback 2)
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL,
    # Claude (Fallback 3)
    ANTHROPIC_API_KEY, CLAUDE_MODEL,
    # Circuit Breaker
    CB_FAILURE_THRESHOLD, CB_TIMEOUT_SEC, CB_RECOVERY_SEC,
)

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════
# Circuit Breaker
# ══════════════════════════════════════════════════════════

class CircuitState(Enum):
    CLOSED    = "closed"     # 정상
    OPEN      = "open"       # 차단 (폴백 사용)
    HALF_OPEN = "half_open"  # 회복 테스트 중


@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = CB_FAILURE_THRESHOLD
    timeout_sec: float     = CB_TIMEOUT_SEC
    recovery_sec: int      = CB_RECOVERY_SEC

    state: CircuitState      = field(default=CircuitState.CLOSED, init=False)
    failure_count: int       = field(default=0, init=False)
    success_count: int       = field(default=0, init=False)   # 통계용
    last_failure_time: float = field(default=0.0, init=False)
    opened_at: float         = field(default=0.0, init=False)
    last_latency_ms: int     = field(default=0, init=False)

    def can_attempt(self) -> bool:
        """이 프로바이더로 요청 시도 가능 여부"""
        if self.state == CircuitState.CLOSED:
            return True
        if self.state == CircuitState.OPEN:
            # recovery_sec 경과 시 HALF_OPEN으로 전환
            if time.time() - self.opened_at >= self.recovery_sec:
                self.state = CircuitState.HALF_OPEN
                logger.info(f"[{self.name}] Circuit HALF_OPEN — 회복 테스트 시작")
                return True
            return False
        # HALF_OPEN: 한 번 허용
        return True

    def record_success(self, latency_ms: int = 0):
        if self.state == CircuitState.HALF_OPEN:
            logger.info(f"[{self.name}] Circuit CLOSED — 회복 완료")
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count += 1
        self.last_latency_ms = latency_ms

    def record_failure(self, reason: str = ""):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold or self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.OPEN
            self.opened_at = time.time()
            logger.warning(
                f"[{self.name}] Circuit OPEN — "
                f"연속 실패 {self.failure_count}회 / 사유: {reason}"
            )

    def status(self) -> dict:
        return {
            "state":         self.state.value,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "last_latency_ms": self.last_latency_ms,
            "open_since":    self.opened_at if self.state == CircuitState.OPEN else None,
        }


# ══════════════════════════════════════════════════════════
# Provider 기본 클래스
# ══════════════════════════════════════════════════════════

class LLMProvider:
    name: str
    model: str
    cb: CircuitBreaker

    async def complete(self, messages: list[dict], **kwargs) -> dict:
        raise NotImplementedError

    def is_available(self) -> bool:
        """API 키 등 필수 설정 존재 여부"""
        return True


# ══════════════════════════════════════════════════════════
# Provider 1: Exo / Qwen 2.5 72B (Primary)
# ══════════════════════════════════════════════════════════

class ExoProvider(LLMProvider):
    name  = "exo"
    model = LLM_MODEL

    def __init__(self):
        self.cb = CircuitBreaker(name="exo")
        self._client: Optional[AsyncOpenAI] = None

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                base_url=EXO_BASE_URL,
                api_key=EXO_API_KEY,
            )
        return self._client

    def is_available(self) -> bool:
        return EXO_ENABLED and bool(EXO_BASE_URL)

    async def complete(self, messages: list[dict], **kwargs) -> dict:
        client = self._get_client()
        resp = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            **kwargs,
        )
        return {
            "content":  resp.choices[0].message.content or "",
            "provider": self.name,
            "model":    self.model,
            "usage":    {
                "prompt_tokens":     getattr(resp.usage, "prompt_tokens", None),
                "completion_tokens": getattr(resp.usage, "completion_tokens", None),
                "total_tokens":      getattr(resp.usage, "total_tokens", None),
            },
        }


# ══════════════════════════════════════════════════════════
# Provider 2: Grok / xAI (Fallback 1 — 속도 우선)
# ══════════════════════════════════════════════════════════

class GrokProvider(LLMProvider):
    name  = "grok"
    model = XAI_MODEL
    _XAI_BASE = XAI_BASE_URL

    def __init__(self):
        self.cb = CircuitBreaker(name="grok")
        self._client: Optional[AsyncOpenAI] = None

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                base_url=self._XAI_BASE,
                api_key=XAI_API_KEY,
            )
        return self._client

    def is_available(self) -> bool:
        return bool(XAI_API_KEY)

    async def complete(self, messages: list[dict], **kwargs) -> dict:
        client = self._get_client()
        resp = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            **kwargs,
        )
        return {
            "content":  resp.choices[0].message.content or "",
            "provider": self.name,
            "model":    self.model,
            "usage":    {
                "prompt_tokens":     getattr(resp.usage, "prompt_tokens", None),
                "completion_tokens": getattr(resp.usage, "completion_tokens", None),
                "total_tokens":      getattr(resp.usage, "total_tokens", None),
            },
        }


# ══════════════════════════════════════════════════════════
# Provider 3: ChatGPT / OpenAI (Fallback 2)
# ══════════════════════════════════════════════════════════

class OpenAIProvider(LLMProvider):
    name  = "openai"
    model = OPENAI_MODEL

    def __init__(self):
        self.cb = CircuitBreaker(name="openai")
        self._client: Optional[AsyncOpenAI] = None

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                base_url=OPENAI_BASE_URL,
                api_key=OPENAI_API_KEY,
            )
        return self._client

    def is_available(self) -> bool:
        return bool(OPENAI_API_KEY)

    async def complete(self, messages: list[dict], **kwargs) -> dict:
        client = self._get_client()
        resp = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            **kwargs,
        )
        return {
            "content":  resp.choices[0].message.content or "",
            "provider": self.name,
            "model":    self.model,
            "usage":    {
                "prompt_tokens":     getattr(resp.usage, "prompt_tokens", None),
                "completion_tokens": getattr(resp.usage, "completion_tokens", None),
                "total_tokens":      getattr(resp.usage, "total_tokens", None),
            },
        }


# ══════════════════════════════════════════════════════════
# Provider 4: Claude / Anthropic (Fallback 3 — 품질 우선)
# ══════════════════════════════════════════════════════════

class ClaudeProvider(LLMProvider):
    name  = "claude"
    model = CLAUDE_MODEL

    def __init__(self):
        self.cb = CircuitBreaker(name="claude")
        self._client = None

    def _get_client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        return self._client

    def is_available(self) -> bool:
        return bool(ANTHROPIC_API_KEY)

    async def complete(self, messages: list[dict], **kwargs) -> dict:
        client = self._get_client()

        # Claude API: system 메시지를 별도 파라미터로 분리
        system_msg = ""
        user_messages = []
        for m in messages:
            if m["role"] == "system":
                system_msg = m["content"]
            else:
                user_messages.append({"role": m["role"], "content": m["content"]})

        # max_tokens 기본값 (Claude 필수)
        max_tokens = kwargs.pop("max_tokens", 1024)

        create_kwargs = dict(
            model=self.model,
            max_tokens=max_tokens,
            messages=user_messages,
        )
        if system_msg:
            create_kwargs["system"] = system_msg

        resp = await client.messages.create(**create_kwargs)
        content = resp.content[0].text if resp.content else ""

        return {
            "content":  content,
            "provider": self.name,
            "model":    self.model,
            "usage": {
                "prompt_tokens":     getattr(resp.usage, "input_tokens", None),
                "completion_tokens": getattr(resp.usage, "output_tokens", None),
                "total_tokens":      (
                    (getattr(resp.usage, "input_tokens", 0) or 0)
                    + (getattr(resp.usage, "output_tokens", 0) or 0)
                ),
            },
        }


# ══════════════════════════════════════════════════════════
# LLM Router — Circuit Breaker 기반 자동 폴백
# ══════════════════════════════════════════════════════════

class LLMRouter:
    """
    우선순위 순서로 provider를 시도.
    실패 시 Circuit Breaker가 열리고 다음 provider로 자동 전환.
    """

    def __init__(self):
        self.providers: list[LLMProvider] = [
            ExoProvider(),    # 1순위: 로컬 추론 (Ollama / Exo)
            GrokProvider(),   # 2순위: xAI Grok   (속도)
            OpenAIProvider(), # 3순위: OpenAI ChatGPT
            ClaudeProvider(), # 4순위: Anthropic Claude (품질)
        ]
        # 현재 활성 provider 이름 추적 — 성공 호출 전에는 None(아직 미확정)
        self._active_provider: Optional[str] = None

    async def complete(
        self,
        messages: list[dict],
        temperature: float = 0.1,
        max_tokens: int = 1024,
    ) -> dict:
        """
        Circuit Breaker 체크 → 순서대로 시도 → 성공 시 반환, 실패 시 다음으로.
        모든 provider 실패 시 RuntimeError.
        """
        last_error: Optional[Exception] = None

        for provider in self.providers:
            # 비활성 API 키 스킵
            if not provider.is_available():
                logger.debug(f"[{provider.name}] API 키 없음 — 스킵")
                continue

            # Circuit Breaker 상태 확인
            if not provider.cb.can_attempt():
                logger.debug(
                    f"[{provider.name}] Circuit OPEN "
                    f"(회복까지 {int(provider.cb.recovery_sec - (time.time() - provider.cb.opened_at))}초)"
                )
                continue

            t0 = time.time()
            try:
                result = await asyncio.wait_for(
                    provider.complete(
                        messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    ),
                    timeout=provider.cb.timeout_sec,
                )
                latency_ms = int((time.time() - t0) * 1000)
                provider.cb.record_success(latency_ms)
                self._active_provider = provider.name

                if provider.name != "exo":
                    logger.info(
                        f"[Router] 폴백 사용 중: {provider.name} "
                        f"({latency_ms}ms)"
                    )

                return result

            except asyncio.TimeoutError:
                latency_ms = int((time.time() - t0) * 1000)
                reason = f"타임아웃 ({latency_ms}ms > {provider.cb.timeout_sec * 1000:.0f}ms)"
                provider.cb.record_failure(reason)
                logger.warning(f"[{provider.name}] {reason}")
                last_error = asyncio.TimeoutError(reason)

            except Exception as e:
                provider.cb.record_failure(str(e))
                logger.warning(f"[{provider.name}] 오류: {e}")
                last_error = e

        raise RuntimeError(
            f"모든 LLM 프로바이더 실패. 마지막 오류: {last_error}"
        )

    def status(self) -> dict:
        """현재 Circuit Breaker 상태 요약 (/health 엔드포인트용)"""
        providers_status = {}
        available_providers = []

        for p in self.providers:
            st = p.cb.status()
            st["available"] = p.is_available()
            # 화면이 "지금 어느 모델이 답하는가" 를 지어내지 않고 그대로 보여줄 수 있도록.
            st["model"] = getattr(p, "model", None)
            providers_status[p.name] = st
            if p.is_available() and p.cb.can_attempt():
                available_providers.append(p.name)

        return {
            # 아직 성공 호출이 없으면 다음에 시도될 provider 를 보여줍니다.
            "active_provider": self._active_provider
                               or (available_providers[0] if available_providers else None),
            "available":       available_providers,
            "providers":       providers_status,
        }

    def reset(self, provider_name: str | None = None):
        """수동으로 Circuit Breaker 초기화 (관리자용)"""
        for p in self.providers:
            if provider_name is None or p.name == provider_name:
                p.cb.state = CircuitState.CLOSED
                p.cb.failure_count = 0
                logger.info(f"[{p.name}] Circuit 수동 초기화")


# ── 모듈 레벨 싱글턴 ──────────────────────────────────────
router = LLMRouter()
