"""Batch 5 smoke: lobster/amap clients, automation tools, scenarios."""
from __future__ import annotations

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

    assert_true(detect_admin_scenario("请从会议纪要里提取待办") == "meeting_minutes", "minutes")
    assert_true(detect_admin_scenario("从公司到机场多久") == "travel_route", "travel")
    assert_true(detect_admin_scenario("同步飞书日历") == "feishu_calendar", "feishu")
    assert_true(detect_admin_scenario("在OA网页提交请假") == "lobster_automation", "lobster")

    pref = preferred_tool_for_scenario("meeting_minutes", "纪要：张三负责下周交付")
    assert_true(pref and pref["name"] == "extract_meeting_actions", "minutes tool")

    travel_pref = preferred_tool_for_scenario(
        "travel_route",
        "坐地铁从天津西站到天津站大概多久",
        understanding={
            "resolved_amap": {
                "ok": True,
                "tool_name": "get_travel_route",
                "tool_args": {
                    "origin": "天津西站",
                    "destination": "天津站",
                    "mode": "transit",
                },
            }
        },
    )
    assert_true(
        travel_pref
        and travel_pref["name"] == "get_travel_route"
        and travel_pref["args"].get("mode") == "transit",
        "travel tool from resolved_amap",
    )

    from app.core.amap_nlu import build_amap_tool_plan

    plan = build_amap_tool_plan(
        {
            "ok": True,
            "tool_name": "get_travel_route",
            "tool_args": {"origin": "A", "destination": "B", "mode": "transit"},
        }
    )
    assert_true(plan and plan["name"] == "get_travel_route", "build amap plan")

    assert_true(detect_admin_scenario("天津站附近咖啡") == "amap_poi", "poi")
    assert_true(detect_admin_scenario("查一下这个地址在哪") == "amap_geocode", "geocode")

    for sid in ("meeting_minutes", "lobster_automation", "travel_route", "feishu_calendar", "amap_poi", "amap_geocode"):
        body = load_playbook_section(sid, "Planning")
        assert_true(len(body) > 15, f"{sid} playbook")

    from app.core.lobster_client import lobster_agent_configured
    from app.core.amap_client import amap_configured, get_route_plan

    assert_true(not lobster_agent_configured(), "lobster default off")

    from app.core.amap_cards import tool_result_to_ui_card, build_amap_navigation_url

    nav = build_amap_navigation_url(
        origin_location="117.1,39.1",
        origin_name="A",
        destination_location="117.2,39.2",
        destination_name="B",
        mode="transit",
    )
    assert_true(nav and "uri.amap.com" in nav, "nav url")

    card = tool_result_to_ui_card(
        "get_travel_route",
        {
            "ok": True,
            "data": {
                "ok": True,
                "origin": "起点",
                "destination": "终点",
                "origin_location": "117.1,39.1",
                "destination_location": "117.2,39.2",
                "mode": "transit",
                "mode_label": "公交/地铁",
                "duration_minutes": 40,
                "distance_km": 8.7,
                "route_steps": ["步行到地铁站", "乘坐地铁6号线"],
            },
        },
    )
    assert_true(card and card.get("type") == "amap_route" and len(card.get("steps") or []) == 2, "route card")

    compare_card = tool_result_to_ui_card(
        "get_travel_route",
        {
            "ok": True,
            "data": {
                "ok": True,
                "compare": True,
                "origin": "起点",
                "destination": "终点",
                "origin_location": "117.1,39.1",
                "destination_location": "117.2,39.2",
                "recommended_mode": "transit",
                "routes": [
                    {
                        "ok": True,
                        "mode": "driving",
                        "mode_label": "驾车",
                        "duration_minutes": 25,
                        "distance_km": 8.7,
                        "route_steps": ["沿卫津路行驶"],
                        "origin_location": "117.1,39.1",
                        "destination_location": "117.2,39.2",
                    },
                    {
                        "ok": True,
                        "mode": "transit",
                        "mode_label": "公交/地铁",
                        "duration_minutes": 41,
                        "distance_km": 8.9,
                        "route_steps": ["步行到地铁站", "乘坐地铁6号线"],
                        "origin_location": "117.1,39.1",
                        "destination_location": "117.2,39.2",
                    },
                    {
                        "ok": True,
                        "mode": "walk",
                        "mode_label": "步行",
                        "duration_minutes": 95,
                        "distance_km": 7.2,
                        "route_steps": ["沿河边步行"],
                        "origin_location": "117.1,39.1",
                        "destination_location": "117.2,39.2",
                    },
                ],
            },
        },
    )
    assert_true(
        compare_card
        and compare_card.get("type") == "amap_route_compare"
        and len(compare_card.get("options") or []) == 3,
        "route compare card",
    )

    if amap_configured():
        plan = get_route_plan("天津西站", "天津站", "transit")
        if plan.get("ok"):
            assert_true(len(plan.get("route_steps") or []) >= 1, "transit route steps")
            assert_true("推荐路线" in str(plan.get("summary") or ""), "transit summary has steps")

    from app.tools.amap_tools import get_travel_route
    from app.tools.automation import extract_meeting_actions, lobster_browser_task

    route = get_travel_route("北京", "上海")
    assert_true(isinstance(route, dict) and route.get("code") in (
        "route_ok", "route_failed", "amap_not_configured",
    ), "amap route tool")

    short = extract_meeting_actions("短")
    assert_true(not short.get("ok"), "minutes too short")

    lob = lobster_browser_task("测试")
    assert_true(lob.get("code") == "lobster_not_configured", "lobster guard")

    from app.tools.registry import AVAILABLE_TOOLS, RISKY_TOOLS

    for name in (
        "lobster_browser_task",
        "extract_meeting_actions",
        "get_travel_route",
        "search_places_amap",
        "search_nearby_amap",
        "resolve_address_amap",
        "suggest_address_amap",
        "locate_coordinates_amap",
        "sync_feishu_calendar",
    ):
        assert_true(name in AVAILABLE_TOOLS, f"{name} in registry")
    assert_true("send_sms_reminder" not in AVAILABLE_TOOLS, "sms tool removed")
    assert_true("lobster_browser_task" in RISKY_TOOLS, "lobster risky")
    assert_true("extract_meeting_actions" not in RISKY_TOOLS, "extract read-only")

    print("smoke: admin-batch5 ok")


if __name__ == "__main__":
    main()
