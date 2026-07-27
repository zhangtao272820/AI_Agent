"""OpenAI 兼容 embedding 客户端（与总管/DB 共用 OPENAI_* 环境变量）。"""
from __future__ import annotations

import math
import os
import time
from typing import Sequence

_embed_client = None
_query_cache: dict[str, tuple[float, list[float]]] = {}
_QUERY_TTL_SEC = 180.0
_QUERY_MAX = 128


from app.core.admin_env_modes import is_admin_intent_rag_enabled


def embedding_api_configured() -> bool:
    return bool(_api_key())


def is_admin_embedding_enabled() -> bool:
    return is_admin_intent_rag_enabled()


def _api_key() -> str:
    return (
        os.getenv("OPENAI_API_KEY")
        or os.getenv("DASHSCOPE_API_KEY")
        or ""
    ).strip()


def _embed_model() -> str:
    return os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-v2").strip()


def _get_client():
    global _embed_client
    if _embed_client is None:
        from langchain_openai import OpenAIEmbeddings

        base = os.getenv("OPENAI_BASE_URL", "").strip()
        kwargs: dict = {"api_key": _api_key(), "model": _embed_model()}
        if base:
            kwargs["base_url"] = base
        _embed_client = OpenAIEmbeddings(**kwargs)
    return _embed_client


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _prune_cache() -> None:
    if len(_query_cache) <= _QUERY_MAX:
        return
    items = sorted(_query_cache.items(), key=lambda kv: kv[1][0])
    for key, _ in items[: len(_query_cache) - _QUERY_MAX]:
        _query_cache.pop(key, None)


def embed_query(text: str) -> list[float]:
    key = " ".join(str(text or "").split()).lower()[:400]
    if not key or not _api_key() or not is_admin_embedding_enabled():
        return []
    now = time.time()
    cached = _query_cache.get(key)
    if cached and now - cached[0] < _QUERY_TTL_SEC:
        return list(cached[1])
    try:
        vec = _get_client().embed_query(key)
        if vec:
            _query_cache[key] = (now, list(vec))
            _prune_cache()
        return list(vec or [])
    except Exception:
        return []


def embed_documents(texts: list[str]) -> list[list[float]]:
    if not texts or not _api_key() or not is_admin_embedding_enabled():
        return []
    try:
        return [list(v) for v in _get_client().embed_documents(texts)]
    except Exception:
        return []
