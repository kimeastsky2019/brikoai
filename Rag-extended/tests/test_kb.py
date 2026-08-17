"""지식 데이터베이스 구축 회귀 테스트.

여기 있는 테스트는 성능이 아니라 **설계 결정**을 지킨다.
누가 나중에 편의를 위해 게이트를 우회하거나 ID 규칙을 바꾸면 여기서 걸려야 한다.
"""

import re
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kb import taxonomy, classify, compliance, ontology  # noqa: E402


# --------------------------------------------------------------------------
# 택소노미 — 닫힌 집합
# --------------------------------------------------------------------------
def test_sector_set_is_closed():
    """미정의 업종은 조용히 통과하면 안 된다. 통과하면 라벨이 오염된다."""
    with pytest.raises(KeyError):
        taxonomy.get("존재하지_않는_업종")


def test_every_sector_has_required_metrics():
    for code, prof in taxonomy.SECTORS.items():
        assert prof.required_metrics, f"{code} 에 필수지표가 없습니다"
        assert prof.unit_basis, f"{code} 에 원단위 기준이 없습니다"


def test_collection_name_is_deterministic():
    assert taxonomy.collection_name("waste") == taxonomy.collection_name("waste")
    assert taxonomy.collection_name("waste") != taxonomy.collection_name("building")


# --------------------------------------------------------------------------
# 분류 — 정밀도 우선
# --------------------------------------------------------------------------
def test_waste_report_classifies_as_waste():
    text = "음식물류 폐기물 처리시설 퇴비화 부숙 함수율 탈수케이크 자원화 " * 5
    c = classify.classify_text(text)
    assert c.sector == "waste"
    assert not c.needs_review


def test_ambiguous_text_is_held_not_guessed():
    """애매하면 확정하지 않는다. 틀린 라벨은 없는 라벨보다 나쁘다."""
    c = classify.classify_text("보일러 점검 결과 이상 없음")
    assert c.needs_review, "근거가 약한데 업종을 확정했습니다"


def test_empty_text_falls_back_to_other():
    c = classify.classify_text("")
    assert c.sector == "other"
    assert c.needs_review
    assert c.method == "fallback"


def test_classification_is_reproducible():
    """같은 입력은 같은 결과. LLM 을 쓰면 이게 깨진다."""
    text = "음식물 폐기물 퇴비 슬러지 건조기 " * 4
    a, b = classify.classify_text(text), classify.classify_text(text)
    assert (a.sector, round(a.confidence, 6)) == (b.sector, round(b.confidence, 6))


# --------------------------------------------------------------------------
# 개인정보 — 탐지와 비식별
# --------------------------------------------------------------------------
def test_detects_spaced_korean_names():
    """한글 문서는 자간을 벌려 조판한다. '허 만 수' 를 못 잡으면 탐지가 무의미하다."""
    hits = compliance.detect_pii("담 당 자 : 허 만 수")
    assert any(h["kind"] == "name" for h in hits)


def test_waste_codes_are_not_account_numbers():
    """51-38-01 은 폐기물 분류코드다. 계좌번호로 잡히면 오탐이 판정을 왜곡한다."""
    hits = compliance.detect_pii("음식물류 폐기물 51-38-01 중간가공 51-38-02")
    assert not any(h["kind"] == "account" for h in hits)


def test_business_number_counted_once():
    """사업자등록번호가 계좌번호로도 잡혀 건수가 부풀면 안 된다."""
    hits = compliance.detect_pii("사업자등록번호 623-86-00165")
    vals = [h["value"] for h in hits]
    assert len(vals) == len(set(vals))


def test_masking_removes_everything_it_claims_to():
    text = "대표자: 허인구 담당자: 허만수 (063)635-8991 vitech1200@naver.com 623-86-00165"
    v = compliance.verify_masking(text)
    assert v["clean"], f"마스킹 후 잔존: {v['residual']}"
    assert v["masked_count"] >= 5


