"""轻量联网搜索：优先 Docker 内 SearXNG，回退 DuckDuckGo。"""
from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import settings

SearchHit = dict[str, Any]


def _strip_html(s: str) -> str:
    t = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    t = re.sub(r"<style[\s\S]*?</style>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _truncate(s: str, n: int) -> str:
    t = str(s or "").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def searxng_base_url() -> str:
    raw = str(os.getenv("SEARXNG_BASE_URL") or settings.SEARXNG_BASE_URL or "").strip()
    return raw.rstrip("/")


def is_searxng_configured() -> bool:
    return bool(searxng_base_url())


def resolve_search_provider() -> str:
    p = str(os.getenv("ADMIN_SEARCH_PROVIDER") or settings.ADMIN_SEARCH_PROVIDER or "auto").strip().lower()
    if p == "ddg":
        p = "duckduckgo"
    if p in ("mock", "none"):
        return p
    if p == "searxng":
        return "searxng" if is_searxng_configured() else "duckduckgo"
    if p == "duckduckgo":
        return "duckduckgo"
    # auto：有 SearXNG 则用自建检索，否则 DuckDuckGo
    if is_searxng_configured():
        return "searxng"
    return "duckduckgo"


def search_mock_enabled() -> bool:
    return os.getenv("ADMIN_SEARCH_MOCK", "0").strip().lower() in ("1", "true", "yes")


def _search_duckduckgo(query: str, max_results: int) -> list[SearchHit]:
    url = f"https://api.duckduckgo.com/?q={quote(query)}&format=json&no_html=1&skip_disambig=1"
    with httpx.Client(timeout=settings.WEB_SEARCH_TIMEOUT_SECONDS) as client:
        res = client.get(
            url,
            headers={"Accept": "application/json", "User-Agent": "AI-Admin-Agent/1.0"},
        )
        res.raise_for_status()
        data = res.json()
    hits: list[SearchHit] = []
    abs_url = str(data.get("AbstractURL") or "").strip()
    abs_text = str(data.get("AbstractText") or "").strip()
    if abs_url and abs_text:
        hits.append({"title": str(data.get("Heading") or query), "url": abs_url, "snippet": abs_text})
    topics = data.get("RelatedTopics") or []
    for item in topics:
        if not isinstance(item, dict):
            continue
        if "Topics" in item:
            for sub in item.get("Topics") or []:
                if isinstance(sub, dict) and sub.get("FirstURL"):
                    hits.append(
                        {
                            "title": _truncate(str(sub.get("Text") or ""), 120),
                            "url": str(sub.get("FirstURL") or ""),
                            "snippet": str(sub.get("Text") or ""),
                        }
                    )
        elif item.get("FirstURL"):
            hits.append(
                {
                    "title": _truncate(str(item.get("Text") or ""), 120),
                    "url": str(item.get("FirstURL") or ""),
                    "snippet": str(item.get("Text") or ""),
                }
            )
        if len(hits) >= max_results:
            break
    return hits[:max_results]


def _search_searxng(query: str, max_results: int, mode: str = "general") -> list[SearchHit]:
    base = searxng_base_url()
    if not base:
        raise ValueError("SEARXNG_BASE_URL 未配置")
    params: dict[str, str] = {
        "q": query,
        "format": "json",
        "language": str(settings.SEARXNG_LANGUAGE or "zh-CN").strip() or "zh-CN",
    }
    categories = str(settings.SEARXNG_CATEGORIES or "").strip()
    if not categories:
        categories = "news" if mode == "news" else "general"
    if categories:
        params["categories"] = categories

    timeout = max(8.0, float(settings.SEARXNG_TIMEOUT_SECONDS or 20.0))
    with httpx.Client(timeout=timeout) as client:
        res = client.get(
            f"{base}/search",
            params=params,
            headers={"Accept": "application/json", "User-Agent": "AI-Admin-Agent/1.0 (SearXNG)"},
        )
        res.raise_for_status()
        data = res.json()

    unresponsive = (data.get("unresponsive_engines") or [])
    if not (data.get("results") or []) and unresponsive:
        engines = ", ".join(f"{e}:{r}" for e, r in unresponsive[:4])
        raise RuntimeError(f"SearXNG 无结果（引擎不可用: {engines}）")

    hits: list[SearchHit] = []
    for i, row in enumerate((data.get("results") or [])[:max_results]):
        if not isinstance(row, dict):
            continue
        hits.append(
            {
                "title": _truncate(_strip_html(str(row.get("title") or "")), 140),
                "url": str(row.get("url") or "").strip(),
                "snippet": _truncate(_strip_html(str(row.get("content") or "")), 280),
                "publishedDate": str(row.get("publishedDate") or row.get("published_date") or "").strip() or None,
                "engine": str(row.get("engine") or "").strip() or None,
            }
        )
    return hits


def _format_hits(query: str, hits: list[SearchHit], provider: str) -> str:
    lines = [f"联网搜索「{query}」（{provider}）Top {len(hits)}："]
    for i, h in enumerate(hits, start=1):
        title = _truncate(_strip_html(str(h.get("title") or "")), 100)
        snippet = _truncate(_strip_html(str(h.get("snippet") or "")), 200)
        url = str(h.get("url") or "").strip()
        lines.append(f"{i}. {title}")
        if snippet:
            lines.append(f"   {snippet}")
        if url:
            lines.append(f"   {url}")
    return "\n".join(lines)


def run_web_search(query: str, max_results: int = 5, mode: str = "general") -> tuple[str, list[SearchHit], str]:
    q = str(query or "").strip()
    if not q:
        return "搜索失败：query 不能为空。", [], "empty_query"

    if search_mock_enabled():
        text = f"【Mock 搜索】关于「{q}」的模拟结果（ADMIN_SEARCH_MOCK=1）。"
        return text, [{"title": "mock", "url": "", "snippet": text}], "mock"

    provider = resolve_search_provider()
    if provider == "none":
        return "搜索未启用。", [], "none"

    max_n = max(1, min(int(max_results or 5), 12))

    if provider == "searxng":
        try:
            hits = _search_searxng(q, max_n, mode=mode)
            if hits:
                return _format_hits(q, hits, "searxng"), hits, "searxng"
            return f"搜索无结果（searxng）。", [], "searxng"
        except Exception as exc:
            allow_ddg = os.getenv("WEB_SEARCH_ALLOW_DDG_FALLBACK", "1").strip().lower() not in (
                "0",
                "false",
                "no",
            )
            if not allow_ddg:
                return f"搜索失败：{exc}", [], "error"
            try:
                hits = _search_duckduckgo(q, max_n)
                if hits:
                    return _format_hits(q, hits, "duckduckgo(fallback)"), hits, "duckduckgo"
            except Exception as ddg_exc:
                return f"搜索失败：SearXNG {exc}; DuckDuckGo {ddg_exc}", [], "error"
            return f"搜索无结果（searxng 失败且 ddg 无命中）。", [], "error"

    try:
        hits = _search_duckduckgo(q, max_n)
        if not hits:
            return "搜索无结果（duckduckgo）。", [], "duckduckgo"
        return _format_hits(q, hits, "duckduckgo"), hits, "duckduckgo"
    except Exception as e:
        return f"搜索失败：{e}", [], "error"
