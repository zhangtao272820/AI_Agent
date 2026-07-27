"""从 ClawHive 平台拉取本 Agent 生效模型（runtime sync）。"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

AGENT_NAME = "Music_Agent"

_cache: dict[str, Any] = {"at": 0.0, "configured": False, "planner": "", "executor": "", "embedding": ""}


def _row_active(row: dict[str, Any]) -> bool:
    if row.get("platform_configured") is True:
        return True
    by = str(row.get("updated_by") or "").strip()
    return bool(by) and by not in ("seed", "system")


def _enabled() -> bool:
    url = str(os.getenv("CLAWHIVE_BACKEND_URL") or "").strip()
    token = str(os.getenv("CLAWHIVE_INTERNAL_TOKEN") or os.getenv("AGENT_INTERNAL_TOKEN") or "").strip()
    sync = str(os.getenv("CLAWHIVE_CONFIG_SYNC") or "1").strip()
    return bool(url and token) and sync != "0"


def _ttl_sec() -> float:
    try:
        return max(5.0, min(600.0, float(os.getenv("CLAWHIVE_CONFIG_SYNC_TTL_MS", "60000")) / 1000.0))
    except ValueError:
        return 60.0


def refresh_platform_model_cache(force: bool = False, *, agent_name: str = AGENT_NAME) -> None:
    if not _enabled():
        return
    now = time.time()
    if not force and now - float(_cache.get("at") or 0) < _ttl_sec():
        return
    base = str(os.getenv("CLAWHIVE_BACKEND_URL") or "").strip().rstrip("/")
    token = str(os.getenv("CLAWHIVE_INTERNAL_TOKEN") or os.getenv("AGENT_INTERNAL_TOKEN") or "").strip()
    url = f"{base}/api/internal/agent-config"
    req = urllib.request.Request(
        url,
        headers={"x-clawhive-internal-token": token, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
            payload = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
        agents = payload.get("agents") if isinstance(payload, dict) else []
        row = next(
            (a for a in (agents or []) if str(a.get("agent_name") or a.get("name") or "") == agent_name),
            None,
        )
        if isinstance(row, dict) and _row_active(row):
            _cache["configured"] = True
            _cache["planner"] = str(row.get("model_planner") or "").strip()
            _cache["executor"] = str(row.get("model_executor") or "").strip()
            _cache["embedding"] = str(row.get("model_embedding") or "").strip()
        else:
            _cache["configured"] = False
            _cache["planner"] = ""
            _cache["executor"] = ""
            _cache["embedding"] = ""
        _cache["at"] = now
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        _cache["at"] = now


def get_platform_models(*, agent_name: str = AGENT_NAME) -> dict[str, str]:
    refresh_platform_model_cache(agent_name=agent_name)
    return {
        "planner": str(_cache.get("planner") or "").strip(),
        "executor": str(_cache.get("executor") or "").strip(),
        "embedding": str(_cache.get("embedding") or "").strip(),
    }


def apply_platform_models(settings: Any, *, agent_name: str = AGENT_NAME) -> Any:
    """将平台 executor/planner 覆盖到 Settings（仅模型字段）。"""
    refresh_platform_model_cache(agent_name=agent_name)
    if not _cache.get("configured"):
        return settings
    executor = str(_cache.get("executor") or "").strip()
    if executor and hasattr(settings, "openai_model"):
        settings.openai_model = executor
    return settings