def test_masking_preserves_the_kind():
    """값을 지우지 않고 종류를 남긴다. '여기 연락처가 있었다' 는 사실이 보존돼야 한다."""
    masked, _ = compliance.mask_text("문의 (063)635-8991")
    assert "[전화번호]" in masked
    assert "635-8991" not in masked


# --------------------------------------------------------------------------
# 규제 게이트 — 우회로가 없어야 한다
# --------------------------------------------------------------------------
def test_pii_triggers_cross_border_blocker():
    """개인정보가 있는 문서를 해외로 올리면 국외 이전이다 (제28조의8)."""
    r = compliance.review("담당자: 허만수 (063)635-8991")
    assert not r["upload_allowed"]
    assert r["verdict"] == "차단"
    assert any(f["rule"] == "privacy.cross_border" for f in r["findings"])


def test_clean_text_allows_upload():
    r = compliance.review("루츠블로워 28대의 소비전력을 측정하였다.",
                          has_output_labeling=True, has_prior_notice=True)
    assert r["upload_allowed"]
    assert r["pii_detected"] == 0


def test_generative_ai_without_labeling_is_a_violation():
    """AI기본법 제31조제2항 — 생성물 표시."""
    fs = compliance.check_ai_act(has_output_labeling=False, has_prior_notice=True)
    assert any(f.rule == "ai.transparency.labeling" and f.severity == "error" for f in fs)


def test_high_impact_is_held_not_decided():
    """고영향 해당성은 정성 판단이다. 룰이 확정하면 안 된다."""
    fs = compliance.check_ai_act()
    hi = next(f for f in fs if f.rule == "ai.high_impact.review")
    assert hi.severity == "info"
    assert "판단 유보" in hi.title


def test_findings_have_empty_resolution():
    """판정은 룰이, 확정은 사람이. resolution 을 룰이 채우면 안 된다."""
    r = compliance.review("담당자: 허만수 (063)635-8991")
    assert all(f["resolution"] is None for f in r["findings"])


# --------------------------------------------------------------------------
# 온톨로지 — ID 규칙이 단일 실패 지점
# --------------------------------------------------------------------------
class _FakeTable:
    def __init__(self, page, idx, header, rows):
        self.page, self.idx = page, idx
        self.header, self.rows = header, rows
        self.n_numeric_cells = 0
        self.caption = ""

    @property
    def shape(self):
        return (len(self.rows), len(self.header))


class _FakeDoc:
    def __init__(self, tables):
        self.filename = "t.pdf"
        self.doc_hash = "deadbeef"
        self.n_pages = 1
        self.text_blocks = []
        self.tables = tables
        self.images = []
        self.warnings = []

    @property
    def full_text(self):
        return "루츠블로워 보일러"

    def summary(self):
        return {}


def _graph():
    t = _FakeTable(7, 0, ["구분", "용량(kW)", "수량"], [["루츠블로워", "22", "18대"]])
    doc = _FakeDoc([t])
    cls = classify.Classification("waste", 0.9, False, "rule")
    cov = {"missing": [], "present": []}
    return ontology.build_graph(doc, cls, cov, diagnosis_id="t1")


def test_node_ids_contain_no_coordinates():
    """★ 단일 실패 지점. ID 에 bbox 를 넣으면 파서를 고치는 순간 그래프가 끊긴다."""
    g = _graph()
    for n in g["nodes"]:
        assert not re.search(r"\bbbox\b|\bx0\b|\d+\.\d{3,}", n["id"]), \
            f"ID 에 좌표로 보이는 값이 있습니다: {n['id']}"


def test_graph_is_byte_identical_on_rerun():
    import json
    assert json.dumps(_graph(), sort_keys=True) == json.dumps(_graph(), sort_keys=True)


def test_header_unit_is_borrowed_for_bare_numbers():
    """`용량(kW)` 헤더 아래 `22` 는 실제 진단서에서 가장 흔한 표기다."""
    g = _graph()
    qs = [n for n in g["nodes"] if n["type"] == "Quantity"]
    assert any(q["unit"] == "kW" and q["value"] == 22.0 for q in qs), \
        f"헤더 단위를 빌려오지 못했습니다: {[(q['value'], q['unit']) for q in qs]}"


