"""P0：Admin 工具经验反馈门控（confirm / revoke）。"""
from __future__ import annotations

import os
from typing import Any


def _pg_ready() -> bool:
    from app.core.admin_pg_store import agent_database_url, is_admin_pg_storage

    return is_admin_pg_storage() and bool(agent_database_url())


def _connect():
    from app.core.admin_pg_store import _connect as pg_connect

    return pg_connect()


def _normalize_question_key(question: str) -> str:
    import re

    s = str(question or "").strip().lower()
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[，,。.;；:：!?？]", "", s)
    return s[:120]


def _feedback_gated() -> bool:
    return os.getenv("ADM_TOOL_EXPERIENCE_REQUIRE_FEEDBACK", "1").strip().lower() not in ("0", "false", "no")


def handle_admin_feedback(
    *,
    score: int,
    question: str,
    run_id: str | None = None,
    artifact: dict[str, Any] | None = None,
) -> str:
    if not _pg_ready():
        return "skipped"
    status = "confirmed" if score > 0 else "revoked"
    question_norm = _normalize_question_key(question)
    run_id = (run_id or "").strip()[:80] or None
    with _connect() as conn:
        if run_id:
            conn.execute(
                "UPDATE adm_tool_experience SET status = %s WHERE run_id = %s",
                (status, run_id),
            )
        elif question_norm:
            conn.execute(
                """
                UPDATE adm_tool_experience SET status = %s
                WHERE question_norm = %s AND id = (
                  SELECT id FROM adm_tool_experience WHERE question_norm = %s ORDER BY id DESC LIMIT 1
                )
                """,
                (status, question_norm, question_norm),
            )
        conn.commit()
    if score > 0 and run_id and _feedback_gated():
        from app.core.tool_experience_store import hydrate_admin_tool_experience_cache

        hydrate_admin_tool_experience_cache()
    return status


def revoke_admin_artifacts(run_id: str) -> int:
    if not _pg_ready():
        return 0
    rid = (run_id or "").strip()[:80]
    if not rid:
        return 0
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE adm_tool_experience SET status = 'revoked' WHERE run_id = %s",
            (rid,),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0)
