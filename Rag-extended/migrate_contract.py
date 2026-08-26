"""
migrate_contract.py — 데이터 계약 컬럼 마이그레이션 (P1)

SQLModel 의 create_all 은 **없는 테이블만** 만들고 기존 테이블에 컬럼을
추가하지는 않는다. 그래서 이미 존재하는 document/user 테이블에는
ALTER TABLE 로 직접 컬럼을 붙인다.

여러 번 실행해도 안전하다 (이미 있는 컬럼은 건너뛴다).

    python migrate_contract.py [--db /opt/rag/data/rag.db]
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

# (테이블, 컬럼, DDL 타입/기본값)
COLUMNS: list[tuple[str, str, str]] = [
    ("document", "stable_id",   "TEXT"),
    ("document", "version",     "INTEGER NOT NULL DEFAULT 1"),
    ("document", "sha256",      "TEXT"),
    ("document", "acl",         "TEXT NOT NULL DEFAULT 'INTERNAL'"),
    ("document", "owner",       "TEXT"),
    ("document", "doc_status",  "TEXT NOT NULL DEFAULT 'draft'"),
    ("document", "provenance",  "TEXT"),
    ("document", "file_path",   "TEXT"),
    ("document", "mime",        "TEXT"),
    ("document", "size_bytes",  "INTEGER"),
    ("document", "chunk_count", "INTEGER NOT NULL DEFAULT 0"),
    ("user",     "acl",         "TEXT NOT NULL DEFAULT 'PUBLIC'"),
    ("user",     "is_service",  "INTEGER NOT NULL DEFAULT 0"),
]

INDEXES: list[tuple[str, str, str]] = [
    ("ix_document_stable_id", "document", "stable_id"),
    ("ix_document_sha256",    "document", "sha256"),
]


DEFAULT_DB_URL = "sqlite+aiosqlite:////opt/rag/data/rag.db"


def _db_path_from_url(url: str) -> str:
    """
    슬래시 4개 = 절대경로  sqlite:////opt/rag/data/rag.db → /opt/rag/data/rag.db
    슬래시 3개 = 상대경로  sqlite:///rag.db              → rag.db
    """
    if "://" not in url:
        return url
    tail = url.split("://", 1)[1]
    return tail[1:] if tail.startswith("/") else tail


def existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    except sqlite3.Error:
        return set()


def migrate(db_path: str) -> int:
    if not os.path.isfile(db_path):
        print(f"✗ DB 파일이 없습니다: {db_path}")
        return 1

    conn = sqlite3.connect(db_path)
    added, skipped = 0, 0
    try:
        for table, column, ddl in COLUMNS:
            cols = existing_columns(conn, table)
            if not cols:
                print(f"  · {table}: 테이블 없음 — 건너뜀 (앱 최초 기동 시 생성됨)")
                continue
            if column in cols:
                skipped += 1
                continue
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            print(f"  + {table}.{column}")
            added += 1

        for name, table, column in INDEXES:
            if column in existing_columns(conn, table):
                conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({column})")

        # 기존 어드민은 최고 등급으로 올린다. 계약 도입 이전에 만들어진 유일한
        # 계정이며, PUBLIC 기본값이 그대로 걸리면 자기 문서도 못 읽는다.
        if "acl" in existing_columns(conn, "user"):
            cur = conn.execute(
                "UPDATE user SET acl='RESTRICTED' WHERE id=1 AND acl='PUBLIC'"
            )
            if cur.rowcount:
                print("  · user#1(어드민) → acl=RESTRICTED")

        conn.commit()
    finally:
        conn.close()

    print(f"\n✓ 마이그레이션 완료: {added}개 추가, {skipped}개 이미 존재 ({db_path})")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="데이터 계약 컬럼 마이그레이션")
    ap.add_argument(
        "--db",
        default=_db_path_from_url(os.getenv("DATABASE_URL", DEFAULT_DB_URL)),
    )
    args = ap.parse_args()
    sys.exit(migrate(args.db))
