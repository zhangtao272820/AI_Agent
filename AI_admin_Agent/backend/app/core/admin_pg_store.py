"""Admin 短期会话 PG 存储（adm_session_turns / adm_session_task_contexts）。"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row


def admin_storage_backend() -> str:
    return os.getenv("ADMIN_STORAGE_BACKEND", "sqlite").strip().lower()


def is_admin_pg_storage() -> bool:
    return admin_storage_backend() in ("postgres", "pg", "dual")


def is_admin_pg_primary() -> bool:
    return admin_storage_backend() in ("postgres", "pg")


def is_admin_dual_storage() -> bool:
    return admin_storage_backend() == "dual"


def agent_database_url() -> str:
    return (
        os.getenv("AGENT_DATABASE_URL")
        or os.getenv("CLAWHIVE_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()


def _connect():
    url = agent_database_url()
    if not url:
        raise RuntimeError("AGENT_DATABASE_URL not configured")
    return psycopg.connect(url.replace("postgresql+psycopg2:", "postgresql:"), row_factory=dict_row)


def append_turn_pg(session_id: str, role: str, content: str) -> None:
    sid = (session_id or "default").strip() or "default"
    text = (content or "").strip()
    if not text:
        return
    with _connect() as conn:
        conn.execute(
            "INSERT INTO adm_session_turns (session_id, role, content) VALUES (%s, %s, %s)",
            (sid, role, text),
        )
        conn.commit()


def count_turns_pg(session_id: str) -> int:
    sid = (session_id or "default").strip() or "default"
    with _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM adm_session_turns WHERE session_id = %s",
            (sid,),
        ).fetchone()
        return int(row["cnt"] if row else 0)


def load_turns_pg(session_id: str, limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
    sid = (session_id or "default").strip() or "default"
    sql = "SELECT id, session_id, role, content, created_at FROM adm_session_turns WHERE session_id = %s ORDER BY id ASC"
    params: list[Any] = [sid]
    if limit is not None:
        sql += " LIMIT %s OFFSET %s"
        params.extend([limit, offset])
    with _connect() as conn:
        return list(conn.execute(sql, params).fetchall())


def load_task_context_pg(session_id: str) -> dict[str, Any]:
    sid = (session_id or "default").strip() or "default"
    with _connect() as conn:
        row = conn.execute(
            "SELECT context_json FROM adm_session_task_contexts WHERE session_id = %s",
            (sid,),
        ).fetchone()
        if not row:
            return {}
        payload = row.get("context_json") or {}
        return payload if isinstance(payload, dict) else {}


def save_task_context_pg(session_id: str, ctx: dict[str, Any]) -> None:
    sid = (session_id or "default").strip() or "default"
    now = datetime.now(timezone.utc)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO adm_session_task_contexts (session_id, context_json, updated_at)
            VALUES (%s, %s::jsonb, %s)
            ON CONFLICT (session_id) DO UPDATE SET context_json = EXCLUDED.context_json, updated_at = EXCLUDED.updated_at
            """,
            (sid, json.dumps(ctx, ensure_ascii=False), now),
        )
        conn.commit()


def load_recent_turns_pg(session_id: str, limit: int) -> list[dict[str, Any]]:
    sid = (session_id or "default").strip() or "default"
    sql = (
        "SELECT id, session_id, role, content, created_at FROM adm_session_turns "
        "WHERE session_id = %s ORDER BY id DESC LIMIT %s"
    )
    with _connect() as conn:
        rows = list(conn.execute(sql, (sid, limit)).fetchall())
    return list(reversed(rows))


def replace_last_assistant_turn_pg(session_id: str, content: str) -> bool:
    sid = (session_id or "default").strip() or "default"
    text = (content or "").strip()
    if not text:
        return False
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id FROM adm_session_turns
            WHERE session_id = %s AND role = 'assistant'
            ORDER BY id DESC LIMIT 1
            """,
            (sid,),
        ).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO adm_session_turns (session_id, role, content) VALUES (%s, %s, %s)",
                (sid, "assistant", text),
            )
        else:
            conn.execute(
                "UPDATE adm_session_turns SET content = %s WHERE id = %s",
                (text, row["id"]),
            )
        conn.commit()
    return True


def trim_turns_pg(session_id: str, keep_last: int) -> bool:
    sid = (session_id or "default").strip() or "default"
    keep = max(1, int(keep_last))
    with _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM adm_session_turns WHERE session_id = %s",
            (sid,),
        ).fetchone()
        total = int(row["cnt"] if row else 0)
        if total <= keep:
            return False
        conn.execute(
            """
            DELETE FROM adm_session_turns
            WHERE session_id = %s
              AND id IN (
                SELECT id FROM adm_session_turns
                WHERE session_id = %s
                ORDER BY id ASC
                LIMIT %s
              )
            """,
            (sid, sid, total - keep),
        )
        conn.commit()
    return True


def ping_admin_pg() -> bool:
    if not is_admin_pg_storage() or not agent_database_url():
        return False
    try:
        with _connect() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False
