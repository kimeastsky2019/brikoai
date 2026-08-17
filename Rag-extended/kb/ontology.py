"""4채널 파싱 결과 → 온톨로지 그래프.

LLMWiki 온톨로지 v1.0 의 `--graph` 내보내기와 **같은 JSON 형식**을 낸다.
노드/엣지 목록이라 Neo4j·Memgraph 적재, RDF 변환, Fuseki 업로드가 모두
이 하나에서 출발한다.

원칙 (에너지진단 온톨로지 v0.1):
  - ID 는 **의미 기반**. 페이지·좌표를 ID 에 넣지 않는다. 파서를 고치면
    좌표가 밀려 그래프가 통째로 끊기기 때문이다.
  - 모든 사실에 `derivation` 이 붙는다: measured / documented / assumed / computed
  - 문서에서 온 값은 **반드시 EvidenceSpan 을 갖는다** (근거 없는 사실 금지)
"""

from __future__ import annotations

import re
from typing import Any

from . import taxonomy

ONTOLOGY_VERSION = "0.1.0"

NUM = re.compile(r"-?\d[\d,]*\.?\d*")

# 단위 목록. 긴 것부터 두어야 'kWh/y' 가 'kWh' 로 잘리지 않는다.
_UNITS = (
    "kWh/y", "kWh", "kW", "toe/MWh", "tCO2eq/MWh", "tCO₂eq/MWh", "tCO2eq", "tCO₂eq",
    "toe", "MWh", "t/h", "kg/h", "㎥/min", "원/kWh", "원/kg", "천원", "원",
    "h/y", "h/d", "mmAq", "kg/㎠", "kcal/kg", "톤/일", "t/일", "㎡", "%", "대", "년",
)

# **숫자에 붙어 있는** 단위만 인정한다. 단위를 셀 전체에서 따로 찾으면
# '남원시'의 '원'을 화폐 단위로, '2015년 9월'의 '년'을 기간으로 읽는다.
# 단위 뒤에 한글이 이어지면(원형/대수/년도) 단위가 아니다.
QTY = re.compile(
    r"(-?\d[\d,]*\.?\d*)\s*[\(\[]?\s*(" + "|".join(re.escape(u) for u in _UNITS) + r")"
    r"(?![가-힣A-Za-z0-9])"
)

# 단위 → 차원. 차원이 있어야 수식 양변 검산이 가능하다.
DIMENSION: dict[str, str] = {
    "kW": "power", "kWh": "energy", "kWh/y": "energy", "MWh": "energy",
    "toe": "energy_toe", "tCO2eq": "ghg", "tCO₂eq": "ghg",
    "kg": "fuel_mass", "kg/h": "fuel_rate", "t/h": "steam_flow",
    "원": "cost", "천원": "cost", "원/kWh": "price", "원/kg": "price",
    "h/y": "time", "h/d": "time", "%": "ratio", "대": "count",
    "㎡": "area", "톤/일": "capacity", "t/일": "capacity",
    "㎥/min": "flow", "mmAq": "pressure", "kg/㎠": "pressure",
    "kcal/kg": "heating_value", "toe/MWh": "factor",
    "tCO2eq/MWh": "factor", "tCO₂eq/MWh": "factor",
    # 연도는 양이 아니라 식별자에 가깝다. 차원을 따로 두어 에너지 집계에서 배제한다.
    "년": "year",
}

# 에너지·비용 검산 대상에서 제외할 차원
NON_QUANTITY_DIMENSIONS = frozenset({"year", "unknown"})


def _slug(s: str, maxlen: int = 40) -> str:
    s = re.sub(r"\s+", "_", (s or "").strip())
    s = re.sub(r"[^\w가-힣._-]", "", s)
    return (s or "unnamed")[:maxlen]


def _num(s: str) -> float | None:
    m = NUM.search((s or "").replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _parse_quantity(cell: str, header: str = "") -> tuple[float, str] | None:
    """셀에서 (값, 단위)를 뽑는다. 단위가 숫자에 붙어 있어야 인정한다.

    셀에 단위가 없으면 헤더의 단위를 빌려 쓴다 — `용량(kW)` 헤더 아래
    `22` 같은 표기가 실제 진단서에서 가장 흔한 형태다. 다만 이때도
    셀은 순수한 숫자여야 한다.
    """
    if not cell:
        return None
    m = QTY.search(cell)
    if m:
        try:
            return float(m.group(1).replace(",", "")), m.group(2)
        except ValueError:
            return None

    bare = cell.strip().replace(" ", "")
    if not re.fullmatch(r"-?\d[\d,]*\.?\d*", bare):
        return None
    hm = re.search(r"[\(\[]\s*(" + "|".join(re.escape(u) for u in _UNITS) + r")\s*[\)\]]",
                   header or "")
    if not hm:
        return None
    try:
        return float(bare.replace(",", "")), hm.group(1)
    except ValueError:
        return None


def build_graph(doc, classification, coverage: dict,
                compliance_report: dict | None = None,
                *, diagnosis_id: str | None = None) -> dict:
    """ParsedDocument 를 온톨로지 그래프로."""
    did = diagnosis_id or _slug(doc.filename.rsplit(".", 1)[0], 24) or doc.doc_hash
    sector = classification.sector
    prof = taxonomy.get(sector)

    nodes: list[dict] = []
    edges: list[dict] = []

    def add_node(**kw):
        nodes.append(kw)

    def add_edge(type_: str, source: str, target: str, **kw):
        edges.append({"type": type_, "source": source, "target": target, **kw})

    # --- Diagnosis (뿌리) ------------------------------------------------
    dgn = f"dgn:{did}"
    add_node(id=dgn, type="Diagnosis", derivation="documented",
             name=doc.filename, doc_hash=doc.doc_hash, pages=doc.n_pages,
             sector=sector, sector_name=prof.name, unit_basis=prof.unit_basis,
             sector_confidence=round(classification.confidence, 3),
             sector_needs_review=classification.needs_review)

    # --- Sector ----------------------------------------------------------
    sec = f"sec:{sector}"
    add_node(id=sec, type="Sector", derivation="documented",
             name=prof.name, ksic=prof.ksic, unit_basis=prof.unit_basis)
    add_edge("classifiedAs", dgn, sec,
             derivation="computed", method=classification.method,
             confidence=round(classification.confidence, 3))

    # --- EvidenceSpan + Quantity (표에서) ---------------------------------
    # 표 셀 하나하나가 후보지만, 값+단위가 함께 읽히는 셀만 승격한다.
    # 근거가 약한 것을 그래프에 올리면 아래 모든 검산이 오염된다.
    qcount = 0
    for t in doc.tables:
        span_id = f"span:{did}/p{t.page}/tbl{t.idx}"
        add_node(id=span_id, type="EvidenceSpan", derivation="documented",
                 page=t.page, table_idx=t.idx, caption=t.caption,
                 shape=list(t.shape))
        add_edge("evidencedBy", dgn, span_id, derivation="documented")

        for ri, row in enumerate(t.rows):
            label = next((c for c in row if c and not _num(c)), "")
            for ci, cell in enumerate(row):
                if not cell:
                    continue
                head = t.header[ci] if ci < len(t.header) else ""
                parsed = _parse_quantity(cell, head)
                if parsed is None:
                    continue                     # 단위 없는 숫자는 올리지 않는다
                val, unit = parsed
                metric = _slug(f"{label}.{head or ci}", 48)
                qid = f"qty:{did}/{_slug(str(t.page))}_{t.idx}/{metric}_{ri}{ci}"
                add_node(id=qid, type="Quantity", derivation="documented",
                         value=val, unit=unit,
                         dimension=DIMENSION.get(unit, "unknown"),
                         label=label or None, raw=cell,
                         page=t.page, cell=f"r{ri}c{ci}")
                add_edge("evidencedBy", qid, span_id, derivation="documented")
                add_edge("belongsTo", qid, dgn, derivation="documented")
                qcount += 1

    # --- Equipment (업종 프로파일의 주요 설비군을 문서에서 찾는다) -----------
    haystack = doc.full_text + "\n".join(
        " ".join(r) for t in doc.tables for r in t.rows
    )
    for eq in prof.key_equipment:
        n = len(re.findall(re.escape(eq), haystack))
        if not n:
            continue
        eid = f"eq:{did}/{_slug(eq, 20)}"
        add_node(id=eid, type="Equipment", derivation="documented",
                 name=eq, mentions=n, sector=sector)
        add_edge("installedAt", eid, dgn, derivation="documented")

    # --- 필수지표 커버리지 → Finding --------------------------------------
    for m in coverage.get("missing", []):
        fid = f"fnd:{did}/metric.missing#{_slug(m['code'], 30)}"
        add_node(id=fid, type="Finding", derivation="computed",
                 rule="metric.missing", severity="warning",
                 title=f"업종 필수지표 누락: {m['label']}",
                 detail=f"{prof.name} 진단서는 {m['label']}를 포함해야 합니다.",
                 resolution=None)
        add_edge("flags", fid, dgn, derivation="computed")

    # --- 규제 준수 → Finding ----------------------------------------------
    if compliance_report:
        for i, f in enumerate(compliance_report.get("findings", [])):
            fid = f"fnd:{did}/{f['rule']}#{i}"
            add_node(id=fid, type="Finding", derivation="computed",
                     rule=f["rule"], severity=f["severity"],
                     law=f["law"], article=f["article"],
                     title=f["title"], detail=f["detail"],
                     resolution=f.get("resolution"))
            add_edge("flags", fid, dgn, derivation="computed")

    # --- 채널 통계 (Document 노드) ----------------------------------------
    for ch, cnt in (("text", len(doc.text_blocks)), ("table", len(doc.tables)),
                    ("image", len(doc.images))):
        cid = f"chan:{did}/{ch}"
        add_node(id=cid, type="Channel", derivation="computed", channel=ch, count=cnt)
        add_edge("hasChannel", dgn, cid, derivation="computed")

    return {
        "ontology": ONTOLOGY_VERSION,
        "diagnosis": {
            "id": did,
            "document": doc.filename,
            "doc_hash": doc.doc_hash,
            "sector": sector,
            "sector_name": prof.name,
        },
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "quantities": qcount,
            "findings": sum(1 for n in nodes if n["type"] == "Finding"),
            "by_type": _count(n["type"] for n in nodes),
            "by_derivation": _count(n.get("derivation", "-") for n in nodes),
        },
        "nodes": nodes,
        "edges": edges,
    }


