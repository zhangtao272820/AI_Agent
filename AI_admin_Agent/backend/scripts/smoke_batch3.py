"""Batch 3 smoke: contact/calendar import, webhook, MCP summary, checkpointer, skill_sync path."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("ADMIN_MCP_ENABLED", "0")
os.environ.setdefault("ADMIN_LANGGRAPH_CHECKPOINTER", "0")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    from app.core.contact_import import parse_contacts_file
    from app.core.calendar_ics import parse_ics_events, render_ics_events
    import datetime as dt

    vcard = """BEGIN:VCARD
FN:张三
EMAIL:zhangsan@example.com
END:VCARD
BEGIN:VCARD
FN:李四
EMAIL:lisi@example.com
END:VCARD"""
    rows = parse_contacts_file(vcard, "vcard")
    assert_true(len(rows) == 2 and rows[0]["email"] == "zhangsan@example.com", "vcard parse")

    csv_text = "name,email\n王五,wangwu@example.com\n"
    rows_csv = parse_contacts_file(csv_text, "csv")
    assert_true(len(rows_csv) == 1 and rows_csv[0]["name"] == "王五", "csv parse")

    ics = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test-1
SUMMARY:周会
DTSTART:20260620T090000
DESCRIPTION:批次3测试
END:VEVENT
END:VCALENDAR"""
    events = parse_ics_events(ics)
    assert_true(len(events) == 1 and events[0]["title"] == "周会", "ics parse")
    exported = render_ics_events(
        [{"id": 1, "title": "周会", "start_time": dt.datetime(2026, 6, 20, 1, 0, 0), "description": "x", "uid": "t1"}]
    )
    assert_true("BEGIN:VCALENDAR" in exported and "周会" in exported, "ics export")

    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        os.environ["WORKSPACE_DIR"] = str(ws)
        import importlib
        from app.core import config as cfg_mod

        importlib.reload(cfg_mod)

        contacts_file = ws / "contacts.csv"
        contacts_file.write_text("name,email\n导入测试,import@test.local\n", encoding="utf-8")
        from app.tools.contacts import import_contacts

        res = import_contacts("contacts.csv")
        assert_true(res.get("ok"), f"import_contacts failed: {res}")
        assert_true(res.get("data", {}).get("stats", {}).get("created", 0) >= 1, "contact import created")

        ics_file = ws / "calendar.ics"
        ics_file.write_text(ics, encoding="utf-8")
        from app.tools.calendar import import_calendar_ics, export_calendar_ics

        ics_res = import_calendar_ics("calendar.ics")
        assert_true(ics_res.get("ok"), f"import_calendar_ics failed: {ics_res}")
        exp = export_calendar_ics("exports/out.ics")
        assert_true(exp.get("ok") and (ws / "exports/out.ics").is_file(), "export_calendar_ics")

    from app.core.webhook_notify import _build_payload

    wecom = _build_payload("标题", "内容")
    assert_true(wecom.get("msgtype") == "text" or "title" in wecom, "webhook payload")

    from app.core.mcp_bridge import mcp_summary

    summary = mcp_summary()
    assert_true("enabled" in summary and summary["toolCount"] == 0, "mcp summary")

    from app.core.langgraph_checkpointer import (
        build_graph_invoke_config,
        is_admin_langgraph_checkpointer_enabled,
    )

    assert_true(not is_admin_langgraph_checkpointer_enabled(), "checkpointer default off")
    assert_true(build_graph_invoke_config("s1") is None, "config none when disabled")

    os.environ["ADMIN_LANGGRAPH_CHECKPOINTER"] = "1"
    from app.core import langgraph_checkpointer as lgc

    lgc._memory_saver = None  # reset
    cfg_obj = build_graph_invoke_config("sess-a", "trace-b")
    assert_true(cfg_obj and cfg_obj["configurable"]["thread_id"] == "run-trace-b", "checkpointer thread")

    from app.tools.registry import AVAILABLE_TOOLS, RISKY_TOOLS

    for name in ("import_contacts", "import_calendar_ics", "fetch_and_import_calendar", "export_calendar_ics"):
        assert_true(name in AVAILABLE_TOOLS, f"{name} missing in registry")
    assert_true("import_contacts" in RISKY_TOOLS, "import_contacts should be risky")

    root = Path(__file__).resolve().parents[3]
    skill_sync_text = (root / "Manage-platform_Agent/backend/app/skill_sync.py").read_text(encoding="utf-8")
    assert_true(
        '"AI_admin_Agent"' in skill_sync_text and "AI_admin_Agent/skills" in skill_sync_text,
        "AI_admin_Agent skill_sync spec",
    )

    print("smoke: admin-batch3 ok")


if __name__ == "__main__":
    main()
