"""Agent 链路 trace 日志（与 docs/agent-contract.md 对齐）。"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from app.core.admin_data_dir import admin_data_dir

SERVICE = "AI_admin_Agent"


def append_agent_trace_log(
    *,
    agent: str,
    path: str,
    trace_id: str | None = None,
    ok: bool | None = None,
    latency_ms: int | None = None,
    detail: str | None = None,
) -> None:
    if os.getenv("MANAGER_AGENT_TRACE", "1").strip() == "0":
        return
    file = os.getenv("AGENT_TRACE_LOG_PATH", "").strip() or str(admin_data_dir() / "agent-trace.jsonl")
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "service": SERVICE,
        "agent": agent,
        "path": path,
        "trace_id": trace_id,
        "ok": ok,
        "latency_ms": latency_ms,
        "detail": detail,
    }
    try:
        Path(file).parent.mkdir(parents=True, exist_ok=True)
        with open(file, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass
