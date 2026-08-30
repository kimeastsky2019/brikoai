"""지식 데이터베이스 구축 API — /kb/*

기존 app.py 에 최소 침습으로 붙인다. `app.include_router(kb_router)` 한 줄이면 된다.
인증·DB·xAI 클라이언트는 호출 측이 의존성으로 주입한다.
"""

from __future__ import annotations

import os
import tempfile
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from config import LLMWIKI_BASE_URL, LLMWIKI_PUBLIC_URL, LLMWIKI_TIMEOUT_SEC

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


# --------------------------------------------------------------------------
# LLM Wiki 연동 — 분석한 진단보고서를 위키(work.ets0404.com) 표준 문서로 저장
# --------------------------------------------------------------------------
@router.get("/wiki/status")
async def kb_wiki_status():
    """'위키에 저장' 버튼을 띄울지 화면이 판단할 근거."""
    if not LLMWIKI_BASE_URL:
        return {"enabled": False, "reason": "LLMWIKI_BASE_URL 미설정"}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{LLMWIKI_BASE_URL.rstrip('/')}/api/wiki/health")
            r.raise_for_status()
            h = r.json()
        return {
            "enabled":    True,
            "public_url": LLMWIKI_PUBLIC_URL,
            "contract":   h.get("contract"),
            "pages":      (h.get("store") or {}).get("pages"),
        }
    except Exception as e:
        return {"enabled": False, "reason": f"위키에 연결할 수 없습니다: {e}"}


@router.post("/wiki/save")
async def kb_wiki_save(
    file: UploadFile = File(...),
    # Form(...) 로 두면 값이 비었을 때 FastAPI 가 먼저 422 를 내보내, 아래의
    # "사업장명을 입력하세요" 안내가 화면에 닿지 않는다. 기본값을 주고 직접 검증한다.
    site: str = Form(""),
    sector: str | None = Form(None),
    owner: str = Form(""),
):
    """원본 PDF 를 LLM Wiki 의 /api/wiki/ingest 로 넘겨 표준 문서로 저장한다.

    브라우저가 위키를 직접 부르지 않고 여기서 중계한다 — 위키는 nginx basic auth
    뒤에 있고 교차 출처라, 직접 부르면 인증창이 뜨고 CORS 도 열어야 한다.
    루프백으로 부르면 둘 다 피하면서 자격증명이 브라우저에 남지 않는다.

    `site`(사업장 키)는 필수다. 이 값이 바뀌면 위키의 모든 stable_id 가 바뀌므로
    위키 쪽 설계가 사람의 확정을 요구한다 — 여기서 임의로 채우지 않는다.
    """
    if not LLMWIKI_BASE_URL:
        raise HTTPException(503, "위키 연동이 설정되지 않았습니다 (LLMWIKI_BASE_URL).")
    site = (site or "").strip()
    if not site:
        raise HTTPException(400, "사업장명을 입력하세요 — 위키 문서 식별자의 기준이 됩니다.")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"PDF 만 지원합니다 (받은 확장자: {ext or '없음'})")
    content = await file.read()
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(413, f"파일이 너무 큽니다 ({len(content) // 1048576}MB > 50MB)")

    data = {"site": site, "owner": owner or ""}
    if sector:
        data["sector"] = sector

    try:
        async with httpx.AsyncClient(timeout=LLMWIKI_TIMEOUT_SEC) as c:
            r = await c.post(
                f"{LLMWIKI_BASE_URL.rstrip('/')}/api/wiki/ingest",
                files={"file": (file.filename, content, "application/pdf")},
                data=data,
            )
    except httpx.TimeoutException:
        raise HTTPException(504, "위키 적재가 시간 내에 끝나지 않았습니다. 위키에서 진행 상태를 확인하세요.")
    except Exception as e:
        raise HTTPException(502, f"위키에 연결하지 못했습니다: {e}")

    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"위키가 거절했습니다: {r.text[:300]}")

    out = r.json()
    # 화면이 바로 쓸 수 있게 요약만 추려 준다 (analysis 전문은 이미 화면에 있다).
    # 다만 게이트가 막았을 때는 '무엇 때문에 막혔는지' 가 없으면 사용자가 손쓸 수가
    # 없다. 비식별 검산의 잔존 항목과 규제 위반 목록은 반드시 실어 보낸다.
    wa = out.get("analysis") or {}
    masking = wa.get("masking") or {}
    compliance = wa.get("compliance") or {}
    return {
        "stored":     out.get("stored", False),
        "skipped":    out.get("skipped"),
        "pages":      out.get("pages", []),
        "records":    out.get("records"),
        "channels":   out.get("channels"),
        "lint":       out.get("lint"),
        "warnings":   out.get("warnings", []),
        "checks_failed": out.get("checks_failed", []),
        "gate": {
            "allowed":        out.get("gate_allowed"),
            "allowed_raw":    wa.get("upload_allowed_raw"),
            "masked_count":   masking.get("masked_count"),
            "residual_count": masking.get("residual_count"),
            "residual":       masking.get("residual", [])[:10],
            "findings":       (compliance.get("findings") or [])[:10],
        },
        "public_url": LLMWIKI_PUBLIC_URL,
    }


