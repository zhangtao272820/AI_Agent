"""Webhook 推送（企业微信/钉钉/自定义 HTTP）。"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)


def webhook_configured() -> bool:
    return bool(str(os.getenv("ADMIN_WEBHOOK_URL") or "").strip())


def _webhook_format() -> str:
    return str(os.getenv("ADMIN_WEBHOOK_FORMAT") or "generic").strip().lower()


def _build_payload(title: str, message: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    fmt = _webhook_format()
    if fmt == "wecom":
        content = f"{title}\n{message}".strip()
        return {"msgtype": "text", "text": {"content": content[:2048]}}
    if fmt == "dingtalk":
        content = f"### {title}\n\n{message}".strip()
        return {"msgtype": "markdown", "markdown": {"title": title[:64], "text": content[:2048]}}
    body: dict[str, Any] = {
        "title": title,
        "message": message,
        "source": "ai_admin_agent",
    }
    if extra:
        body.update(extra)
    return body


def send_webhook_notification(title: str, message: str, extra: dict[str, Any] | None = None) -> bool:
    url = str(os.getenv("ADMIN_WEBHOOK_URL") or "").strip()
    if not url:
        return False
    payload = _build_payload(title, message, extra)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "AI_admin_Agent/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(os.getenv("ADMIN_WEBHOOK_TIMEOUT", "8"))) as resp:
            return 200 <= resp.status < 300
    except Exception as exc:
        logger.warning("webhook notify failed: %s", exc)
        return False
