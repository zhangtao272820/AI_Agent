"""Batch 0 smoke: tools registry, memory context, playbook loader (no LLM)."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Ensure backend on path
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("ADMIN_LOAD_PLAYBOOK", "1")
os.environ.setdefault("ADMIN_AUTO_LEARN_PREFS", "1")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    from app.tools.registry import AVAILABLE_TOOLS, RISKY_TOOLS

    assert_true(len(AVAILABLE_TOOLS) >= 30, f"expected >=30 tools, got {len(AVAILABLE_TOOLS)}")
    assert_true("list_tasks" in AVAILABLE_TOOLS, "list_tasks missing")
    assert_true("add_event" in RISKY_TOOLS, "add_event should be risky")

    from app.tools.tasks import add_task, list_tasks

    title = "smoke-batch0-task"
    add_task(title, "batch0 smoke")
    listed = list_tasks()
    text = listed.get("human_message", "") if isinstance(listed, dict) else str(listed)
    assert_true(title in text, "add_task not reflected in list_tasks")

    from app.core.user_preferences import learn_weather_city, format_preferences_block

    with tempfile.TemporaryDirectory() as tmp:
        os.environ["ADMIN_AUTO_LEARN_PREFS"] = "1"
        from app.core import user_preferences as up

        orig = up._prefs_file
        up._prefs_file = lambda: Path(tmp) / "prefs.json"  # type: ignore
        learn_weather_city("smoke", "上海")
        block = format_preferences_block("smoke")
        assert_true("上海" in block, "weather city not in preferences block")
        up._prefs_file = orig  # type: ignore

    from app.core.playbook_loader import load_playbook_body, load_playbook_section

    body = load_playbook_body("intent_routing")
    assert_true(len(body) > 50, "intent_routing playbook empty")
    section = load_playbook_section("task_planning", "ToolCatalog")
    assert_true("list_tasks" in section, "ToolCatalog section missing list_tasks")

    from app.core.memory_context import build_memory_context

    ctx = build_memory_context("default")
    assert_true(isinstance(ctx, str), "build_memory_context should return str")

    from app.core.admin_playbook_prompts import get_planning_rules

    rules = get_planning_rules()
    assert_true(len(rules) > 20, "planning rules empty")

    print("smoke: admin-batch0 ok")


if __name__ == "__main__":
    main()