# --------------------------------------------------------------------------
# 현장 체크리스트 — 위키의 /api/audit/* 를 그대로 중계한다.
#
# 항목은 위키에 쌓인 개선안(measure) 카드에서 나온다. 화면이 목록을 직접 들고
# 있으면 진단이 쌓여도 점검표가 늘지 않는다 — 실제로 그렇게 하드코딩돼 있었다.
# 위키를 브라우저가 직접 부르지 못하는 이유는 /kb/wiki/* 와 같다 (basic auth · CORS).
# --------------------------------------------------------------------------
def _wiki_url(path: str) -> str:
    if not LLMWIKI_BASE_URL:
        raise HTTPException(503, "위키 연동이 설정되지 않았습니다 (LLMWIKI_BASE_URL).")
    return f"{LLMWIKI_BASE_URL.rstrip('/')}{path}"


async def _wiki_call(method: str, path: str, **kw):
    """위키로의 중계 호출. 실패 사유를 그대로 화면에 전달한다."""
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.request(method, _wiki_url(path), **kw)
    except httpx.TimeoutException:
        raise HTTPException(504, "위키가 시간 내에 응답하지 않았습니다.")
    except Exception as e:
        raise HTTPException(502, f"위키에 연결하지 못했습니다: {e}")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"위키가 거절했습니다: {r.text[:300]}")
    return r.json()


@router.get("/audit/checklist/draft")
async def kb_checklist_draft(sector: str, lang: str = "ko"):
    """업종을 고르면 위키의 개선안 카드로 설비별 초안을 만든다. 저장하지 않는다."""
    return await _wiki_call(
        "GET", "/api/audit/checklist/draft", params={"sector": sector, "lang": lang}
    )


@router.get("/audit/checklists")
async def kb_checklists():
    return await _wiki_call("GET", "/api/audit/checklists")


@router.get("/audit/checklists/{cid}")
async def kb_checklist(cid: str):
    return await _wiki_call("GET", f"/api/audit/checklists/{quote(cid, safe='')}")


@router.post("/audit/checklists")
async def kb_save_checklist(payload: dict = Body(...)):
    """저장은 위키가 한다 — 팀 전체가 같은 목록을 본다."""
    if not str(payload.get("title") or "").strip():
        raise HTTPException(400, "제목을 입력하세요.")
    return await _wiki_call("POST", "/api/audit/checklists", json=payload)


@router.delete("/audit/checklists/{cid}")
async def kb_delete_checklist(cid: str):
    return await _wiki_call("DELETE", f"/api/audit/checklists/{quote(cid, safe='')}")
