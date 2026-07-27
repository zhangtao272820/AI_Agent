"""Manager 用户画像读取（manager-user-profiles.json）。"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any


def _sanitize_user_id(user_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "", str(user_id or "").strip())[:64]


def _policy_dirs() -> list[Path]:
    dirs: list[Path] = []
    env = str(os.getenv("MANAGER_POLICY_DIR") or "").strip()
    if env:
        dirs.append(Path(env))
    here = Path(__file__).resolve()
    candidates = [
        here.parents[3] / "Manager_Agent" / ".data",
        here.parents[2] / ".." / "Manager_Agent" / ".data",
        Path.cwd() / "Manager_Agent" / ".data",
    ]
    for c in candidates:
        try:
            p = c.resolve()
            if p not in dirs:
                dirs.append(p)
        except OSError:
            continue
    return dirs


def _profiles_file() -> Path | None:
    name = "manager-user-profiles.json"
    for d in _policy_dirs():
        f = d / name
        if f.is_file():
            return f
    return None


def _load_profiles() -> dict[str, Any]:
    f = _profiles_file()
    if not f:
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _merge_profile(session: dict | None, user: dict | None) -> dict | None:
    if not session and not user:
        return None
    if not user:
        return session
    if not session:
        return user
    intent_counts = dict(user.get("intentCounts") or {})
    for k, v in (session.get("intentCounts") or {}).items():
        intent_counts[k] = int(intent_counts.get(k, 0)) + int(v or 0)
    summaries = list(
        dict.fromkeys(
            list(user.get("recentSuccessSummaries") or [])
            + list(session.get("recentSuccessSummaries") or [])
        )
    )[-5:]
    return {
        "sessionId": session.get("sessionId"),
        "userId": user.get("userId") or session.get("userId"),
        "runCount": int(user.get("runCount") or 0) + int(session.get("runCount") or 0),
        "successCount": int(user.get("successCount") or 0) + int(session.get("successCount") or 0),
        "intentCounts": intent_counts,
        "lastIntent": session.get("lastIntent") or user.get("lastIntent"),
        "lastPath": session.get("lastPath") or user.get("lastPath"),
        "prefersRag": bool(session.get("prefersRag") or user.get("prefersRag")),
        "prefersDb": bool(session.get("prefersDb") or user.get("prefersDb")),
        "recentSuccessSummaries": summaries,
    }


def load_manager_profile(session_id: str | None, user_id: str | None = None) -> dict | None:
    all_profiles = _load_profiles()
    if not all_profiles:
        return None
    sid = str(session_id or "").strip()
    uid = _sanitize_user_id(user_id or "")
    session_prof = all_profiles.get(f"session:{sid}") if sid else None
    user_prof = all_profiles.get(f"user:{uid}") if uid else None
    if not isinstance(session_prof, dict):
        session_prof = all_profiles.get(sid) if sid else None
        if isinstance(session_prof, dict):
            session_prof = {**session_prof, "sessionId": sid}
    if not isinstance(session_prof, dict):
        session_prof = None
    if not isinstance(user_prof, dict):
        user_prof = None
    return _merge_profile(session_prof, user_prof)


def format_manager_profile_block(session_id: str | None, user_id: str | None = None) -> str:
    profile = load_manager_profile(session_id, user_id)
    if not profile or int(profile.get("runCount") or 0) < 1:
        return ""
    intent_counts = profile.get("intentCounts") or {}
    top = sorted(intent_counts.items(), key=lambda x: -int(x[1] or 0))[:4]
    top_text = "，".join(f"{k}×{v}" for k, v in top)
    lines = ["### 总管用户画像（跨 Agent 记忆）"]
    if profile.get("userId"):
        lines.append(f"- 用户 ID：{profile['userId']}")
    lines.append(
        f"- 累计对话 {profile.get('runCount', 0)} 次，成功 {profile.get('successCount', 0)} 次"
    )
    if top_text:
        lines.append(f"- 常用意图：{top_text}")
    if profile.get("lastIntent"):
        lines.append(f"- 最近一次意图：{profile['lastIntent']}")
    if profile.get("prefersRag"):
        lines.append("- 历史倾向：知识库/RAG")
    if profile.get("prefersDb"):
        lines.append("- 历史倾向：数据库/结构化查询")
    summaries = profile.get("recentSuccessSummaries") or []
    if summaries:
        lines.append("- 近期成功任务摘要：")
        for s in summaries[-3:]:
            lines.append(f"  - {str(s)[:120]}")
    return "\n".join(lines)
