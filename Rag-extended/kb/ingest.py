"""업종별 지식베이스 적재 — 분류 → 규제 게이트 → 컬렉션 라우팅.

파이프라인은 한 방향이고, **게이트를 건너뛰는 경로가 없다.**

    PDF ─▶ 4채널 파싱 ─▶ 업종 분류 ─▶ 필수지표 커버리지
                                      │
                                      ▼
                             규제 준수 검토 (개인정보/AI기본법)
                                      │
                        blocker 있으면 ─┴─▶ 중단. 업로드 안 함
                                      │
                                      ▼
                             비식별 처리 + 마스킹 검산
                                      │
                                      ▼
                      업종 컬렉션(ediag__waste 등)에 채널별 적재
                                      │
                                      ▼
                                온톨로지 그래프

`upload_allowed=False` 인데 올릴 수 있는 인자는 만들지 않았다. 우회로를 만들면
언젠가 그 경로로 나간다.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any

from . import parse, classify, compliance, ontology, taxonomy


@dataclass
class IngestResult:
    filename: str
    doc_hash: str
    sector: str
    sector_name: str
    needs_review: bool
    collection_name: str
    # 원문 그대로 올려도 되는가 (거의 항상 False — 진단서에는 담당자 연락처가 있다)
    upload_allowed_raw: bool = False
    # 비식별 처리를 거치면 올려도 되는가 (실제 적재 경로의 판단 기준)
    upload_allowed: bool = False
    uploaded: int = 0
    channels: dict[str, int] = field(default_factory=dict)
    parse_summary: dict = field(default_factory=dict)
    classification: dict = field(default_factory=dict)
    coverage: dict = field(default_factory=dict)
    compliance: dict = field(default_factory=dict)
    masking: dict = field(default_factory=dict)
    graph_stats: dict = field(default_factory=dict)
    excel_path: str | None = None
    graph: dict | None = None
    # 4채널 청크. 적재 경로가 다시 파싱하지 않도록 분석 결과에 실어 보낸다
    # (32면 PDF 를 두 번 파싱하면 응답이 두 배로 느려진다). 응답 JSON 에는 넣지 않는다.
    chunks: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k not in ("graph", "chunks")}
        d["has_graph"] = self.graph is not None
        # 화면의 채널 카드(글/표/그림/엑셀) 숫자를 눌렀을 때 근거를 보여주려면
        # 개수뿐 아니라 항목 자체가 필요하다. chunks 원본은 78면 문서 기준 수백 KB라
        # 그대로 실으면 응답이 무거워지므로, 본문을 잘라낸 미리보기만 싣는다.
        d["channel_items"] = _channel_preview(self.chunks)
        return d


# 채널별 미리보기 상한 — 화면에서 확인하기에 충분하되 응답이 붓지 않는 선.
_PREVIEW_MAX_ITEMS = 200
_PREVIEW_MAX_CHARS = 800


def _channel_preview(chunks: list[dict]) -> dict:
    """4채널 청크를 화면 표시용으로 요약한다. 잘라낸 항목은 truncated=True 로 표시."""
    out: dict[str, list[dict]] = {"text": [], "table": [], "image": []}
    for c in chunks:
        ch = c.get("channel")
        if ch not in out or len(out[ch]) >= _PREVIEW_MAX_ITEMS:
            continue
        body = c.get("content", "") or ""
        out[ch].append({
            "page":      c.get("page"),
            "anchor":    c.get("anchor"),        # p12/tbl3 — 원문 위치
            "numeric":   c.get("n_numeric_cells"),   # 표 채널: 숫자셀 수
            "chars":     len(body),
            "preview":   body[:_PREVIEW_MAX_CHARS],
            "truncated": len(body) > _PREVIEW_MAX_CHARS,
        })
    # '엑셀' 카드는 표 채널을 시트 단위로 다시 센 것이라 표와 같은 항목을 가리킨다.
    out["excel"] = out["table"]
    return out


# 마스킹으로 해소되지 **않는** 위반. 값을 토큰으로 바꾸는 것만으로는
# 처리 근거가 생기지 않는 항목들이라, 여기 걸리면 마스킹해도 적재 불가다.
UNMASKABLE_RULES = frozenset({"privacy.sensitive"})


def _allowed_after_masking(comp: dict, masking: dict) -> bool:
    if not masking.get("clean"):
        return False
    for f in comp.get("findings", []):
        if f["rule"] in UNMASKABLE_RULES:
            return False
    return True


def analyze(
    pdf_path: str,
    *,
    sector_override: str | None = None,
    destination: str = "xAI (미국)",
    build_excel: bool = True,
    out_dir: str | None = None,
    diagnosis_id: str | None = None,
    has_output_labeling: bool = False,
    has_prior_notice: bool = False,
) -> IngestResult:
    """업로드 없이 분석만 한다. 프론트엔드의 '검토' 단계가 이걸 부른다.

    사람이 결과를 보고 업종을 확정한 뒤에야 적재로 넘어간다 —
    잘못 분류된 문서는 영영 엉뚱한 컬렉션에서 검색된다.
    """
    doc = parse.parse_pdf(pdf_path)

    if sector_override:
        cls = classify.Classification(
            sector=sector_override, confidence=1.0, needs_review=False,
            method="manual", reason="사람이 직접 지정",
        )
    else:
        cls = classify.classify_document(doc)

    cov = classify.metric_coverage(doc, cls.sector)

    full = doc.full_text + "\n" + "\n".join(
        " ".join(r) for t in doc.tables for r in t.rows
    )
    masking = compliance.verify_masking(full)
    comp = compliance.review(
        full, sector=cls.sector, destination=destination, masking_enabled=False,
        has_output_labeling=has_output_labeling, has_prior_notice=has_prior_notice,
    )

    graph = ontology.build_graph(doc, cls, cov, comp, diagnosis_id=diagnosis_id)

    res = IngestResult(
        filename=doc.filename,
        doc_hash=doc.doc_hash,
        sector=cls.sector,
        sector_name=taxonomy.get(cls.sector).name,
        needs_review=cls.needs_review,
        collection_name=taxonomy.collection_name(cls.sector),
        # 원문 적재 가부와 마스킹 후 적재 가부를 나눠서 보고한다.
        # 하나로 합치면 "차단인데 업로드 허용" 같은 모순된 표시가 나온다.
        upload_allowed_raw=comp["upload_allowed"],
        upload_allowed=_allowed_after_masking(comp, masking),
        parse_summary=doc.summary(),
        classification=cls.to_dict(),
        coverage=cov,
        compliance=comp,
        masking={k: v for k, v in masking.items() if k != "masked_text"},
        graph_stats=graph["stats"],
        graph=graph,
    )

    if build_excel:
        out_dir = out_dir or os.path.dirname(os.path.abspath(pdf_path))
        os.makedirs(out_dir, exist_ok=True)
        xlsx = os.path.join(out_dir, f"{doc.doc_hash}_tables.xlsx")
        try:
            res.excel_path = parse.to_excel(doc, xlsx)
        except Exception as e:
            res.errors.append(f"엑셀 생성 실패: {e}")

    chunks = parse.to_chunks(doc)
    res.chunks = chunks
    res.channels = {
        ch: sum(1 for c in chunks if c["channel"] == ch)
        for ch in ("text", "table", "image")
    }
    return res


# --------------------------------------------------------------------------
# 적재 — xAI Collections
# --------------------------------------------------------------------------
async def ingest(
    pdf_path: str,
    *,
    mgmt_client,
    ensure_collection,          # async (name) -> collection_id  (호출 측이 주입)
    sector_override: str | None = None,
    mask: bool = True,
    force: bool = False,
    **analyze_kwargs,
) -> IngestResult:
    """분석 후 업종 컬렉션에 적재한다.

    `mask=False` 이고 개인정보가 있으면 **적재하지 않는다**. `force` 는
    개인정보가 없을 때의 경고(warning)만 넘길 수 있고, blocker 는 못 넘긴다.
    """
    res = analyze(pdf_path, sector_override=sector_override, **analyze_kwargs)

    blockers = res.compliance["counts"].get("blocker", 0)
    if blockers and not mask:
        res.errors.append(
            "개인정보가 포함되어 있고 마스킹이 꺼져 있습니다. "
            "국외 이전에 해당하므로 적재를 중단합니다 (개인정보보호법 제28조의8)."
        )
        res.upload_allowed = False
        return res

    if res.needs_review and not force and not sector_override:
        res.errors.append(
            f"업종 분류가 확정되지 않았습니다({res.classification.get('reason','')}). "
            "사람이 업종을 지정한 뒤 적재하십시오."
        )
        res.upload_allowed = False
        return res

    doc = parse.parse_pdf(pdf_path)
    chunks = parse.to_chunks(doc)

    if mask:
        cleaned = []
        for c in chunks:
            masked, _ = compliance.mask_text(c["content"])
            cleaned.append({**c, "content": masked})
        chunks = cleaned
        residual = sum(len(compliance.detect_pii(c["content"])) for c in chunks)
        if residual:
            res.errors.append(f"마스킹 후에도 개인정보 {residual}건이 남아 적재를 중단합니다.")
            res.upload_allowed = False
            return res

    collection_id = await ensure_collection(res.collection_name)

    # 채널별로 문서를 나눠 올린다. 검색 시 channel 로 필터할 수 있게 된다.
    uploaded = 0
    for channel in ("text", "table", "image"):
        part = [c for c in chunks if c["channel"] == channel]
        if not part:
            continue
        body = "\n\n".join(
            f"### {c['anchor']} (p.{c['page']})\n{c['content']}" for c in part
        )
        name = f"{res.doc_hash}__{res.sector}__{channel}.txt"
        metadata = {
            "category": res.sector,                 # 업종 = 필터 축
            "sector": res.sector,
            "sector_name": res.sector_name,
            "channel": channel,
            "doc_hash": res.doc_hash,
            "source_file": res.filename,
            "masked": mask,
            "ontology": ontology.ONTOLOGY_VERSION,
        }
        try:
            await mgmt_client.collections.upload_document(
                collection_id=collection_id,
                name=name,
                data=body.encode("utf-8"),
                content_type="text/plain",
                metadata=metadata,
            )
            uploaded += 1
        except Exception as e:
            res.errors.append(f"{channel} 채널 업로드 실패: {e}")

    res.uploaded = uploaded
    return res


def ingest_sync(pdf_path: str, **kw) -> IngestResult:
    return asyncio.get_event_loop().run_until_complete(ingest(pdf_path, **kw))
