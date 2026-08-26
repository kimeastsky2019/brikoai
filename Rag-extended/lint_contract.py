"""
lint_contract.py — 데이터 계약 무결성 검사

왜 지금 검사하는가
    데이터 단에서 어긋난 것을 그대로 두면 그 위에 쌓는 인덱스·지식그래프·
    답변이 전부 같이 틀어진다. 그때 되돌아오면 원본부터 다시 만들어야 한다.
    만든 직후에 한 번 확인해 두는 비용이 나중에 훨씬 싸다.

검사 항목
    C1 stable_id 형식이 규약에 맞는가
    C2 (stable_id, version) 이 중복되지 않는가
    C3 보관된 원본이 실제로 존재하는가
    C4 원본 해시가 대장과 일치하는가 (변조·교체 감지)
    C5 ACL / doc_status 가 허용된 값인가
    C6 provenance 가 JSON 으로 파싱되는가
    C7 처리 완료(processed) 인데 청크 수가 0 이 아닌가
    C8 Qdrant 청크의 (stable_id, version, sha256, acl) 이 대장과 일치하는가
    C9 대장에 없는 고아 청크가 남아 있지 않은가
    C10 색인된 청크에 span(섹션·줄 범위) 이 있는가

    python lint_contract.py                # 검사만
    python lint_contract.py --fix-payload  # C8 불일치 청크의 payload 를 대장 기준으로 정정
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from collections import defaultdict

import contract
import storage
from config import QDRANT_HOST, QDRANT_PORT, QDRANT_API_KEY


DEFAULT_DB_URL = "sqlite+aiosqlite:////opt/rag/data/rag.db"


def db_path_from_url(url: str) -> str:
    """
    SQLAlchemy sqlite URL → 파일 경로.
      슬래시 4개 = 절대경로  sqlite:////opt/rag/data/rag.db → /opt/rag/data/rag.db
      슬래시 3개 = 상대경로  sqlite:///rag.db              → rag.db
    """
    if "://" not in url:
        return url
    tail = url.split("://", 1)[1]     # netloc(빈 문자열) + path
    return tail[1:] if tail.startswith("/") else tail


def _db_path() -> str:
    return db_path_from_url(os.getenv("DATABASE_URL", DEFAULT_DB_URL))


class Report:
    def __init__(self) -> None:
        self.violations: list[tuple[str, str]] = []
        self.checked = 0

    def add(self, code: str, message: str) -> None:
        self.violations.append((code, message))

    def print(self) -> int:
        if not self.violations:
            print(f"\n✓ 위반 0건 — 문서 {self.checked}건 검사 완료")
            return 0
        by_code: dict[str, list[str]] = defaultdict(list)
        for code, msg in self.violations:
            by_code[code].append(msg)
        print(f"\n✗ 위반 {len(self.violations)}건 (문서 {self.checked}건 검사)")
        for code in sorted(by_code):
            print(f"\n  [{code}] {len(by_code[code])}건")
            for m in by_code[code][:20]:
                print(f"    - {m}")
            if len(by_code[code]) > 20:
                print(f"    … 외 {len(by_code[code]) - 20}건")
        return 1


def load_documents(conn: sqlite3.Connection) -> list[dict]:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(document)")}
    required = {"stable_id", "version", "sha256", "acl", "doc_status",
                "provenance", "file_path", "chunk_count"}
    missing = required - cols
    if missing:
        print(f"✗ document 테이블에 계약 컬럼이 없습니다: {sorted(missing)}")
        print("  먼저 `python migrate_contract.py` 를 실행하세요.")
        sys.exit(2)

    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, status, collection_id, stable_id, version, sha256, acl, "
        "       owner, doc_status, provenance, file_path, chunk_count "
        "FROM document WHERE stable_id IS NOT NULL"
    ).fetchall()
    return [dict(r) for r in rows]


def collection_map(conn: sqlite3.Connection) -> dict[int, str]:
    return {r[0]: r[1] for r in conn.execute("SELECT id, xai_id FROM collection")}


def check_registry(docs: list[dict], rep: Report) -> None:
    seen: set[tuple[str, int]] = set()

    for d in docs:
        rep.checked += 1
        sid, ver = d["stable_id"], d["version"] or 1
        label = f"{sid} v{ver} ({d['name']})"

        # C1
        if not contract.is_valid_stable_id(sid):
            rep.add("C1", f"{label}: stable_id 형식 위반")

        # C2
        key = (sid, ver)
        if key in seen:
            rep.add("C2", f"{label}: (stable_id, version) 중복")
        seen.add(key)

        # C3 / C4
        if not storage.exists(d["file_path"]):
            rep.add("C3", f"{label}: 원본 파일 없음 ({d['file_path'] or '경로 미기록'})")
        elif not storage.verify(d["file_path"], d["sha256"]):
            rep.add("C4", f"{label}: 원본 해시 불일치 — 파일이 교체되었을 수 있음")

        # C5
        if (d["acl"] or "").upper() not in contract.ACL_LEVELS:
            rep.add("C5", f"{label}: 알 수 없는 ACL '{d['acl']}'")
        if (d["doc_status"] or "").lower() not in contract.DOC_STATUSES:
            rep.add("C5", f"{label}: 알 수 없는 doc_status '{d['doc_status']}'")

        # C6
        if d["provenance"]:
            parsed = contract.parse_provenance(d["provenance"])
            if "raw" in parsed and len(parsed) == 1:
                rep.add("C6", f"{label}: provenance 가 JSON 이 아님")
        else:
            rep.add("C6", f"{label}: provenance 없음")

        # C7
        if d["status"] == "processed" and (d["chunk_count"] or 0) == 0:
            rep.add("C7", f"{label}: processed 인데 청크 0개")


def check_qdrant(docs: list[dict], colmap: dict[int, str], rep: Report,
                 fix: bool = False) -> None:
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Filter, FieldCondition, MatchValue
    except ImportError:
        print("  · qdrant-client 없음 — 벡터 검사 건너뜀")
        return

    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, api_key=QDRANT_API_KEY)
    try:
        existing = {c.name for c in client.get_collections().collections}
    except Exception as e:
        print(f"  · Qdrant 연결 실패 ({e}) — 벡터 검사 건너뜀")
        return

    registry = {(d["stable_id"], d["version"] or 1): d for d in docs}
    by_collection: dict[str, list[dict]] = defaultdict(list)
    for d in docs:
        name = colmap.get(d["collection_id"])
        if name:
            by_collection[name].append(d)

    for cname, cdocs in by_collection.items():
        if cname not in existing:
            for d in cdocs:
                rep.add("C8", f"{d['stable_id']} v{d['version']}: 컬렉션 [{cname}] 없음")
            continue

        # 컬렉션 전체 청크를 훑어 대장과 대조한다.
        offset = None
        seen_keys: set[tuple[str, int]] = set()
        while True:
            points, offset = client.scroll(
                collection_name=cname, limit=256, offset=offset,
                with_payload=True, with_vectors=False,
            )
            if not points:
                break
            for p in points:
                pl = p.payload or {}
                sid = pl.get("stable_id")
                if not sid:
                    continue          # 계약 이전 청크 — C9 대상이 아니다
                ver = int(pl.get("version") or 1)
                seen_keys.add((sid, ver))
                doc = registry.get((sid, ver))
                if doc is None:
                    rep.add("C9", f"{sid} v{ver}: 대장에 없는 고아 청크 (컬렉션 {cname})")
                    continue

                mismatch = []
                if (pl.get("sha256") or "") != (doc["sha256"] or ""):
                    mismatch.append("sha256")
                if (pl.get("acl") or "") != contract.normalize_acl(doc["acl"]):
                    mismatch.append("acl")
                if mismatch:
                    rep.add("C8", f"{sid} v{ver}: 청크 payload 불일치 ({', '.join(mismatch)})")
                    if fix:
                        client.set_payload(
                            collection_name=cname,
                            payload={
                                "sha256": doc["sha256"] or "",
                                "acl": contract.normalize_acl(doc["acl"]),
                                "doc_status": contract.normalize_doc_status(doc["doc_status"]),
                            },
                            points=Filter(must=[
                                FieldCondition(key="stable_id", match=MatchValue(value=sid)),
                                FieldCondition(key="version", match=MatchValue(value=ver)),
                            ]),
                        )

                # C10 — 섹션 인지 청킹의 산물이 실제로 실렸는지
                if pl.get("section_no") is None and pl.get("start_line") is None:
                    rep.add("C10", f"{sid} v{ver}: 청크에 span 정보 없음")

            if offset is None:
                break

        # 색인되어야 하는데 청크가 하나도 없는 문서
        for d in cdocs:
            key = (d["stable_id"], d["version"] or 1)
            if key in seen_keys:
                continue
            if contract.normalize_acl(d["acl"]) in contract.ACL_NO_INDEX:
                continue              # 의도적으로 색인하지 않음
            if d["status"] == "processed":
                rep.add("C8", f"{d['stable_id']} v{d['version']}: processed 인데 청크가 없음")


def main() -> int:
    ap = argparse.ArgumentParser(description="데이터 계약 무결성 검사")
    ap.add_argument("--db", default=_db_path())
    ap.add_argument("--fix-payload", action="store_true",
                    help="청크 payload 불일치를 대장 기준으로 정정")
    ap.add_argument("--skip-qdrant", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(args.db):
        print(f"✗ DB 파일이 없습니다: {args.db}")
        return 2

    conn = sqlite3.connect(args.db)
    try:
        docs = load_documents(conn)
        colmap = collection_map(conn)
    finally:
        conn.close()

    if not docs:
        print("· 계약이 적용된 문서가 없습니다 (stable_id 가 있는 행 0건)")
        return 0

    rep = Report()
    print(f"검사 대상: 문서 {len(docs)}건")
    check_registry(docs, rep)
    if not args.skip_qdrant:
        check_qdrant(docs, colmap, rep, fix=args.fix_payload)

    return rep.print()


if __name__ == "__main__":
    sys.exit(main())
