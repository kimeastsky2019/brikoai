"""규제 준수 검토 — 개인정보보호법 · 인공지능 기본법.

이 시스템은 고객사 문서를 **해외 사업자(xAI, 미국)의 Collections 로 업로드**해서
검색한다. 그 사실 하나가 두 개의 법적 의무를 발생시킨다.

1. 개인정보보호법 — 문서에 개인정보가 있으면 업로드는 **국외 이전**이다 (제28조의8).
   현재 `app.upload_document()` 는 마스킹 없이 원문을 그대로 올린다.
2. 인공지능 기본법 — 생성형 AI 로 분석 결과를 만들면 **투명성 확보 의무**가 붙는다
   (제31조: 사전 고지 + 생성물 표시).

두 검토 모두 **규칙 기반**이다. LLM 에게 "이 문서 개인정보 있나요" 를 묻지 않는다.
탐지 누락은 그대로 법 위반이 되므로, 재현 가능하고 감사 가능해야 한다.

판정은 하되 **확정은 사람이 한다**. 이 모듈은 `Finding` 을 만들고
`resolution` 은 비워 둔다.

법령 근거
  - 개인정보보호법 제28조의8 (국외 이전), 제28조의9 (중지 명령)
  - 개인정보보호법 제3조 (최소수집), 제29조 (안전조치)
  - 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법 (시행 2026.1.22)
    제2조제4호 (고영향), 제31조 (투명성), 제32조 (안전성), 제34조 (고영향 사업자 의무)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict


SEVERITY_ORDER = {"blocker": 0, "error": 1, "warning": 2, "info": 3}


@dataclass
class Finding:
    rule: str
    law: str
    article: str
    severity: str            # blocker | error | warning | info
    title: str
    detail: str
    locations: list[str] = field(default_factory=list)
    samples: list[str] = field(default_factory=list)
    remedy: str = ""
    resolution: str | None = None      # 사람만 채운다


# --------------------------------------------------------------------------
# 1. 개인정보 탐지
# --------------------------------------------------------------------------
# 한글 문서는 자간을 벌려 조판하는 일이 잦다 ("허 인 구"). 공백 제거본에서도
# 한 번 더 돌려야 놓치지 않는다.
def _spaced(word: str) -> str:
    """'담당자' → '담\\s*당\\s*자'. 한글 문서는 자간을 벌려 조판하는 일이 잦다
    ('담 당 자 : 허 만 수'). 이걸 견디지 못하면 탐지 자체가 무의미해진다."""
    return r"\s*".join(re.escape(ch) for ch in word)


# 순서가 의미를 가진다. 구체적인 패턴을 먼저 걸러야 덜 구체적인 패턴이
# 같은 문자열을 다른 이름으로 덮어쓰지 않는다.
PII_PATTERNS: dict[str, tuple[str, str, str]] = {
    # key: (정규식, 라벨, 심각도)
    "rrn":        (r"\b\d{6}-[1-4]\d{6}\b", "주민등록번호", "blocker"),
    "card":       (r"\b\d{4}-\d{4}-\d{4}-\d{4}\b", "카드번호", "blocker"),
    "passport":   (r"\b[MSRO]\d{8}\b", "여권번호", "blocker"),
    "corp_no":    (r"\b\d{6}-\d{7}\b", "법인등록번호", "warning"),
    "biz_no":     (r"\b\d{3}-\d{2}-\d{5}\b", "사업자등록번호", "warning"),
    "email":      (r"[\w.+-]+@[\w-]+\.[\w.]{2,}", "이메일 주소", "error"),
    "mobile":     (r"\b01[016789][-\s]\d{3,4}[-\s]\d{4}\b", "휴대전화번호", "error"),
    # 구분자를 필수로 둔다. 맨 숫자 11자리는 전화번호가 아니라 사용량일 확률이 높다.
    "phone":      (r"\(0\d{1,2}\)\s*\d{3,4}[-\s]?\d{4}|\b0\d{1,2}-\d{3,4}-\d{4}\b",
                   "전화번호", "error"),
    # 계좌번호는 맥락 없이는 폐기물 분류코드(51-38-01)와 구별되지 않는다.
    # 앞쪽에 금융 어휘가 있을 때만 인정한다 — 오탐은 준수 도구에서 비싸다.
    "account":    (r"(?:계좌|예금주|은행|입금)[^\n]{0,20}?\b\d{2,3}-\d{2,6}-\d{2,6}\b",
                   "계좌번호", "warning"),
    "address":    (r"(?:[가-힣]+(?:특별시|광역시|특별자치시|도|특별자치도))\s*[가-힣]+시\s*"
                   r"[가-힣]+(?:면|읍|동)\s*[가-힣0-9\-]+로\s*[\d\-]+",
                   "상세주소", "warning"),
}

_ROLES = ("대표자", "대표이사", "담당자", "작성자", "진단수행자", "수행자",
          "검토자", "승인자", "책임자", "연락처", "성명")

# 직위 뒤에 오는 성명. 직위와 성명 **양쪽 모두** 자간 공백을 허용한다.
NAME_ROLE = re.compile(
    r"(" + "|".join(_spaced(r) for r in _ROLES) + r")"
    r"\s*[:：]?\s*((?:[가-힣]\s*){2,4})(?![가-힣])"
)


def detect_pii(text: str) -> list[dict]:
    """개인정보 탐지. 원문과 공백제거본 양쪽에서 돌린다.

    한 문자열이 여러 패턴에 걸리면 **가장 먼저 선언된(=가장 구체적인) 종류로만**
    센다. 사업자등록번호가 계좌번호로도 잡혀 건수가 부풀면 판정이 왜곡된다.
    """
    hits: list[dict] = []
    claimed: set[str] = set()
    squeezed = re.sub(r"[ \t]+", "", text)

    for key, (pat, label, sev) in PII_PATTERNS.items():
        for src in (text, squeezed):
            for m in re.finditer(pat, src):
                val = m.group(0).strip()
                # 공백 제거본에서 나온 같은 값을 두 번 세지 않는다.
                norm = re.sub(r"\s+", "", val)
                if norm in claimed:
                    continue
                claimed.add(norm)
                hits.append({"kind": key, "label": label, "severity": sev, "value": val})

    seen_names: set[str] = set()
    for src in (text, squeezed):
        for m in NAME_ROLE.finditer(src):
            role = re.sub(r"\s+", "", m.group(1))
            name = re.sub(r"\s+", "", m.group(2))
            if len(name) < 2 or name in seen_names:
                continue
            seen_names.add(name)
            hits.append({
                "kind": "name", "label": f"성명({role})",
                "severity": "error", "value": name,
            })
    return hits


def mask_text(text: str) -> tuple[str, int]:
    """비식별 처리. 업로드 전에 반드시 통과해야 하는 게이트.

    값을 지우지 않고 **종류를 남긴 토큰**으로 바꾼다. `[전화번호]` 가 남아 있어야
    "여기에 연락처가 있었다" 는 사실이 검색·감리에서 보존된다.

    성명을 먼저 처리한다. 다른 패턴이 주변 문자열을 먼저 바꿔 버리면
    직위-성명의 인접 관계가 깨져 성명이 살아남는다.
    """
    n = 0

    def _name_sub(m: re.Match) -> str:
        nonlocal n
        n += 1
        role = re.sub(r"\s+", "", m.group(1))
        return role + ": [성명]"

    out = NAME_ROLE.sub(_name_sub, text)

    for key, (pat, label, _sev) in PII_PATTERNS.items():
        out, k = re.subn(pat, f"[{label}]", out)
        n += k

    return out, n


def verify_masking(text: str) -> dict:
    """마스킹이 실제로 통했는지 되짚는다. 게이트를 믿지 않고 검산한다 —
    남은 것이 있으면 업로드를 막아야지, 통과시키면 안 된다."""
    masked, n = mask_text(text)
    residual = detect_pii(masked)
    return {
        "masked_count": n,
        "residual_count": len(residual),
        "residual": [{"label": r["label"], "value": r["value"]} for r in residual[:10]],
        "clean": len(residual) == 0,
        "masked_text": masked,
    }


# --------------------------------------------------------------------------
# 2. 개인정보보호법 검토
# --------------------------------------------------------------------------
def check_privacy(text: str, *, destination: str = "xAI (미국)",
                  masking_enabled: bool = False) -> list[Finding]:
    findings: list[Finding] = []
    hits = detect_pii(text)
    if not hits:
        return findings

    by_kind: dict[str, list[dict]] = {}
    for h in hits:
        by_kind.setdefault(h["label"], []).append(h)

    worst = min((SEVERITY_ORDER[h["severity"]] for h in hits), default=3)
    worst_name = next(k for k, v in SEVERITY_ORDER.items() if v == worst)

    # (1) 국외 이전 — 이 시스템의 구조적 쟁점
    if not masking_enabled:
        findings.append(Finding(
            rule="privacy.cross_border",
            law="개인정보보호법",
            article="제28조의8",
            severity="blocker",
            title=f"개인정보를 포함한 문서를 {destination} 로 업로드 — 국외 이전에 해당",
            detail=(
                f"문서에서 개인정보 {len(hits)}건({', '.join(by_kind)})이 탐지되었습니다. "
                f"이를 {destination} 의 서버로 업로드하면 개인정보의 국외 이전에 해당합니다. "
                "제28조의8은 ① 정보주체의 별도 동의, ② 법률·조약의 특별 규정, "
                "③ 계약의 체결·이행에 필요한 위탁·보관으로서 처리방침 공개 등 "
                "고지 요건 충족, ④ 보호위원회가 인정한 인증, ⑤ 인정 국가·기관 중 "
                "하나를 충족할 것을 요구합니다. 어느 것도 없이 이전하면 "
                "제28조의9에 따른 국외 이전 중지 명령의 대상이 될 수 있습니다."
            ),
            samples=[f"{h['label']}: {h['value']}" for h in hits[:6]],
            remedy=(
                "업로드 전 비식별 게이트를 필수 경로로 둘 것(mask_text). "
                "원문이 필요하면 국내 리전 또는 온프레미스 모델로 라우팅하고, "
                "국외 이전이 불가피하면 처리방침에 이전 항목·국가·수탁자·목적·보유기간을 "
                "명시하고 별도 동의 절차를 갖출 것."
            ),
        ))

    # (2) 최소수집 — 진단 목적에 개인정보가 필요한가
    findings.append(Finding(
        rule="privacy.minimization",
        law="개인정보보호법",
        article="제3조제1항·제16조",
        severity="warning" if masking_enabled else "error",
        title="에너지진단 목적에 불필요한 개인정보가 문서에 포함됨",
        detail=(
            "에너지 사용량 분석과 투자경제성 판단이라는 처리 목적에 비추어 "
            f"성명·연락처·이메일 등은 필요 최소한을 넘습니다. 탐지 항목: {', '.join(by_kind)}. "
            "지식베이스는 원문을 장기 보관하므로 목적 달성 후에도 계속 남습니다."
        ),
        samples=[f"{k} {len(v)}건" for k, v in by_kind.items()],
        remedy="지식베이스 적재 시 개인정보 항목을 토큰으로 치환하고, 원본은 별도 접근통제 영역에 보관.",
    ))

    # (3) 안전조치
    if worst_name == "blocker":
        findings.append(Finding(
            rule="privacy.sensitive",
            law="개인정보보호법",
            article="제23조·제24조",
            severity="blocker",
            title="고유식별정보 또는 민감정보로 분류될 항목 탐지",
            detail="주민등록번호·여권번호·카드번호 등은 원칙적으로 처리가 금지되거나 별도 근거가 필요합니다.",
            samples=[f"{h['label']}: {h['value'][:4]}****" for h in hits
                     if h["severity"] == "blocker"][:5],
            remedy="해당 항목은 적재 전 완전 삭제. 마스킹만으로는 불충분.",
        ))

    findings.append(Finding(
        rule="privacy.safeguards",
        law="개인정보보호법",
        article="제29조",
        severity="info",
        title="안전성 확보조치 점검 필요",
        detail=(
            "개인정보가 포함된 문서를 처리하는 시스템은 접근권한 관리, 접근통제, "
            "암호화, 접속기록 보관(1년 이상), 악성프로그램 방지 조치를 갖춰야 합니다."
        ),
        remedy="컬렉션 단위 접근권한, 업로드·검색 이력 로깅, 저장 시 암호화 여부를 점검할 것.",
    ))

    return findings


# --------------------------------------------------------------------------
# 3. 인공지능 기본법 검토
# --------------------------------------------------------------------------
# 제2조제4호 고영향 인공지능 영역 (법이 열거한 분야)
HIGH_IMPACT_DOMAINS = (
    "보건의료", "에너지 공급", "수도 공급", "원자력", "생체인식",
    "채용·평가", "대출 심사", "교통수단 운영", "공공서비스 결정", "수사·기소",
)


def check_ai_act(*, uses_generative_ai: bool = True,
                 output_is_advisory: bool = True,
                 has_output_labeling: bool = False,
                 has_prior_notice: bool = False,
                 has_human_oversight: bool = True,
                 sector: str = "other") -> list[Finding]:
    """AI기본법 점검.

    고영향 해당 여부는 **판정하지 않는다.** 법 제2조제4호의 열거 영역 해당성은
    정성 판단이라, 룰이 답할 수 있는 질문이 아니다. 대신 판단에 필요한 사실을
    모아 사람에게 넘긴다 — 규제 지식그래프의 '판단 유보'와 같은 처리다.
    """
    findings: list[Finding] = []

    if uses_generative_ai and not has_output_labeling:
        findings.append(Finding(
            rule="ai.transparency.labeling",
            law="인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
            article="제31조제2항",
            severity="error",
            title="생성형 AI 산출물에 표시가 없음",
            detail=(
                "생성형 인공지능으로 만든 결과물에는 그 사실을 표시해야 합니다. "
                "본 시스템은 검색 결과를 근거로 분석 서술을 생성하므로 대상에 해당합니다. "
                "생성된 분석 보고서·요약·답변 모두에 표시가 필요합니다."
            ),
            remedy="답변·산출물 하단에 생성 사실, 사용 모델, 생성 시각을 고정 표기. "
                   "파일 산출물은 메타데이터에도 기록.",
        ))

    if uses_generative_ai and not has_prior_notice:
        findings.append(Finding(
            rule="ai.transparency.notice",
            law="인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
            article="제31조제1항",
            severity="error",
            title="생성형 AI 기반 서비스라는 사전 고지가 없음",
            detail=(
                "이용자에게 해당 서비스가 인공지능 기반이라는 사실을 미리 알려야 합니다. "
                "위반 시 과태료 부과 대상입니다(제43조)."
            ),
            remedy="첫 진입 화면과 검색 결과 화면에 상시 고지 문구 노출.",
        ))

    if not has_human_oversight:
        findings.append(Finding(
            rule="ai.human_oversight",
            law="인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
            article="제34조",
            severity="error",
            title="사람에 의한 감독 장치가 없음",
            detail="고영향 인공지능에 해당할 경우 위험관리·설명방안·이용자보호·인적 감독 및 "
                   "관련 문서 보관(5년) 의무가 부과됩니다.",
            remedy="분석 결과 확정 단계에 자격자 서명 절차를 두고, 서명 이력을 보관.",
        ))

    findings.append(Finding(
        rule="ai.high_impact.review",
        law="인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
        article="제2조제4호·제34조",
        severity="info",
        title="고영향 인공지능 해당 여부 — 판단 유보 (사람 확인 필요)",
        detail=(
            "법이 열거한 고영향 영역: " + ", ".join(HIGH_IMPACT_DOMAINS) + ". "
            "본 시스템은 에너지 사용 분석과 투자 판단 근거를 제공하지만, "
            f"산출물은 {'권고·참고' if output_is_advisory else '자동 결정'} 성격이고 "
            "최종 판단은 자격자가 합니다. '에너지 공급' 영역 해당성은 정성 판단이므로 "
            "룰이 확정하지 않습니다."
        ),
        remedy="법무 검토로 해당 여부를 확정하고 결과를 이 항목의 resolution 에 기록할 것.",
    ))

    findings.append(Finding(
        rule="ai.safety.threshold",
        law="인공지능 발전과 신뢰 기반 조성 등에 관한 기본법",
        article="제32조",
        severity="info",
        title="안전성 확보 의무 — 비해당 추정",
        detail=(
            "제32조의 안전성 확보 의무는 누적 연산량 임계값 등 요건을 모두 충족하는 "
            "대규모 시스템에 적용됩니다. 본 시스템은 외부 모델을 호출하는 응용 서비스라 "
            "직접 대상은 아닌 것으로 보입니다. 다만 모델 제공자의 준수 여부는 별개입니다."
        ),
        remedy="모델 제공자 변경 시 재검토.",
    ))

    return findings


# --------------------------------------------------------------------------
# 4. 통합 리포트
# --------------------------------------------------------------------------
def review(text: str, *, sector: str = "other", destination: str = "xAI (미국)",
           masking_enabled: bool = False, **ai_kwargs) -> dict:
    findings = check_privacy(text, destination=destination, masking_enabled=masking_enabled)
    findings += check_ai_act(sector=sector, **ai_kwargs)
    findings.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 9))

    counts: dict[str, int] = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1

    blockers = counts.get("blocker", 0)
    return {
        "verdict": "차단" if blockers else ("조건부 적재" if counts.get("error") else "적재 가능"),
        "upload_allowed": blockers == 0,
        "counts": counts,
        "pii_detected": len(detect_pii(text)),
        "masking_enabled": masking_enabled,
        "findings": [asdict(f) for f in findings],
        "note": (
            "이 검토는 결정론적 규칙의 결과이며 법률 자문이 아닙니다. "
            "최종 판단과 책임은 담당자에게 있습니다."
        ),
    }
