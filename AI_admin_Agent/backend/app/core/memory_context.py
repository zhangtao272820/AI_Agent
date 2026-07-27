"""
合并 DB 记忆、用户偏好、总管画像为 planning 可注入的 memories 块。
"""
from __future__ import annotations

from app.core.manager_profile import format_manager_profile_block
from app.core.user_preferences import format_preferences_block
from app.core.tool_experience_store import format_admin_experience_block
from app.tools.memory_tools import get_memories


def build_memory_context(
    session_id: str | None = None,
    user_id: str | None = None,
    user_message: str | None = None,
    *,
    suppress_experience_replay: bool = False,
) -> str:
    parts: list[str] = []
    db_mem = str(get_memories() or "").strip()
    if db_mem:
        parts.append(db_mem)
    if user_message and not suppress_experience_replay:
        exp = format_admin_experience_block(user_message)
        if exp:
            parts.append(exp)
    prefs = format_preferences_block(session_id)
    if prefs:
        parts.append(prefs)
    mgr = format_manager_profile_block(session_id, user_id)
    if mgr:
        parts.append(mgr)
    return "\n\n".join(parts).strip()
