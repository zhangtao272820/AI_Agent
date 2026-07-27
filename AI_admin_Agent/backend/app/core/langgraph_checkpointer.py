"""LangGraph Checkpointer：memory | postgres（Phase 5）。"""
from __future__ import annotations

import os

from langgraph.checkpoint.memory import MemorySaver

_memory_saver: MemorySaver | None = None
_postgres_saver = None
_postgres_ready = False


def _mode() -> str:
    return os.getenv("ADMIN_LANGGRAPH_CHECKPOINTER", "0").strip().lower()


def is_admin_langgraph_checkpointer_enabled() -> bool:
    return _mode() not in ("0", "false", "off", "")


def init_admin_postgres_checkpointer() -> bool:
    global _postgres_saver, _postgres_ready
    if _mode() not in ("postgres", "pg"):
        return False
    url = (
        os.getenv("AGENT_DATABASE_URL")
        or os.getenv("CLAWHIVE_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()
    if not url:
        return False
    try:
        from langgraph.checkpoint.postgres import PostgresSaver

        saver = PostgresSaver.from_conn_string(url.replace("postgresql+psycopg2:", "postgresql:"))
        saver.setup()
        _postgres_saver = saver
        _postgres_ready = True
        return True
    except Exception:
        _postgres_saver = None
        _postgres_ready = False
        return False


def get_admin_langgraph_checkpointer():
    global _memory_saver
    if not is_admin_langgraph_checkpointer_enabled():
        return None
    if _mode() in ("postgres", "pg"):
        return _postgres_saver
    if _memory_saver is None:
        _memory_saver = MemorySaver()
    return _memory_saver


def resolve_langgraph_thread_id(session_id: str | None, trace_id: str | None = None) -> str | None:
    if not is_admin_langgraph_checkpointer_enabled():
        return None
    sid = str(session_id or "").strip()
    if _mode() in ("postgres", "pg") and sid:
        return f"sess-{sid}"
    run = str(trace_id or "").strip()
    if run:
        return f"run-{run}"
    return f"sess-{sid}" if sid else None


def build_graph_invoke_config(session_id: str | None, trace_id: str | None = None) -> dict | None:
    tid = resolve_langgraph_thread_id(session_id, trace_id)
    if not tid:
        return None
    return {"configurable": {"thread_id": tid}}


def checkpointer_status() -> dict:
    return {
        "mode": _mode(),
        "enabled": is_admin_langgraph_checkpointer_enabled(),
        "postgresReady": _postgres_ready,
    }
