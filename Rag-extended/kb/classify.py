"""업종 자동 분류 — 규칙이 1차, LLM 은 보조.

**LLM 에게 분류를 묻지 않는다**는 것이 이 모듈의 설계다.
자유 서술로 라벨을 받으면 같은 보고서가 업로드마다 다른 업종을 받고, 그 순간
업종별 컬렉션 분리와 업종별 필수지표 점검이 전부 무너진다.

그래서:
  1. 어휘 규칙으로 점수를 낸다 (결정론적, 재현 가능)
  2. 1·2위 점수차가 충분하면 **그대로 확정**한다
  3. 애매하면 확정하지 않고 `needs_review=True` 로 사람에게 넘긴다
  4. LLM 은 3의 경우에만, 그것도 **닫힌 집합 중 하나를 고르라**는 형태로 부른다

정밀도 우선이다. 커버리지를 늘리려다 잘못 분류하면 그 문서는 영영 엉뚱한
컬렉션에서 검색된다 — 틀린 라벨은 없는 라벨보다 나쁘다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import taxonomy


# 1·2위 점수차가 이 값 미만이면 확정하지 않는다.
MARGIN_THRESHOLD = 0.25
# 최소 이만큼은 맞아야 분류를 시도한다.
MIN_SCORE = 3.0


@dataclass
class SectorVote:
    sector: str
    score: float
    matched: list[str] = field(default_factory=list)


@dataclass
class Classification:
    sector: str
    confidence: float
    needs_review: bool
    method: str                     # rule | llm | fallback
    votes: list[SectorVote] = field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> dict:
        p = taxonomy.get(self.sector)
        return {
            "sector": self.sector,
            "sector_name": p.name,
            "ksic": p.ksic,
            "confidence": round(self.confidence, 3),
            "needs_review": self.needs_review,
            "method": self.method,
            "reason": self.reason,
            "unit_basis": p.unit_basis,
            "votes": [
                {
                    "sector": v.sector,
                    "sector_name": taxonomy.get(v.sector).name,
                    "score": round(v.score, 2),
                    "matched": v.matched[:8],
                }
                for v in self.votes[:5]
            ],
        }


def _score(text: str) -> list[SectorVote]:
    """어휘 규칙 점수. 등장 횟수의 제곱근을 쓴다 — 한 단어가 100번 나와도
    다른 단어 10종이 한 번씩 나온 쪽이 이겨야 하기 때문이다."""
    votes: list[SectorVote] = []
    low = text
    for code, prof in taxonomy.SECTORS.items():
        if not prof.hints:
            continue
        total, matched = 0.0, []
        for h in prof.hints:
            n = len(re.findall(re.escape(h), low))
            if n:
                total += n ** 0.5
                matched.append(f"{h}×{n}")
        # 주요 설비명도 약한 신호로 센다
        for eq in prof.key_equipment:
            n = len(re.findall(re.escape(eq), low))
            if n:
                total += 0.4 * (n ** 0.5)
                matched.append(f"{eq}×{n}")
        if total > 0:
            votes.append(SectorVote(sector=code, score=total, matched=matched))
    votes.sort(key=lambda v: -v.score)
    return votes


def classify_text(text: str) -> Classification:
    """규칙만으로 분류. LLM 없이 동작하는 기준선 — 망분리 환경에서도 돈다."""
    votes = _score(text)
    if not votes or votes[0].score < MIN_SCORE:
        return Classification(
            sector="other", confidence=0.0, needs_review=True, method="fallback",
            votes=votes,
            reason=f"업종 어휘 점수가 임계값({MIN_SCORE}) 미만입니다. 사람이 지정해야 합니다.",
        )

    top = votes[0]
    second = votes[1].score if len(votes) > 1 else 0.0
    total = sum(v.score for v in votes) or 1.0
    confidence = top.score / total
    margin = (top.score - second) / top.score if top.score else 0.0

    if margin < MARGIN_THRESHOLD:
        runner = votes[1].sector if len(votes) > 1 else "-"
        return Classification(
            sector=top.sector, confidence=confidence, needs_review=True, method="rule",
            votes=votes,
            reason=(
                f"1위 {taxonomy.get(top.sector).name}({top.score:.1f})와 "
                f"2위 {taxonomy.get(runner).name}({second:.1f})의 격차가 "
                f"{margin:.0%}로 임계값({MARGIN_THRESHOLD:.0%}) 미만입니다. 판단 유보."
            ),
        )

    return Classification(
        sector=top.sector, confidence=confidence, needs_review=False, method="rule",
        votes=votes,
        reason=(
            f"{taxonomy.get(top.sector).name} 어휘 {len(top.matched)}종 일치, "
            f"2위 대비 격차 {margin:.0%}."
        ),
    )


def classify_document(doc) -> Classification:
    """ParsedDocument 를 분류한다. 표의 셀 텍스트도 신호로 쓴다 —
    설비명은 본문보다 표에 더 정확하게 적혀 있다."""
    parts = [doc.full_text]
    for t in doc.tables:
        parts.append(" ".join(t.header))
        for r in t.rows:
            parts.append(" ".join(r))
    return classify_text("\n".join(parts))


# --------------------------------------------------------------------------
# 필수지표 커버리지 — "업종을 알면 무엇이 빠졌는지 물을 수 있다"
# --------------------------------------------------------------------------
def metric_coverage(doc, sector: str) -> dict:
    """업종 프로파일의 required_metrics 가 문서에 실제로 존재하는지 점검.

    LLMWiki 규제 지식그래프의 '커버리지 갭 자동 탐지'와 같은 것이다 —
    통제가 연결되지 않은 의무를 찾듯, 진단서에 빠진 필수지표를 찾는다.
    """
    prof = taxonomy.get(sector)
    haystack = doc.full_text
    for t in doc.tables:
        haystack += "\n" + " ".join(t.header) + "\n"
        haystack += "\n".join(" ".join(r) for r in t.rows)

    present, missing = [], []
    for m in prof.required_metrics:
        pats = taxonomy.METRIC_PATTERNS.get(m, ())
        hit = next((p for p in pats if p in haystack), None)
        entry = {
            "code": m,
            "label": taxonomy.METRIC_LABELS.get(m, m),
            "evidence": hit or None,
        }
        (present if hit else missing).append(entry)

    n = len(prof.required_metrics) or 1
    return {
        "sector": sector,
        "sector_name": prof.name,
        "unit_basis": prof.unit_basis,
        "required": n,
        "present": present,
        "missing": missing,
        "coverage": round(len(present) / n, 3),
    }
