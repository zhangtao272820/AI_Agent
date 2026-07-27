"""Lobster_Agent HTTP 客户端（浏览器自动化填表）。"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx

from app.core.config import settings


def _lobster_headers() -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    token = str(
        os.getenv("LOBSTER_ADMIN_TOKEN")
        or os.getenv("CLAWHIVE_INTERNAL_TOKEN")
        or os.getenv("AGENT_INTERNAL_TOKEN")
        or ""
    ).strip()
    if token:
        headers["x-lobster-token"] = token
        headers["x-clawhive-internal-token"] = token
    return headers


def lobster_agent_configured() -> bool:
    return bool(str(settings.LOBSTER_AGENT_HTTP_URL or "").strip())


def start_lobster_run(
    task: str,
    start_url: str = "",
    session_id: str = "",
    storage_profile: str = "",
    engine_hint: str = "",
) -> dict[str, Any] | None:
    base = str(settings.LOBSTER_AGENT_HTTP_URL or "").strip().rstrip("/")
    t = str(task or "").strip()
    if not base or not t:
        return None
    payload: dict[str, Any] = {"task": t}
    if start_url.strip():
        payload["startUrl"] = start_url.strip()
    sid = str(session_id or "").strip()
    if sid:
        payload["sessionId"] = sid
    profile = str(storage_profile or "").strip()
    if profile:
        payload["storageProfile"] = profile
    elif sid:
        payload["storageProfile"] = sid
    hint = str(engine_hint or "").strip().lower()
    if hint in ("classic", "mcp", "stagehand"):
        payload["engineHint"] = hint
    try:
        with httpx.Client(timeout=float(settings.LOBSTER_TIMEOUT_SECONDS)) as client:
            res = client.post(f"{base}/api/lobster/start", json=payload, headers=_lobster_headers())
            if res.status_code != 200:
                return {"ok": False, "status": res.status_code, "error": res.text[:400]}
            data = res.json()
            return data if isinstance(data, dict) else None
    except Exception as e:
        return {"ok": False, "error": str(e)}


def poll_lobster_run(run_id: str, *, max_wait_sec: float | None = None) -> dict[str, Any] | None:
    base = str(settings.LOBSTER_AGENT_HTTP_URL or "").strip().rstrip("/")
    rid = str(run_id or "").strip()
    if not base or not rid:
        return None
    deadline = time.time() + float(max_wait_sec or settings.LOBSTER_POLL_MAX_SECONDS)
    last: dict[str, Any] | None = None
    interval = max(1.0, float(settings.LOBSTER_POLL_INTERVAL_SECONDS))
    try:
        with httpx.Client(timeout=30.0) as client:
            while time.time() < deadline:
                res = client.get(
                    f"{base}/api/lobster/status",
                    params={"runId": rid},
                    headers=_lobster_headers(),
                )
                if res.status_code != 200:
                    return {"ok": False, "status": res.status_code, "error": res.text[:400]}
                data = res.json()
                if isinstance(data, dict):
                    last = data
                    state = str(data.get("state") or data.get("status") or "").lower()
                    if state in ("done", "completed", "success", "failed", "error", "cancelled"):
                        return data
                time.sleep(interval)
        return last or {"ok": False, "error": "poll_timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def format_lobster_result(data: dict[str, Any] | None, task: str) -> tuple[str, dict[str, Any]]:
    if not data:
        return (
            f"Lobster 任务失败：服务未配置或不可用。任务：{task[:120]}",
            {"ok": False, "task": task},
        )
    if data.get("ok") is False and data.get("error"):
        return (f"Lobster 失败：{data['error']}", {"ok": False, "task": task})

    run_id = data.get("runId") or data.get("run_id")
    result = data.get("result")
    if isinstance(result, dict):
        answer = str(result.get("finalAnswer") or result.get("answer") or "").strip()
        engine = str(result.get("engine") or result.get("executionEngine") or "").strip()
        if answer:
            suffix = f"\n（引擎：{engine}）" if engine else ""
            return (f"Lobster 任务完成：\n{answer}{suffix}", {"ok": True, "runId": run_id, "task": task, "engine": engine or None})
    state = str(data.get("state") or data.get("status") or "")
    if state:
        return (f"Lobster 任务状态：{state}（runId={run_id}）", {"ok": True, "runId": run_id, "state": state})
    return (f"Lobster 已提交任务（runId={run_id}）", {"ok": True, "runId": run_id, "task": task})
