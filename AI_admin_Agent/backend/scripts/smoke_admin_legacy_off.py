"""Admin-Legacy-Off：full 模式生产路径不调用 infer_intent_from_action 词表。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["ADMIN_NLU_MODE"] = "full"

from app.core.admin_manager_plan_llm import resolve_admin_intent_hint, understanding_from_manager_task


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


assert_true(
    resolve_admin_intent_hint({"intent_hint": "天气", "action_text": "查天津天气"}, "") == "天气",
    "intent_hint wins",
)
assert_true(
    resolve_admin_intent_hint({"tool_plan": [{"name": "get_weather", "args": {}}], "action_text": "x"}, "") == "天气",
    "tool_plan maps to weather",
)
assert_true(
    resolve_admin_intent_hint({"action_text": "查天津今日天气预报"}, "查天津今日天气预报") == "其他",
    "full mode must not regex-infer",
)
u = understanding_from_manager_task({"action_text": "查天津天气", "source": "manager"})
assert_true(u.get("intent") == "其他", "understanding_from_manager_task no legacy infer")

os.environ["ADMIN_NLU_MODE"] = "legacy"
assert_true(
    resolve_admin_intent_hint({"action_text": "查天津今日天气预报"}, "") == "天气",
    "legacy mode may infer",
)
del os.environ["ADMIN_NLU_MODE"]

print("smoke_admin_legacy_off: OK")
