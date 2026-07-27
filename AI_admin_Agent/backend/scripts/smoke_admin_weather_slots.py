"""天气槽位 / 高德隔离 smoke（无 LLM、无网络）。"""
from __future__ import annotations

from app.core.admin_nlu import normalize_weather_understanding
from app.core.amap_nlu import should_resolve_amap_from_understanding


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    weather = {
        "intent": "天气",
        "slots": {"city": "天津", "day": "today"},
        "has_location_query": True,
        "amap_query_type": "route",
        "needs_clarification": True,
        "clarification_questions": ["与地理位置无关"],
        "admin_scenario": "travel_route",
    }
    out = normalize_weather_understanding(dict(weather))
    _assert(out["has_location_query"] is False, "weather clears has_location_query")
    _assert(out["amap_query_type"] == "none", "weather clears amap_query_type")
    _assert(out["needs_clarification"] is False, "city present clears clarification")
    _assert("admin_scenario" not in out, "weather drops amap admin_scenario")
    _assert(not should_resolve_amap_from_understanding(out), "weather must not trigger amap")

    missing = normalize_weather_understanding(
        {
            "intent": "天气",
            "slots": {"city": ""},
            "has_location_query": False,
            "needs_clarification": False,
        }
    )
    _assert(missing["needs_clarification"] is True, "missing city needs clarification")
    _assert(
        missing["clarification_questions"][0] == "请问要查哪个城市的天气？",
        "weather clarify question is fixed",
    )

    route = {
        "intent": "混合任务",
        "has_location_query": True,
        "amap_query_type": "route",
    }
    _assert(should_resolve_amap_from_understanding(route), "route still uses amap")

    print("smoke_admin_weather_slots: OK")


if __name__ == "__main__":
    main()
