"""DB_Agent HTTP 客户端（/api/ask，只读问数）。"""
from __future__ import annotations

import os
from typing import Any

import httpx

from app.core.config import settings


def _internal_headers(trace_id: str | None = None, user_id: str | None = None) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json", "x-manager-orchestrated": "1"}
    token = str(
        os.getenv("CLAWHIVE_INTERNAL_TOKEN") or os.getenv("AGENT_INTERNAL_TOKEN") or ""
    ).strip()
    if token:
        headers["x-clawhive-internal-token"] = token
    if trace_id:
        headers["x-trace-id"] = trace_id
    if user_id:
        headers["x-user-id"] = user_id
    return headers


def db_agent_configured() -> bool:
    return bool(str(settings.DB_AGENT_HTTP_URL or "").strip())


def call_db_ask(
    question: str,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    trace_id: str | None = None,
    db_id: str | None = None,
) -> dict[str, Any] | None:
    base = str(settings.DB_AGENT_HTTP_URL or "").strip().rstrip("/")
    q = str(question or "").strip()
    if not base or not q:
        return None
    payload: dict[str, Any] = {"question": q}
    if db_id or settings.DB_AGENT_DB_ID:
        payload["dbId"] = str(db_id or settings.DB_AGENT_DB_ID or "").strip()
    if session_id:
        payload["sessionId"] = session_id
    headers = _internal_headers(trace_id=trace_id, user_id=user_id)
    timeout = float(settings.DB_ASK_TIMEOUT_SECONDS)
    try:
        with httpx.Client(timeout=timeout) as client:
            res = client.post(f"{base}/api/ask", json=payload, headers=headers)
            if res.status_code != 200:
                return {"ok": False, "status": res.status_code, "error": res.text[:400]}
            data = res.json()
            return data if isinstance(data, dict) else None
    except Exception as e:
        return {"ok": False, "error": str(e)}


def format_db_ask_for_tool(data: dict[str, Any] | None, question: str) -> tuple[str, dict[str, Any]]:
    if not data:
        return (
            f"问数失败：未配置 DB_AGENT_HTTP_URL 或 DB 服务不可用。问题：{question}",
            {"question": question, "ok": False},
        )
    if data.get("ok") is False and not data.get("answer"):
        err = str(data.get("error") or data.get("status") or "unknown")
        return (f"问数失败：{err}", {"question": question, "ok": False, "error": err})

    answer = str(data.get("answer") or "").strip()
    empty = bool(data.get("empty"))
    reason = str(data.get("reason") or "")
    if data.get("needs_clarification"):
        cq = str(data.get("clarification_question") or "需要补充查询条件")
        return (f"问数需要澄清：{cq}", {"question": question, "needs_clarification": True})

    if not answer or empty:
        return (
            f"数据库未查到与「{question}」匹配的结果（{reason or '无数据'}）。",
            {"question": question, "ok": True, "empty": True},
        )
    return (
        f"问数结果（{question}）：\n{answer}",
        {
            "question": question,
            "ok": True,
            "empty": False,
            "reason": reason,
            "run_id": data.get("run_id"),
        },
    )
