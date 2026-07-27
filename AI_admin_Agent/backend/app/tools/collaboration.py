"""企业协作通知：企业微信 / 钉钉。"""
from __future__ import annotations

import os

from app.core.webhook_notify import send_webhook_notification, webhook_configured
from app.tools.common import _tool_err, _tool_ok


def _post_json_webhook(url: str, payload: dict, fmt: str) -> tuple[bool, str]:
    import json
    import urllib.request

    if not url:
        return False, "url_empty"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "AI_admin_Agent/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(os.getenv("ADMIN_WEBHOOK_TIMEOUT", "8"))) as resp:
            body = resp.read().decode("utf-8", errors="replace")[:200]
            return 200 <= resp.status < 300, body
    except Exception as exc:
        return False, str(exc)


def send_wecom_message(title: str, content: str) -> dict:
    """发送企业微信群机器人消息（ADMIN_WEBHOOK_URL + ADMIN_WEBHOOK_FORMAT=wecom）。"""
    url = str(os.getenv("ADMIN_WEBHOOK_URL") or os.getenv("ADMIN_WECOM_WEBHOOK_URL") or "").strip()
    if not url:
        return _tool_err("未配置企业微信 Webhook（ADMIN_WEBHOOK_URL 或 ADMIN_WECOM_WEBHOOK_URL）。", code="wecom_not_configured")
    text = f"{title}\n{content}".strip()[:2048]
    ok, detail = _post_json_webhook(url, {"msgtype": "text", "text": {"content": text}}, "wecom")
    if not ok:
        return _tool_err(f"企业微信发送失败：{detail}", code="wecom_send_failed")
    return _tool_ok(f"已通过企业微信发送：{title}", data={"channel": "wecom"}, code="sent")


def send_dingtalk_message(title: str, content: str) -> dict:
    """发送钉钉群机器人 Markdown 消息。"""
    url = str(os.getenv("ADMIN_DINGTALK_WEBHOOK_URL") or "").strip()
    if not url:
        return _tool_err("未配置钉钉 Webhook（ADMIN_DINGTALK_WEBHOOK_URL）。", code="dingtalk_not_configured")
    md = f"### {title}\n\n{content}".strip()[:2048]
    ok, detail = _post_json_webhook(
        url,
        {"msgtype": "markdown", "markdown": {"title": title[:64], "text": md}},
        "dingtalk",
    )
    if not ok:
        return _tool_err(f"钉钉发送失败：{detail}", code="dingtalk_send_failed")
    return _tool_ok(f"已通过钉钉发送：{title}", data={"channel": "dingtalk"}, code="sent")


def send_team_notification(title: str, message: str, channel: str = "auto") -> dict:
    """按 channel 发送：auto | wecom | dingtalk | feishu | webhook。"""
    ch = str(channel or "auto").strip().lower()
    if ch == "wecom":
        return send_wecom_message(title, message)
    if ch == "dingtalk":
        return send_dingtalk_message(title, message)
    if ch == "feishu":
        return send_feishu_message(title, message)
    if ch == "auto" and os.getenv("ADMIN_DINGTALK_WEBHOOK_URL"):
        return send_dingtalk_message(title, message)
    if ch == "auto":
        from app.core.feishu_notify import feishu_webhook_configured, send_feishu_webhook

        if feishu_webhook_configured():
            return send_feishu_webhook(title, message)
    if webhook_configured() or os.getenv("ADMIN_WECOM_WEBHOOK_URL"):
        ok = send_webhook_notification(title, message)
        if ok:
            return _tool_ok(f"已发送通知：{title}", data={"channel": "webhook"}, code="sent")
    return _tool_err("未配置任何协作通知通道。", code="notify_not_configured")


def send_feishu_message(title: str, content: str) -> dict:
    """发送飞书群机器人消息（ADMIN_FEISHU_WEBHOOK_URL）。"""
    from app.core.feishu_notify import send_feishu_webhook

    return send_feishu_webhook(title, content)
