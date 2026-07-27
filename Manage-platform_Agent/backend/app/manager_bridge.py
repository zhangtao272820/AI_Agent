import asyncio
import json
import time
import uuid
from typing import Any
from .config import get_settings

settings = get_settings()


def _manager_ws_url() -> str:
    host = str(settings.manager_agent_host or "localhost").strip()
    port = str(settings.manager_agent_port or "13106").strip()
    return f"ws://{host}:{port}/api/manager-ws"


def _ws_context(
    *,
    user_id: str | None = None,
    tenant_id: str | None = None,
    trace_id: str | None = None,
) -> dict[str, str]:
    out: dict[str, str] = {}
    if user_id:
        out["userId"] = user_id
    if tenant_id:
        out["tenantId"] = tenant_id
    if trace_id:
        out["traceId"] = trace_id
    return out


async def run_manager_chat(
    task: str,
    *,
    user_id: str | None = None,
    tenant_id: str | None = None,
    trace_id: str | None = None,
    session_id: str | None = None,
    timeout_sec: float = 180.0,
) -> dict[str, Any]:
    """通过 Manager WebSocket 执行一轮编排，供平台任务队列转发。"""
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("缺少 websockets 依赖，请 pip install websockets") from exc

    sid = session_id or f"platform_{uuid.uuid4().hex[:12]}"
    ws_url = _manager_ws_url()
    ws_token = str(settings.clawhive_internal_token or "").strip()
    if ws_token and "token=" not in ws_url:
        sep = "&" if "?" in ws_url else "?"
        ws_url = f"{ws_url}{sep}token={ws_token}"
    final_text = ""
    run_id = ""
    events: list[dict[str, Any]] = []
    error = ""
    phase_timeline: list[dict[str, Any]] = []
    token_summary: dict[str, Any] | None = None
    wall_clock_ms = 0

    ctx = _ws_context(user_id=user_id, tenant_id=tenant_id, trace_id=trace_id)
    async with websockets.connect(ws_url, open_timeout=12, close_timeout=5) as ws:
        resume_payload: dict[str, Any] = {"type": "resume", "sessionId": sid, **ctx}
        chat_payload: dict[str, Any] = {
            "type": "chat",
            "sessionId": sid,
            **ctx,
            "text": task,
            "forceIntent": "auto",
        }
        if ws_token:
            resume_payload["wsToken"] = ws_token
            chat_payload["wsToken"] = ws_token
        await ws.send(json.dumps(resume_payload))
        await ws.send(json.dumps(chat_payload))
        deadline = time.monotonic() + timeout_sec
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(1.0, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            event = str(msg.get("event") or "")
            data = msg.get("data")
            if msg.get("runId"):
                run_id = str(msg["runId"])
            events.append({"event": event, "data": data, "runId": run_id})
            if event == "phase_timeline" and isinstance(data, dict):
                phase_timeline = list(data.get("phaseTimeline") or data.get("phase_timeline") or [])
                token_summary = data.get("tokenSummary") or data.get("token_summary")
                wall_clock_ms = int(data.get("wallClockMs") or data.get("wall_clock_ms") or 0)
            if event == "run_metrics" and isinstance(data, dict):
                token_summary = data.get("tokenSummary") or data.get("token_summary") or token_summary
                wall_clock_ms = int(data.get("wallClockMs") or data.get("wall_clock_ms") or wall_clock_ms)
            if event == "error":
                error = str(data or "manager error")
            if event == "final":
                final_text = str(data or "")
                break

    ok = bool(final_text.strip()) and not error
    return {
        "ok": ok,
        "session_id": sid,
        "run_id": run_id,
        "final": final_text,
        "error": error or None,
        "manager_ws": ws_url,
        "event_count": len(events),
        "phase_timeline": phase_timeline,
        "token_summary": token_summary,
        "wall_clock_ms": wall_clock_ms,
    }


def dispatch_manager_task_sync(
    task: str,
    user_id: str | None = None,
    tenant_id: str | None = None,
    trace_id: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    return asyncio.run(
        run_manager_chat(task, user_id=user_id, tenant_id=tenant_id, trace_id=trace_id, session_id=session_id)
    )
