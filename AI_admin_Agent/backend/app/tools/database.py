"""DB_Agent 问数薄封装。"""
from __future__ import annotations

from app.core.db_client import call_db_ask, db_agent_configured, format_db_ask_for_tool
from app.tools.common import _tool_err, _tool_ok


def ask_database(question: str, session_id: str = "default", db_id: str = "") -> dict:
    """向 DB_Agent 发起自然语言问数（只读 SELECT）。"""
    q = str(question or "").strip()
    if not q:
        return _tool_err("请提供要问数据库的问题。", code="missing_question")
    if not db_agent_configured():
        return _tool_err(
            "问数未配置：请在 .env 设置 DB_AGENT_HTTP_URL（如 http://db_agent:13101）。",
            code="db_not_configured",
        )
    data = call_db_ask(q, session_id=session_id, db_id=db_id or None)
    human, meta = format_db_ask_for_tool(data, q)
    if meta.get("ok") is False:
        return _tool_err(human, data=meta, code="db_ask_failed")
    if meta.get("needs_clarification"):
        return _tool_ok(human, data=meta, code="needs_clarification")
    return _tool_ok(human, data=meta, code="db_ok" if not meta.get("empty") else "empty")
