from __future__ import annotations

from app.core.config import settings
from app.core.rag_client import call_rag_retrieve, format_rag_retrieve_for_tool, rag_agent_configured
from app.tools.common import tool_err, tool_ok

# 线程局部上下文：由 graph executing 节点在调用工具前注入
_TOOL_CTX: dict[str, str] = {}


def set_tool_context(
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    trace_id: str | None = None,
) -> None:
    if session_id:
        _TOOL_CTX["session_id"] = session_id
    if user_id:
        _TOOL_CTX["user_id"] = user_id
    if trace_id:
        _TOOL_CTX["trace_id"] = trace_id


def clear_tool_context() -> None:
    _TOOL_CTX.clear()


def knowledge_retrieval(query: str, session_id: str = "default") -> dict:
    q = str(query or "").strip()
    if not q:
        return tool_err("知识库检索失败：query 不能为空。", code="missing_query")

    if not rag_agent_configured():
        return tool_err(
            "知识库检索失败：未配置 RAG_AGENT_URL。请在 backend/.env 中设置，例如 http://127.0.0.1:13102",
            data={"query": q},
            code="rag_not_configured",
        )

    sid = str(_TOOL_CTX.get("session_id") or session_id or "default").strip() or "default"
    uid = str(_TOOL_CTX.get("user_id") or "").strip() or None
    trace_id = str(_TOOL_CTX.get("trace_id") or "").strip() or None

    raw = call_rag_retrieve(
        q,
        session_id=sid,
        user_id=uid,
        trace_id=trace_id,
        skip_evidence_select=settings.RAG_SKIP_EVIDENCE_SELECT,
    )
    human, data = format_rag_retrieve_for_tool(raw, q)
    ok = bool(data.get("hits", 0))
    return tool_ok(human, data=data, code="ok" if ok else "no_hits")
