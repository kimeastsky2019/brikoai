import hashlib
from cachetools import TTLCache

from config import CACHE_MAXSIZE, CACHE_TTL_SEC

_cache = TTLCache(maxsize=CACHE_MAXSIZE, ttl=CACHE_TTL_SEC)


def _key(
    collection_id: str,
    model: str,
    query: str,
    filters: dict | None,
    viewer_acl: str | None = None,
) -> str:
    # viewer_acl 은 반드시 키에 들어가야 한다.
    # 같은 질문이라도 열람 등급에 따라 검색되는 문서가 다르므로,
    # 등급을 빼면 상위 등급 사용자의 답변이 하위 등급 사용자에게 재사용된다.
    raw = f"{collection_id}|{model}|{query}|{filters or {}}|{viewer_acl or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def cache_get(
    collection_id: str,
    model: str,
    query: str,
    filters: dict | None,
    viewer_acl: str | None = None,
):
    return _cache.get(_key(collection_id, model, query, filters, viewer_acl))


def cache_set(
    collection_id: str,
    model: str,
    query: str,
    filters: dict | None,
    value,
    viewer_acl: str | None = None,
):
    _cache[_key(collection_id, model, query, filters, viewer_acl)] = value
