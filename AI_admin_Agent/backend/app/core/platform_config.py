"""从 ClawHive 拉取 AI_admin_Agent 模型配置。"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

_AGENT_NAME = "AI_admin_Agent"
_cache: dict[str, object] = {"at": 0.0, "configured": False, "model_executor": "", "model_planner": ""}


def _row_active(row: dict) -> bool:
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


def refresh_platform_model_cache(force: bool = False) -> None:
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
            (
                a
                for a in (agents or [])
                if str(a.get("agent_name") or a.get("name") or "") == _AGENT_NAME
            ),
            None,
        )
        if isinstance(row, dict) and _row_active(row):
            _cache["configured"] = True
            _cache["model_executor"] = str(row.get("model_executor") or "").strip()
            _cache["model_planner"] = str(row.get("model_planner") or "").strip()
        else:
            _cache["configured"] = False
            _cache["model_executor"] = ""
            _cache["model_planner"] = ""
        _cache["at"] = now
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        _cache["at"] = now


def effective_model_name(default: str) -> str:
    refresh_platform_model_cache()
    if not _cache.get("configured"):
        return default
    override = str(_cache.get("model_executor") or _cache.get("model_planner") or "").strip()
    return override or default
