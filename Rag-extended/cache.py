import hashlib
from cachetools import TTLCache

from config import CACHE_MAXSIZE, CACHE_TTL_SEC

_cache = TTLCache(maxsize=CACHE_MAXSIZE, ttl=CACHE_TTL_SEC)

def _key(collection_id: str, model: str, query: str, filters: dict | None) -> str:
    raw = f"{collection_id}|{model}|{query}|{filters or {}}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def cache_get(collection_id: str, model: str, query: str, filters: dict | None):
    return _cache.get(_key(collection_id, model, query, filters))

def cache_set(collection_id: str, model: str, query: str, filters: dict | None, value):
    _cache[_key(collection_id, model, query, filters)] = value
