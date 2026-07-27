"""高德地图工具：路线、POI、地理编码。"""
from __future__ import annotations

from app.core.amap_client import (
    amap_configured,
    geocode_address,
    get_route_plan,
    reverse_geocode,
    search_nearby_places,
    search_places,
    suggest_addresses,
)
from app.tools.common import _tool_err, _tool_ok


def _amap_guard() -> dict | None:
    if not amap_configured():
        return _tool_err(
            "高德地图未配置：请在 .env 设置 ADMIN_AMAP_KEY（Web服务 Key）与 ADMIN_AMAP_CITY。",
            code="amap_not_configured",
        )
    return None


def _wrap(result: dict, *, code: str) -> dict:
    if result.get("ok"):
        return _tool_ok(str(result.get("summary") or "查询成功"), data=result, code=code)
    hint = str(result.get("hint") or result.get("error") or "查询失败")
    return _tool_err(hint, data=result, code=code)


def _compare_travel_routes(origin: str, destination: str) -> dict:
    """同一起终点对比驾车 / 公交地铁 / 步行三种方案。"""
    modes: list[tuple[str, str]] = [
        ("driving", "驾车"),
        ("transit", "公交/地铁"),
        ("walk", "步行"),
    ]
    routes: list[dict] = []
    shared: dict | None = None
    for mode, label in modes:
        plan = get_route_plan(origin, destination, mode)
        entry = {
            "mode": mode,
            "mode_label": label,
            "ok": bool(plan.get("ok")),
            "duration_minutes": plan.get("duration_minutes"),
            "distance_km": plan.get("distance_km"),
            "route_steps": plan.get("route_steps") or [],
            "hint": str(plan.get("hint") or plan.get("error") or ""),
        }
        if plan.get("ok"):
            entry.update(
                {
                    "origin": plan.get("origin"),
                    "destination": plan.get("destination"),
                    "origin_location": plan.get("origin_location"),
                    "destination_location": plan.get("destination_location"),
                }
            )
            if shared is None:
                shared = {
                    "origin": plan.get("origin"),
                    "destination": plan.get("destination"),
                    "origin_location": plan.get("origin_location"),
                    "destination_location": plan.get("destination_location"),
                }
        routes.append(entry)

    ok_routes = [r for r in routes if r.get("ok")]
    if not ok_routes:
        hint = str(routes[0].get("hint") if routes else "") or "三种出行方式均未规划出可用路线"
        return _tool_err(hint, data={"compare": True, "routes": routes}, code="route_compare_failed")

    lines = [
        f"从「{shared.get('origin') if shared else origin}」到「{shared.get('destination') if shared else destination}」出行对比：",
        "",
    ]
    for r in ok_routes:
        dist = r.get("distance_km")
        dist_txt = f"，{dist} 公里" if dist is not None else ""
        lines.append(f"- {r.get('mode_label')}：约 {r.get('duration_minutes')} 分钟{dist_txt}")
    fastest = min(ok_routes, key=lambda x: int(x.get("duration_minutes") or 99999))
    lines.extend(["", f"最快推荐：{fastest.get('mode_label')}（约 {fastest.get('duration_minutes')} 分钟）"])

    payload = {
        "ok": True,
        "compare": True,
        "origin": shared.get("origin") if shared else origin,
        "destination": shared.get("destination") if shared else destination,
        "origin_location": shared.get("origin_location") if shared else "",
        "destination_location": shared.get("destination_location") if shared else "",
        "routes": routes,
        "recommended_mode": fastest.get("mode"),
        "summary": "\n".join(lines),
    }
    return _tool_ok(str(payload["summary"]), data=payload, code="route_compare_ok")


def get_travel_route(
    origin: str,
    destination: str,
    mode: str = "driving",
    compare_modes: bool = False,
) -> dict:
    """高德路线规划：耗时、距离与分步指引；compare_modes=true 时对比驾车/公交/步行。"""
    guard = _amap_guard()
    if guard:
        return guard
    mode_key = str(mode or "").strip().lower()
    if compare_modes or mode_key in ("compare", "all", "multi"):
        return _compare_travel_routes(origin, destination)
    plan = get_route_plan(origin, destination, mode)
    if not plan.get("ok"):
        hint = str(plan.get("hint") or plan.get("error") or "route_failed")
        return _tool_err(hint, data=plan, code="route_failed")
    return _tool_ok(str(plan.get("summary") or "路线已规划"), data=plan, code="route_ok")


def search_places_amap(keywords: str, city: str = "") -> dict:
    """关键字搜索地点（餐厅、公司、地标等）。"""
    guard = _amap_guard()
    if guard:
        return guard
    return _wrap(search_places(keywords, city=city), code="places_ok")


def search_nearby_amap(keywords: str, near_address: str, radius_m: int = 3000) -> dict:
    """某地址周边的 POI（附近餐厅、停车、地铁口等）。"""
    guard = _amap_guard()
    if guard:
        return guard
    return _wrap(
        search_nearby_places(keywords, near_address, radius_m=radius_m),
        code="nearby_ok",
    )


def resolve_address_amap(address: str, city: str = "") -> dict:
    """将模糊地址解析为标准地址与坐标。"""
    guard = _amap_guard()
    if guard:
        return guard
    return _wrap(geocode_address(address, city=city), code="geocode_ok")


def suggest_address_amap(keywords: str, city: str = "") -> dict:
    """地址输入补全 / 提示。"""
    guard = _amap_guard()
    if guard:
        return guard
    return _wrap(suggest_addresses(keywords, city=city), code="tips_ok")


def locate_coordinates_amap(location: str) -> dict:
    """坐标转地址（经度,纬度）。"""
    guard = _amap_guard()
    if guard:
        return guard
    return _wrap(reverse_geocode(location), code="regeo_ok")
