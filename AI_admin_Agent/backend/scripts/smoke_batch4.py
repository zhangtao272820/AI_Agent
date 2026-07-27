"""Batch 4 smoke: domestic playbooks, briefing tools, db bridge, collaboration."""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    from app.core.playbook_scenarios import detect_admin_scenario, preferred_tool_for_scenario
    from app.core.playbook_loader import load_playbook_section

    assert_true(detect_admin_scenario("给我今天的简报") == "daily_briefing", "briefing scenario")
    assert_true(detect_admin_scenario("未读邮件有什么急件") == "email_triage", "triage scenario")
    assert_true(detect_admin_scenario("明天开会帮我准备") == "meeting_prep", "meeting scenario")
    assert_true(detect_admin_scenario("查一下本月订单量") == "ask_database", "askdb scenario")
    pref = preferred_tool_for_scenario("daily_briefing", "简报")
    assert_true(pref and pref["name"] == "daily_briefing", "preferred tool")

    for sid, heading in (
        ("daily_briefing", "Planning"),
        ("email_triage", "Planning"),
        ("meeting_prep", "Planning"),
        ("ask_database", "Planning"),
        ("write_gate", "Planning"),
    ):
        body = load_playbook_section(sid, heading)
        assert_true(len(body) > 20, f"{sid}/{heading} empty")

    from app.tools.briefing import daily_briefing, weekly_report

    br = daily_briefing(session_id="smoke-b4")
    assert_true(br.get("ok") and "简报" in br.get("human_message", ""), "daily_briefing")
    wr = weekly_report(session_id="smoke-b4")
    assert_true(wr.get("ok") and "周报" in wr.get("human_message", ""), "weekly_report")

    from app.tools.database import ask_database

    os.environ.pop("DB_AGENT_HTTP_URL", None)
    from app.core import config as cfg

    cfg.settings.DB_AGENT_HTTP_URL = ""
    err = ask_database("测试问数")
    assert_true(not err.get("ok") and err.get("code") == "db_not_configured", "db guard")

    from app.tools.registry import AVAILABLE_TOOLS, RISKY_TOOLS

    for name in (
        "daily_briefing",
        "triage_emails",
        "prepare_meeting",
        "weekly_report",
        "ask_database",
        "send_wecom_message",
        "send_team_notification",
    ):
        assert_true(name in AVAILABLE_TOOLS, f"{name} missing")
    assert_true("send_wecom_message" in RISKY_TOOLS, "wecom should be risky")
    assert_true("daily_briefing" not in RISKY_TOOLS, "briefing read-only")

    from app.core.admin_playbook_prompts import get_verification_rules

    vr = get_verification_rules("daily_briefing")
    assert_true("场景回复" in vr or "daily_briefing" in vr or len(vr) > 30, "verification addon")

    print("smoke: admin-batch4 ok")


if __name__ == "__main__":
    main()
