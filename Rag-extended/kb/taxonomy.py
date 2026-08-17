"""업종 택소노미 — 지식 데이터베이스 구축의 분류 축.

설계 원칙 (LLMWiki 온톨로지 원칙 1 과 동일): **타입 집합은 닫혀 있다.**

업종을 자유 문자열로 두면 같은 보고서가 업로드할 때마다 다른 라벨을 받고,
그 순간 업종별 필터·업종별 학습이 전부 무의미해진다. 새 업종이 필요하면
먼저 이 파일을 고쳐야 한다. 순서를 강제하는 것이 핵심이다.

각 업종은 프로파일을 가진다:
  - `required_metrics` : 그 업종 진단서라면 반드시 있어야 할 지표
  - `key_equipment`    : 주요 에너지 설비군
  - `energy_sources`   : 주 에너지원
  - `hints`            : 자동 분류용 어휘 (규칙 기반 1차 분류)
  - `unit_basis`       : 에너지 원단위의 분모 (업종마다 다르다)

`required_metrics` 가 이 시스템의 실질이다. 업종을 알면 **무엇이 빠졌는지**를
결정론적으로 물을 수 있다. 커버리지 갭 탐지가 여기서 나온다.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SectorProfile:
    code: str
    name: str
    ksic: str
    energy_sources: tuple[str, ...]
    key_equipment: tuple[str, ...]
    required_metrics: tuple[str, ...]
    unit_basis: str
    hints: tuple[str, ...] = field(default=())
    notes: str = ""


# --- 닫힌 집합. 여기 없는 업종은 그래프에 나올 수 없다. ------------------------
SECTORS: dict[str, SectorProfile] = {
    "waste": SectorProfile(
        code="waste",
        name="폐기물처리·자원순환",
        ksic="E38",
        energy_sources=("전력", "LPG", "LNG", "경유", "폐열"),
        key_equipment=("건조기", "보일러", "송풍기", "탈수기", "파쇄기", "탈취설비"),
        required_metrics=(
            "annual_electricity_kwh",
            "annual_fuel",
            "annual_energy_toe",
            "annual_ghg_tco2eq",
            "treatment_capacity_tpd",
            "moisture_stage",
            "energy_intensity",
        ),
        unit_basis="처리량 1톤당",
        hints=(
            "음식물", "음폐", "폐기물", "퇴비", "부숙", "슬러지", "자원화",
            "탈수케이크", "함수율", "재활용", "매립", "소각", "발효",
        ),
        notes="함수율 물질수지가 건조 열량의 타당성을 좌우한다. 「비료관리법」 공정규격 연계.",
    ),
    "food": SectorProfile(
        code="food",
        name="식품제조",
        ksic="C10-11",
        energy_sources=("전력", "LNG", "스팀"),
        key_equipment=("보일러", "냉동기", "살균설비", "건조기", "공조기"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "production_output", "energy_intensity",
        ),
        unit_basis="제품 1톤당",
        hints=("식품", "살균", "냉동", "냉장", "가공식품", "HACCP", "제조라인"),
    ),
    "chemical": SectorProfile(
        code="chemical",
        name="화학·석유화학",
        ksic="C20-21",
        energy_sources=("전력", "LNG", "스팀", "중유"),
        key_equipment=("반응기", "증류탑", "열교환기", "보일러", "압축기", "펌프"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "production_output", "energy_intensity",
            "steam_balance",
        ),
        unit_basis="제품 1톤당",
        hints=("반응기", "증류", "석유화학", "촉매", "플랜트", "정제", "중합"),
        notes="열통합(pinch) 분석 유무가 진단 품질을 가른다.",
    ),
    "metal": SectorProfile(
        code="metal",
        name="1차금속·금속가공",
        ksic="C24-25",
        energy_sources=("전력", "LNG", "코크스"),
        key_equipment=("가열로", "열처리로", "압축기", "집진기", "전기로"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "production_output", "energy_intensity",
            "furnace_efficiency",
        ),
        unit_basis="제품 1톤당",
        hints=("주조", "단조", "열처리", "가열로", "압연", "도금", "용해로", "전기로"),
    ),
    "textile": SectorProfile(
        code="textile",
        name="섬유·의복",
        ksic="C13-14",
        energy_sources=("전력", "LNG", "스팀"),
        key_equipment=("염색기", "텐터", "보일러", "건조기"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "production_output", "energy_intensity",
        ),
        unit_basis="원단 1,000m당",
        hints=("염색", "텐터", "방적", "직물", "가공사", "섬유"),
    ),
    "paper": SectorProfile(
        code="paper",
        name="펄프·종이",
        ksic="C17",
        energy_sources=("전력", "LNG", "스팀", "바이오매스"),
        key_equipment=("초지기", "보일러", "건조부", "진공펌프"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "production_output", "energy_intensity",
            "steam_balance",
        ),
        unit_basis="제품 1톤당",
        hints=("초지", "제지", "펄프", "골판지", "지력"),
    ),
    "nonmetal": SectorProfile(
        code="nonmetal",
        name="비금속광물(요업·시멘트)",
        ksic="C23",
        energy_sources=("전력", "유연탄", "LNG"),
        key_equipment=("소성로", "킬른", "분쇄기", "예열기"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "production_output", "energy_intensity",
            "furnace_efficiency",
        ),
        unit_basis="제품 1톤당",
        hints=("소성", "킬른", "시멘트", "요업", "내화물", "유리용해"),
    ),
    "machinery": SectorProfile(
        code="machinery",
        name="기계·전자·자동차",
        ksic="C26-30",
        energy_sources=("전력", "LNG"),
        key_equipment=("압축기", "공조기", "도장설비", "클린룸", "사출기"),
        required_metrics=(
            "annual_electricity_kwh", "annual_energy_toe", "annual_ghg_tco2eq",
            "production_output", "energy_intensity",
        ),
        unit_basis="제품 1대당",
        hints=("사출", "도장", "클린룸", "조립라인", "반도체", "디스플레이", "프레스"),
    ),
    "building": SectorProfile(
        code="building",
        name="건물(업무·상업·공공)",
        ksic="L68",
        energy_sources=("전력", "지역난방", "LNG"),
        key_equipment=("냉동기", "공조기", "보일러", "조명", "승강기"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "floor_area_m2", "energy_intensity",
        ),
        unit_basis="연면적 1㎡당",
        hints=("연면적", "공조", "냉동기", "지역난방", "조명", "빌딩", "청사", "EPI"),
        notes="원단위 분모가 면적이라 다른 업종과 벤치마크를 섞으면 안 된다.",
    ),
    "agri": SectorProfile(
        code="agri",
        name="농업·시설원예",
        ksic="A01",
        energy_sources=("전력", "경유", "LPG", "지열"),
        key_equipment=("난방기", "히트펌프", "관수설비", "제습기"),
        required_metrics=(
            "annual_electricity_kwh", "annual_fuel", "annual_energy_toe",
            "annual_ghg_tco2eq", "cultivation_area_m2", "energy_intensity",
        ),
        unit_basis="재배면적 1㎡당",
        hints=("시설원예", "온실", "육묘", "축사", "양계", "재배면적", "히트펌프"),
    ),
    "water": SectorProfile(
        code="water",
        name="상하수도·수처리",
        ksic="E36-37",
        energy_sources=("전력",),
        key_equipment=("송풍기", "펌프", "탈수기", "소화조"),
        required_metrics=(
            "annual_electricity_kwh", "annual_energy_toe", "annual_ghg_tco2eq",
            "treatment_capacity_tpd", "energy_intensity",
        ),
        unit_basis="처리수량 1,000㎥당",
        hints=("하수처리", "정수장", "송풍", "폭기", "소화가스", "방류수", "수처리"),
    ),
    "other": SectorProfile(
        code="other",
        name="기타·미분류",
        ksic="-",
        energy_sources=(),
        key_equipment=(),
        required_metrics=("annual_energy_toe", "annual_ghg_tco2eq"),
        unit_basis="-",
        hints=(),
        notes="분류 신뢰도가 낮을 때의 안전한 기본값. 사람이 확정해야 한다.",
    ),
}

SECTOR_CODES: tuple[str, ...] = tuple(SECTORS.keys())

# 지표 코드 → 사람이 읽는 이름
METRIC_LABELS: dict[str, str] = {
    "annual_electricity_kwh": "연간 전력사용량(kWh)",
    "annual_fuel": "연간 연료사용량",
    "annual_energy_toe": "연간 환산에너지사용량(toe)",
    "annual_ghg_tco2eq": "연간 온실가스 배출량(tCO2eq)",
    "treatment_capacity_tpd": "처리용량(톤/일)",
    "production_output": "생산량",
    "floor_area_m2": "연면적(㎡)",
    "cultivation_area_m2": "재배면적(㎡)",
    "moisture_stage": "공정단계별 함수율",
    "energy_intensity": "에너지 원단위",
    "steam_balance": "증기 수지",
    "furnace_efficiency": "노(爐) 열효율",
}

# 지표 탐지용 어휘. 규칙 기반이라 재현 가능하다.
METRIC_PATTERNS: dict[str, tuple[str, ...]] = {
    "annual_electricity_kwh": ("연간 전력", "연간 사용량", "kWh/y", "전력사용량", "소비전력"),
    "annual_fuel": ("연간 사용량", "연료소비량", "가스소비량", "kg/h", "연료사용량", "LPG 사용"),
    "annual_energy_toe": ("환산에너지", "toe", "TOE"),
    "annual_ghg_tco2eq": ("온실가스", "tCO2eq", "CO2eq", "배출량"),
    "treatment_capacity_tpd": ("처리용량", "톤/일", "t/일", "처리량", "허가물량"),
    "production_output": ("생산량", "생산실적", "제품 생산"),
    "floor_area_m2": ("연면적", "건축면적"),
    "cultivation_area_m2": ("재배면적", "시설면적"),
    "moisture_stage": ("함수율", "수분", "탈수"),
    "energy_intensity": ("원단위", "단위당 에너지", "에너지원단위"),
    "steam_balance": ("증기", "스팀", "t/h"),
    "furnace_efficiency": ("열효율", "노효율", "연소효율"),
}


def get(code: str) -> SectorProfile:
    """업종 프로파일 조회. 미지 코드는 예외 — 조용히 넘어가면 라벨이 오염된다."""
    if code not in SECTORS:
        raise KeyError(f"미정의 업종 코드: {code!r}. 허용값: {SECTOR_CODES}")
    return SECTORS[code]


def collection_name(sector: str, prefix: str = "ediag") -> str:
    """업종별 xAI 컬렉션 이름. 업종이 곧 컬렉션 분리 축이다."""
    return f"{prefix}__{get(sector).code}"


def as_dict() -> list[dict]:
    """프론트엔드로 내려보내는 직렬화 형태."""
    return [
        {
            "code": p.code,
            "name": p.name,
            "ksic": p.ksic,
            "energy_sources": list(p.energy_sources),
            "key_equipment": list(p.key_equipment),
            "required_metrics": [
                {"code": m, "label": METRIC_LABELS.get(m, m)} for m in p.required_metrics
            ],
            "unit_basis": p.unit_basis,
            "notes": p.notes,
        }
        for p in SECTORS.values()
    ]
