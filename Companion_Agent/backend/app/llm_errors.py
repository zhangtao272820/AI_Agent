"""辅模型（Judge / 记忆 / 摘要）失败分类与节流通知。"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AuxLlmIssue:
    code: str
    detail: str
    user_message: str


_lock = threading.Lock()
# code -> last emit monotonic time
_last_emit: dict[str, float] = {}
_pending: AuxLlmIssue | None = None

# 同类错误至少间隔这么久才再推 UI（秒）
_THROTTLE_SEC = 90.0


def classify_llm_error(ex: BaseException) -> AuxLlmIssue:
    """把 OpenAI SDK / HTTP 异常收成玩家可读的辅模型问题。"""
    text = str(ex or "")
    lower = text.lower()
    code = "aux_error"
    user = "后台裁决或记忆暂时不可用，本轮用本地规则继续。"

    body = ""
    for attr in ("body", "response", "message"):
        raw = getattr(ex, attr, None)
        if raw is None:
            continue
        body += f" {raw}"
    blob = f"{text} {body}"

    if "FreeTierOnly" in blob or "free quota exhausted" in blob.lower() or "AllocationQuota.FreeTierOnly" in blob:
        code = "FreeTierOnly"
        user = (
            "百炼免费额度已用尽（仅免费档）。"
            "请在控制台关闭「仅用免费额度」并充值，否则好感裁决与记忆会降级。"
        )
    elif "403" in blob or "forbidden" in lower:
        code = "http_403"
        user = "模型接口拒绝访问（403）。请检查密钥权限与额度；本轮裁决改用本地规则。"
    elif "429" in blob or "rate" in lower or "quota" in lower:
        code = "quota"
        user = "模型额度或限流不足。本轮裁决/记忆改用本地规则，稍后再试。"
    elif "401" in blob or "unauthorized" in lower or "invalid" in lower and "key" in lower:
        code = "auth"
        user = "模型密钥无效。请检查 DASHSCOPE_API_KEY；本轮用本地规则继续。"

    return AuxLlmIssue(code=code, detail=text[:240], user_message=user)


def note_aux_failure(ex: BaseException) -> AuxLlmIssue | None:
    """记录辅模型失败；若未节流则放入待推送队列，返回本次应通知的 issue。"""
    global _pending
    issue = classify_llm_error(ex)
    now = time.monotonic()
    with _lock:
        last = _last_emit.get(issue.code, 0.0)
        if now - last < _THROTTLE_SEC:
            return None
        _last_emit[issue.code] = now
        _pending = issue
        return issue


def consume_pending_aux_notice() -> dict[str, Any] | None:
    """取出并清空待推送通知（供回合结算写入 WS）。"""
    global _pending
    with _lock:
        issue = _pending
        _pending = None
    if not issue:
        return None
    return {
        "code": issue.code,
        "message": issue.user_message,
        "tone": "warn",
    }