def test_korean_word_is_not_read_as_currency():
    """'남원시' 의 '원' 을 화폐 단위로 읽으면 안 된다."""
    t = _FakeTable(1, 0, ["소재지"], [["전라북도 남원시 대강면 섬진로 1200-27"]])
    cls = classify.Classification("waste", 0.9, False, "rule")
    g = ontology.build_graph(_FakeDoc([t]), cls, {"missing": [], "present": []})
    assert not [n for n in g["nodes"]
                if n["type"] == "Quantity" and n["unit"] == "원"]


def test_every_quantity_has_evidence():
    """근거 없는 사실 금지."""
    g = _graph()
    qids = {n["id"] for n in g["nodes"] if n["type"] == "Quantity"}
    evidenced = {e["source"] for e in g["edges"] if e["type"] == "evidencedBy"}
    assert qids <= evidenced, f"근거 없는 Quantity: {qids - evidenced}"


def test_every_node_has_derivation():
    for n in _graph()["nodes"]:
        assert n.get("derivation") in ("measured", "documented", "assumed", "computed"), \
            f"{n['id']} 의 derivation 이 없거나 허용값 밖입니다"


def test_turtle_export_is_parseable_shape():
    ttl = ontology.to_turtle(_graph())
    assert ttl.startswith("@prefix ed:")
    assert " rdf:type ed:Diagnosis ;" in ttl


# --------------------------------------------------------------------------
# Qdrant 적재 어댑터 — 이 앱은 Grok Collections 에서 Qdrant 로 이전했다.
# 게이트와 채널 규칙이 그 이전 과정에서 느슨해지지 않았는지 지킨다.
# --------------------------------------------------------------------------
from kb import store_qdrant  # noqa: E402


class _Result:
    """upload() 가 보는 최소한의 분석 결과."""

    def __init__(self, allowed: bool):
        self.upload_allowed = allowed
        self.collection_name = "ediag__waste"
        self.filename = "x.pdf"
        self.doc_hash = "abc123"
        self.sector = "waste"
        self.sector_name = "폐기물처리·자원순환"


def test_upload_refuses_when_the_gate_said_no():
    """게이트를 우회하는 인자는 없다 — allowed=False 면 아무 일도 없어야 한다."""
    out = store_qdrant.upload(_Result(False), [{"channel": "text", "content": "본문"}])
    assert out["uploaded"] == 0
    assert out["collection"] is None
    assert "규제 게이트" in out["skipped"]


def test_prepare_masks_and_verifies():
    chunks = [{"channel": "text", "content": "담당자 홍길동, 010-1234-5678"}]
    cleaned, info = store_qdrant.prepare(chunks)
    assert info["masked"] is True
    assert info["residual_count"] == 0
    assert "010-1234-5678" not in cleaned[0]["content"]


def test_prepare_refuses_unmasked_text_that_still_has_pii():
    """mask=False 로 우회하려 해도 개인정보가 남아 있으면 빈 목록을 준다."""
    chunks = [{"channel": "text", "content": "연락처 010-1234-5678"}]
    cleaned, info = store_qdrant.prepare(chunks, mask=False)
    assert cleaned == []
    assert info["residual_count"] > 0


def test_each_table_becomes_its_own_search_unit():
    """표 두 개를 한 점에 넣으면 검색이 엉뚱한 표를 근거로 답한다."""
    chunks = [
        {"channel": "table", "content": "표1", "page": 1, "anchor": "t1"},
        {"channel": "table", "content": "표2", "page": 2, "anchor": "t2"},
    ]
    docs = store_qdrant.channel_documents(chunks)
    assert len(docs) == 2
    assert all(d["parts"] == 1 for d in docs)


def test_text_chunks_are_merged_but_bounded():
    chunks = [{"channel": "text", "content": "가" * 500, "page": i, "anchor": f"p{i}"}
              for i in range(20)]
    docs = store_qdrant.channel_documents(chunks, max_chars=2000)
    assert len(docs) > 1
    assert all(len(d["content"]) < 4000 for d in docs)
