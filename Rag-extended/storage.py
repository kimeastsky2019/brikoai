"""
storage.py — 원본 파일 보관소

기존 파이프라인은 업로드된 파일에서 텍스트만 뽑고 원본을 버렸다.
원본이 없으면 (1) 파서를 교체해도 재인제스트를 할 수 없고,
(2) 인용한 근거를 사람이 직접 확인할 수 없으며, (3) 해시 검증이 불가능하다.

레이아웃
    {FILES_ROOT}/{stable_id 를 경로로 바꾼 값}/v{version}/{원본파일명}

stable_id 의 콜론은 경로 구분자로 쓸 수 없으므로 `__` 로 바꾼다.
    doc:ets:audit-2026-031 → doc__ets__audit-2026-031
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional

from config import FILES_ROOT
from contract import sha256_bytes

# 경로 탈출을 막기 위해 파일명에서 제거할 문자
_UNSAFE = ("/", "\\", "\x00")


def _safe_filename(name: str) -> str:
    base = os.path.basename(name or "").strip()
    for ch in _UNSAFE:
        base = base.replace(ch, "_")
    base = base.lstrip(".") or "unnamed"
    return base[:200]


def stable_id_to_dir(stable_id: str) -> str:
    return stable_id.replace(":", "__")


def version_dir(stable_id: str, version: int) -> Path:
    return Path(FILES_ROOT) / stable_id_to_dir(stable_id) / f"v{version}"


def save_original(
    stable_id: str,
    version: int,
    filename: str,
    content: bytes,
) -> tuple[str, str]:
    """
    원본 저장. (저장 경로, sha256) 반환.
    같은 (stable_id, version) 에 다시 쓰면 덮어쓴다 — 버전이 곧 불변 단위이므로
    내용이 달라졌다면 호출자가 version 을 올려서 불러야 한다.
    """
    d = version_dir(stable_id, version)
    d.mkdir(parents=True, exist_ok=True)
    path = d / _safe_filename(filename)
    path.write_bytes(content)
    return str(path), sha256_bytes(content)


def read_original(path: Optional[str]) -> Optional[bytes]:
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    return p.read_bytes()


def exists(path: Optional[str]) -> bool:
    return bool(path) and Path(path).is_file()


def verify(path: Optional[str], expected_sha256: Optional[str]) -> bool:
    """보관된 파일이 대장에 적힌 해시와 일치하는지."""
    content = read_original(path)
    if content is None or not expected_sha256:
        return False
    return sha256_bytes(content) == expected_sha256


def delete_version(stable_id: str, version: int) -> bool:
    d = version_dir(stable_id, version)
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)
        return True
    return False


def delete_all_versions(stable_id: str) -> bool:
    d = Path(FILES_ROOT) / stable_id_to_dir(stable_id)
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)
        return True
    return False


def ensure_root() -> None:
    Path(FILES_ROOT).mkdir(parents=True, exist_ok=True)
