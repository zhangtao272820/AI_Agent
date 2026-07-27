"""Batch 6 smoke: integrations API, feishu/calendar multi, new tools."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    from app.core.integrations_registry import get_integrations_payload, parse_calendar_subscriptions
    from app.core.playbook_scenarios import detect_admin_scenario, preferred_tool_for_scenario
    from app.core.playbook_loader import load_playbook_section
    from app.core.feishu_notify import feishu_webhook_configured

    payload = get_integrations_payload()
    assert_true(payload.get("summary", {}).get("total", 0) >= 10, "integrations catalog")
    assert_true(isinstance(payload.get("pending"), list), "pending list")
    assert_true(parse_calendar_subscriptions() == {} or isinstance(parse_calendar_subscriptions(), dict), "calendar subs")

    assert_true(detect_admin_scenario("飞书发一下通知") == "feishu_notify", "feishu notify")
    assert_true(detect_admin_scenario("同步所有日历") == "calendar_multi", "calendar multi")
    assert_true(detect_admin_scenario("把待办加进任务列表") == "minutes_to_tasks", "minutes tasks")
    assert_true(detect_admin_scenario("集成还要配什么") == "integrations_status", "integrations")
    assert_true(detect_admin_scenario("发短信提醒我") == "reminder_notify", "reminder")

    pref = preferred_tool_for_scenario("integrations_status", "")
    assert_true(pref and pref["name"] == "show_integrations_status", "integrations tool")

    for sid in ("feishu_notify", "calendar_multi", "integrations_setup", "reminder_notify"):
        body = load_playbook_section(sid, "Planning")
        assert_true(len(body) > 15, f"{sid} playbook")

    assert_true(not feishu_webhook_configured(), "feishu default off")

    ids = {i["id"] for i in payload.get("items") or []}
    assert_true("aliyun_sms" not in ids, "paid sms removed")
    assert_true("sms_webhook" not in ids, "sms webhook removed")

    from app.tools.automation import sync_all_calendars, add_tasks_from_minutes
    from app.tools.collaboration import send_feishu_message
    from app.tools.integrations_tools import show_integrations_status

    sync = sync_all_calendars()
    assert_true(sync.get("code") == "calendar_subs_not_configured", "sync guard")

    add = add_tasks_from_minutes()
    assert_true(add.get("code") == "missing_input", "add tasks guard")

    feishu = send_feishu_message("t", "c")
    assert_true(feishu.get("code") == "feishu_not_configured", "feishu guard")

    status = show_integrations_status()
    assert_true(status.get("ok"), "integrations status tool")

    from app.tools.registry import AVAILABLE_TOOLS, RISKY_TOOLS

    for name in (
        "send_feishu_message",
        "sync_all_calendars",
        "add_tasks_from_minutes",
        "show_integrations_status",
    ):
        assert_true(name in AVAILABLE_TOOLS, f"{name} in registry")
    assert_true("show_integrations_status" not in RISKY_TOOLS, "status read-only")
    assert_true("sync_all_calendars" in RISKY_TOOLS, "sync risky")
    assert_true("add_tasks_from_minutes" in RISKY_TOOLS, "add tasks risky")

    print("smoke: admin-batch6 ok")


if __name__ == "__main__":
    main()
