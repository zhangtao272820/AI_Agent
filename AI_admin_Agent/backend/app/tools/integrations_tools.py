"""批次 6：集成清单查询。"""
from __future__ import annotations

from app.core.integrations_registry import get_integrations_payload
from app.tools.common import _tool_ok


def show_integrations_status() -> dict:
    """列出已配置与待配置的集成项（对应 GET /api/integrations）。"""
    payload = get_integrations_payload()
    summary = payload.get("summary") or {}
    lines = [
        "**集成配置状态**（测试项目：已剔除短信/付费搜索）",
        f"- 已就绪：{summary.get('configured', 0)}/{summary.get('total', 0)}",
    ]
    if summary.get("requiredMissing"):
        lines.append(f"- ⚠ 必填缺失：{summary['requiredMissing']} 项")

    pending = payload.get("pending") or []
    if pending:
        lines.append("")
        lines.append("**待配置（需注册/填 .env）**")
        for item in pending[:12]:
            name = str(item.get("name") or item.get("id") or "")
            hint = str(item.get("docHint") or "")
            env = item.get("env") or []
            env_hint = env[0] if env else ""
            lines.append(f"- {name}：{hint or env_hint}")

    configured = payload.get("configured") or []
    if configured:
        lines.append("")
        lines.append("**已就绪**")
        for item in configured[:10]:
            lines.append(f"- {item.get('name') or item.get('id')}")

    lines.append("")
    lines.append("完整 JSON：`GET /api/integrations`")
    return _tool_ok("\n".join(lines), data=payload, code="integrations_ok")
