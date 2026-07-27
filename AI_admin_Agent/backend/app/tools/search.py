from __future__ import annotations

from app.core.web_search import run_web_search
from app.tools.common import tool_err, tool_ok


def web_search(query: str) -> dict:
    q = str(query or "").strip()
    if not q:
        return tool_err("搜索失败：query 不能为空。", code="missing_query")
    human, hits, provider = run_web_search(q, max_results=5)
    ok = bool(hits) and provider not in ("error", "none", "empty_query")
    return tool_ok(
        human,
        data={"query": q, "provider": provider, "hits": hits, "count": len(hits)},
        code="ok" if ok else "search_failed",
    )
