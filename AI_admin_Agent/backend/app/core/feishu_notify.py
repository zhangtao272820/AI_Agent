"""飞书群机器人 Webhook。"""
from __future__ import annotations

import json
import os
import urllib.request

from app.core.config import settings
from app.tools.common import _tool_err, _tool_ok


def feishu_webhook_configured() -> bool:
    return bool(str(settings.ADMIN_FEISHU_WEBHOOK_URL or os.getenv("ADMIN_FEISHU_WEBHOOK_URL") or "").strip())


def send_feishu_webhook(title: str, content: str) -> dict:
    url = str(settings.ADMIN_FEISHU_WEBHOOK_URL or "").strip()
    if not url:
        return _tool_err("未配置飞书 Webhook（ADMIN_FEISHU_WEBHOOK_URL）。", code="feishu_not_configured")

    text = f"{title}\n{content}".strip()[:4000]
    payload = {"msg_type": "text", "content": {"text": text}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
            if body.get("StatusCode") == 0 or body.get("code") == 0:
                return _tool_ok(f"已通过飞书发送：{title}", data={"channel": "feishu"}, code="sent")
            return _tool_err(f"飞书返回：{body}", code="feishu_api_error")
    except Exception as exc:
        return _tool_err(f"飞书发送失败：{exc}", code="feishu_send_failed")
