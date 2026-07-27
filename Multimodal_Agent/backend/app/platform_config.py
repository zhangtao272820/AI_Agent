"""从 ClawHive 平台拉取本 Agent 生效模型（能力层 runtime sync）。"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

AGENT_NAME = "Multimodal_Agent"

_cache: dict[str, Any] = {"at": 0.0, "payload": None}

_ENV_TO_SETTINGS: dict[str, str] = {
    "QWEN_VL_MODEL": "qwen_vl_model",
    "QWEN_HELPER_MODEL": "qwen_helper_model",
    "QWEN_ASR_MODEL": "qwen_asr_model",
    "QWEN_TEXT_MODEL": "qwen_text_model",
    "OPENAI_MODEL": "openai_model",
}


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
        _cache["payload"] = payload if isinstance(payload, dict) else {}
        _cache["at"] = now
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        _cache["at"] = now


def get_platform_models(*, agent_name: str = AGENT_NAME) -> dict[str, str]:
    refresh_platform_model_cache(agent_name=agent_name)
    payload = _cache.get("payload") if isinstance(_cache.get("payload"), dict) else {}
    agents = payload.get("agents") if isinstance(payload, dict) else []
    row = next(
        (a for a in (agents or []) if str(a.get("agent_name") or a.get("name") or "") == agent_name),
        None,
    )
    if not isinstance(row, dict):
        return {"planner": "", "executor": "", "embedding": ""}
    return {
        "planner": str(row.get("model_planner") or "").strip(),
        "executor": str(row.get("model_executor") or "").strip(),
        "embedding": str(row.get("model_embedding") or "").strip(),
    }


def apply_platform_models(settings: Any, *, agent_name: str = AGENT_NAME) -> Any:
    refresh_platform_model_cache(agent_name=agent_name)
    payload = _cache.get("payload") if isinstance(_cache.get("payload"), dict) else {}
    if not payload:
        return settings

    agents = payload.get("agents") if isinstance(payload, dict) else []
    row = next(
        (a for a in (agents or []) if str(a.get("agent_name") or a.get("name") or "") == agent_name),
        None,
    )
    if not isinstance(row, dict):
        return settings

    if payload.get("capability_configured") and isinstance(row.get("resolved_env_models"), dict):
        for env_key, attr in _ENV_TO_SETTINGS.items():
            val = str((row.get("resolved_env_models") or {}).get(env_key) or "").strip()
            if val and hasattr(settings, attr):
                setattr(settings, attr, val)
        return settings

    if not _row_active(row):
        return settings

    executor = str(row.get("model_executor") or "").strip()
    planner = str(row.get("model_planner") or "").strip()
    if executor:
        if hasattr(settings, "openai_model"):
            settings.openai_model = executor
        if hasattr(settings, "qwen_text_model"):
            settings.qwen_text_model = executor
    if planner and hasattr(settings, "qwen_helper_model"):
        settings.qwen_helper_model = planner
    return settings
