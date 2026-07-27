"""RAG_Agent HTTP 客户端（/api/retrieve）。"""
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


def rag_agent_configured() -> bool:
    return bool(str(settings.RAG_AGENT_URL or "").strip())


def call_rag_retrieve(
    query: str,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    trace_id: str | None = None,
    skip_evidence_select: bool = False,
) -> dict[str, Any] | None:
    base = str(settings.RAG_AGENT_URL or "").strip().rstrip("/")
    q = str(query or "").strip()
    if not base or not q:
        return None
    payload: dict[str, Any] = {
        "query": q,
        "message": q,
        "rawQuery": q,
        "skipEvidenceSelect": bool(skip_evidence_select),
    }
    if user_id:
        payload["userId"] = user_id
    headers = _internal_headers(trace_id=trace_id, user_id=user_id)
    if session_id:
        headers["x-session-id"] = session_id
    timeout = float(settings.RAG_RETRIEVE_TIMEOUT_SECONDS)
    try:
        with httpx.Client(timeout=timeout) as client:
            res = client.post(f"{base}/api/retrieve", json=payload, headers=headers)
            if res.status_code != 200:
                return {"ok": False, "status": res.status_code, "error": res.text[:400]}
            data = res.json()
            return data if isinstance(data, dict) else None
    except Exception as e:
        return {"ok": False, "error": str(e)}


def format_rag_retrieve_for_tool(data: dict[str, Any] | None, query: str) -> tuple[str, dict[str, Any]]:
    if not data:
        return (
            f"知识库检索失败：未配置 RAG_AGENT_URL 或 RAG 服务不可用。问句：{query}",
            {"query": query, "hits": 0},
        )
    if data.get("ok") is False and not data.get("evidence"):
        err = str(data.get("error") or data.get("status") or "unknown")
        return (f"知识库检索失败：{err}", {"query": query, "hits": 0, "error": err})

    evidence = data.get("evidence")
    if not isinstance(evidence, list):
        evidence = []
    citations = data.get("citations")
    if not isinstance(citations, list):
        citations = []

    if data.get("needsClarify") and not evidence:
        reason = str(data.get("clarify_reason") or "证据不足")
        return (
            f"知识库未找到与「{query}」直接相关的文档（{reason}）。",
            {"query": query, "hits": 0, "needs_clarify": True},
        )

    lines = [f"知识库检索「{query}」共 {len(evidence)} 条证据："]
    sources: list[str] = []
    for i, item in enumerate(evidence[:8], start=1):
        if not isinstance(item, dict):
            continue
        src = str(item.get("source") or "未知来源").strip()
        content = str(item.get("content") or item.get("quote") or "").strip()
        if len(content) > 280:
            content = content[:277] + "…"
        lines.append(f"{i}. [{src}] {content}")
        if src:
            sources.append(src)

    if len(lines) <= 1:
        return (
            f"知识库未找到与「{query}」相关的文档片段。",
            {"query": query, "hits": 0, "sources": []},
        )

    human = "\n".join(lines)
    return (
        human,
        {
            "query": query,
            "hits": len(evidence),
            "sources": list(dict.fromkeys(sources))[:12],
            "citations": citations[:12] if citations else None,
            "rag_ms": data.get("ms"),
        },
    )
