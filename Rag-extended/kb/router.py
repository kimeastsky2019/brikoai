"""지식 데이터베이스 구축 API — /kb/*

기존 app.py 에 최소 침습으로 붙인다. `app.include_router(kb_router)` 한 줄이면 된다.
인증·DB·xAI 클라이언트는 호출 측이 의존성으로 주입한다.
"""

from __future__ import annotations

import os
import tempfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from . import taxonomy, compliance, ingest as kb_ingest, ontology

router = APIRouter(prefix="/kb", tags=["knowledge-base"])

MAX_PDF_BYTES = 50 * 1024 * 1024
ALLOWED = {".pdf"}


# --------------------------------------------------------------------------
class SectorOut(BaseModel):
    code: str
    name: str
    ksic: str
    unit_basis: str


@router.get("/sectors")
async def list_sectors():
    """업종 닫힌 집합. 프론트엔드 드롭다운의 유일한 출처."""
    return {"sectors": taxonomy.as_dict(), "count": len(taxonomy.SECTOR_CODES)}


@router.get("/sectors/{code}")
async def get_sector(code: str):
    try:
        p = taxonomy.get(code)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "code": p.code, "name": p.name, "ksic": p.ksic,
        "unit_basis": p.unit_basis, "notes": p.notes,
        "energy_sources": list(p.energy_sources),
        "key_equipment": list(p.key_equipment),
        "required_metrics": [
            {"code": m, "label": taxonomy.METRIC_LABELS.get(m, m)}
            for m in p.required_metrics
        ],
        "collection_name": taxonomy.collection_name(p.code),
    }


# --------------------------------------------------------------------------
class ComplianceRequest(BaseModel):
    text: str
    sector: str = "other"
    destination: str = "xAI (미국)"
    masking_enabled: bool = False
    has_output_labeling: bool = False
    has_prior_notice: bool = False


@router.post("/compliance/review")
async def compliance_review(req: ComplianceRequest):
    """텍스트에 대한 규제 준수 검토. 규칙 기반이라 LLM 호출이 없다."""
    return compliance.review(
        req.text, sector=req.sector, destination=req.destination,
        masking_enabled=req.masking_enabled,
        has_output_labeling=req.has_output_labeling,
        has_prior_notice=req.has_prior_notice,
    )


class MaskRequest(BaseModel):
    text: str


@router.post("/compliance/mask")
async def compliance_mask(req: MaskRequest):
    """비식별 처리 + 검산. 마스킹 후 잔존 항목이 있으면 clean=false 로 알린다."""
    return compliance.verify_masking(req.text)


# --------------------------------------------------------------------------
def _save_upload(file: UploadFile, content: bytes) -> str:
    ext = os.path.splitext((file.filename or "").lower())[1]
    if ext not in ALLOWED:
        raise HTTPException(400, f"PDF만 지원합니다. 받은 확장자: {ext or '없음'}")
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(400, f"파일이 너무 큽니다 (최대 {MAX_PDF_BYTES // 1024 // 1024}MB)")
    if not content:
        raise HTTPException(400, "빈 파일입니다.")
    fd, path = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(content)
    return path


@router.post("/analyze")
async def kb_analyze(
    file: UploadFile = File(...),
    sector: str | None = Form(None),
    build_excel: bool = Form(True),
):
    """문서 1건을 4채널로 분해하고 업종 분류 · 규제 검토 · 온톨로지까지 만든다.

    **업로드는 하지 않는다.** 사람이 결과를 확인하고 업종을 확정한 뒤
    `/kb/ingest` 로 넘어간다.
    """
    content = await file.read()
    path = _save_upload(file, content)
    try:
        if sector:
            try:
                taxonomy.get(sector)
            except KeyError as e:
                raise HTTPException(400, str(e))
        res = kb_ingest.analyze(
            path, sector_override=sector, build_excel=build_excel,
            out_dir=tempfile.gettempdir(),
        )
        out = res.to_dict()
        out["graph"] = res.graph
        return out
    finally:
        os.unlink(path)


@router.post("/ingest")
async def kb_ingest_endpoint(
    file: UploadFile = File(...),
    sector: str | None = Form(None),
    mask: bool = Form(True),
):
    """분석 → 규제 게이트 → 업종 컬렉션 적재.

    게이트를 우회하는 인자는 없다. `upload_allowed` 가 False 면 분석 결과만
    돌려주고 적재하지 않는다. 마스킹을 끄고(mask=False) 개인정보가 남아 있으면
    게이트가 막으므로, 결국 비식별 처리를 거친 것만 들어간다.

    적재 대상은 Qdrant 다. 이 앱은 Grok Collections 에서 Qdrant 로 이전했으므로
    `kb/ingest.ingest()` 의 Collections 경로 대신 `kb/store_qdrant.py` 를 쓴다.
    """
    content = await file.read()
    path = _save_upload(file, content)
    try:
        if sector:
            try:
                taxonomy.get(sector)
            except KeyError as e:
                raise HTTPException(400, str(e))
        res = kb_ingest.analyze(
            path, sector_override=sector, build_excel=False,
            out_dir=tempfile.gettempdir(),
        )
        out = res.to_dict()

        if res.needs_review:
            out["stored"] = {
                "uploaded": 0, "collection": None,
                "skipped": "업종 분류가 확정되지 않았습니다 — 업종을 지정해 다시 시도하세요",
            }
            return out

        try:
            from . import store_qdrant
            out["stored"] = store_qdrant.upload(res, res.chunks, mask=mask)
        except Exception as e:      # 적재 실패가 분석 결과까지 버리게 하지 않는다
            out["stored"] = {"uploaded": 0, "collection": None, "error": str(e)}
        return out
    finally:
        os.unlink(path)


@router.post("/graph/ttl")
async def graph_to_ttl(graph: dict):
    """온톨로지 그래프를 TTL 로. Fuseki 적재/SPARQL 질의로 이어진다."""
    if "nodes" not in graph:
        raise HTTPException(400, "nodes 가 없는 그래프입니다.")
    return {"ttl": ontology.to_turtle(graph), "lines": len(ontology.to_turtle(graph).splitlines())}


@router.get("/health")
async def kb_health():
    return {
        "status": "ok",
        "ontology": ontology.ONTOLOGY_VERSION,
        "sectors": len(taxonomy.SECTOR_CODES),
        "channels": ["text", "table", "image", "excel"],
    }