def _count(it) -> dict[str, int]:
    out: dict[str, int] = {}
    for v in it:
        out[v] = out.get(v, 0) + 1
    return out


def to_turtle(graph: dict, base: str = "http://gngmeta.com/ediag#") -> str:
    """Fuseki/SPARQL 적재용 TTL. Cloudsystem 의 TTLConverter 와 짝이 된다."""
    lines = [
        f"@prefix ed: <{base}> .",
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
        "",
    ]

    def esc(v: Any) -> str:
        if isinstance(v, bool):
            return f'"{str(v).lower()}"^^xsd:boolean'
        if isinstance(v, (int, float)):
            return f'"{v}"^^xsd:decimal'
        s = str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")
        return f'"{s}"'

    def uri(node_id: str) -> str:
        return "ed:" + re.sub(r"[^\w.-]", "_", node_id)

    for n in graph["nodes"]:
        lines.append(f"{uri(n['id'])} rdf:type ed:{n['type']} ;")
        props = [f"    ed:{k} {esc(v)}" for k, v in n.items()
                 if k not in ("id", "type") and v is not None]
        lines.append(" ;\n".join(props) + " ." if props else "    rdfs:label \"\" .")
        lines.append("")

    for e in graph["edges"]:
        lines.append(f"{uri(e['source'])} ed:{e['type']} {uri(e['target'])} .")

    return "\n".join(lines)
