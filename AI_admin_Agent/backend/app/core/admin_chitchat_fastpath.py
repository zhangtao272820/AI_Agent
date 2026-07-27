"""
Admin 日常问候 / 闲聊快路径：跳过 NLU 双调用 + 规划 + 汇总模型。
"""
from __future__ import annotations

import os

from app.core.admin_env_modes import is_admin_chitchat_fastpath_enabled
from app.core.admin_text_sensitivity import has_time_signal

_GREETINGS = frozenset(
    {
        "你好",
        "您好",
        "hi",
        "hello",
        "hey",
        "在吗",
        "在么",
        "在不在",
        "嗨",
        "早上好",
        "下午好",
        "晚上好",
        "早安",
        "午安",
        "晚安",
    }
)

_THANKS = frozenset({"谢谢", "感谢", "多谢", "thanks", "thank you", "thx"})

_BYE = frozenset({"再见", "拜拜", "bye", "goodbye", "回见"})


def _normalize_short(text: str) -> str:
    s = str(text or "").strip().lower()
    while s and s[-1] in "!！?？.。~":
        s = s[:-1]
    return s.strip()


def is_admin_chitchat_message(text: str) -> bool:
    """极短、无时间/工具信号的问候/致谢/告别。"""
    raw = str(text or "").strip()
    if not raw or len(raw) > 20:
        return False
    if has_time_signal(raw):
        return False
    norm = _normalize_short(raw)
    if not norm:
        return False
    if norm in _GREETINGS or norm in _THANKS or norm in _BYE:
        return True
    # 「你好呀」「您好！」等极短变体
    for base in _GREETINGS:
        if norm.startswith(base) and len(norm) <= len(base) + 2:
            return True
    return False


def chitchat_understanding_stub() -> dict:
    return {
        "intent": "其他",
        "confidence": 0.98,
        "rationale": "日常问候/闲聊",
        "admin_scenario": None,
        "chitchat": True,
        "needs_clarification": False,
        "slots": {},
        "confirm_action": {"is_confirmation": False, "decision": "", "action_id": 0},
    }


def chitchat_reply(user_message: str) -> str:
    norm = _normalize_short(user_message)
    if norm in _THANKS or any(norm.startswith(x) for x in _THANKS):
        return "不客气！有需要随时叫我。"
    if norm in _BYE or any(norm.startswith(x) for x in _BYE):
        return "好的，再见！需要帮忙时随时回来。"
    if norm in {"早上好", "早安"}:
        return "早上好！我是你的个人助理，今天需要我帮你安排日程、查邮件或看天气吗？"
    if norm in {"下午好", "午安"}:
        return "下午好！有什么办公或生活上的事需要我帮忙？"
    if norm in {"晚上好", "晚安"}:
        return "晚上好！若还有未处理的待办或明日日程，我可以帮你整理。"
    return "你好！我是你的个人助理，可以帮你处理邮件、日程、待办、天气和路线等。有什么需要？"


CHITCHAT_MARKER = "CHITCHAT:"
