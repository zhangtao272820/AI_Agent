"""将高德工具结果转为前端可渲染的 UI 卡片。"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote


def _nav_mode(mode: str) -> str:
    m = str(mode or "").strip().lower()
    if m in ("transit", "subway", "metro", "bus"):
        return "bus"
    if m in ("walk", "walking"):
        return "walk"
    if m in ("bike", "bicycling", "ride"):
        return "ride"
    return "car"


def build_amap_navigation_url(
    *,
    origin_location: str = "",
    origin_name: str = "",
    destination_location: str = "",
    destination_name: str = "",
    mode: str = "transit",
) -> str | None:
    dest_loc = str(destination_location or "").strip()
    dest_name = str(destination_name or "").strip()
    if not dest_loc and not dest_name:
        return None
    origin_loc = str(origin_location or "").strip()
    origin_name = str(origin_name or "").strip()
    to_seg = f"{dest_loc},{quote(dest_name)}" if dest_loc else quote(dest_name)
    if origin_loc or origin_name:
        from_seg = f"{origin_loc},{quote(origin_name)}" if origin_loc else quote(origin_name)
        return (
            f"https://uri.amap.com/navigation?from={from_seg}&to={to_seg}"
            f"&mode={_nav_mode(mode)}&coordinate=gaode"
        )
    return f"https://uri.amap.com/navigation?to={to_seg}&mode={_nav_mode(mode)}&coordinate=gaode"


def _midpoint_location(a: str, b: str) -> str:
    try:
        alng, alat = [float(x) for x in str(a or "").split(",", 1)]
        blng, blat = [float(x) for x in str(b or "").split(",", 1)]
        return f"{(alng + blng) / 2:.6f},{(alat + blat) / 2:.6f}"
    except (ValueError, TypeError):
        return str(a or b or "").strip()


def build_map_image_proxy_path(
    *,
    origin_location: str = "",
    destination_location: str = "",
    points: list[tuple[str, str]] | None = None,
    zoom: int = 12,
) -> str | None:
    """生成前端可请求的静态地图预览路径（经后端代理）。"""
    from urllib.parse import urlencode

    markers: list[tuple[str, str, str]] = []
    ol = str(origin_location or "").strip()
    dl = str(destination_location or "").strip()
    if ol and "," in ol:
        markers.append(("A", ol, "0x38bdf8"))
    if dl and "," in dl:
        markers.append(("B", dl, "0xf97316"))
    for idx, (label, loc) in enumerate(points or [], start=1):
        loc_s = str(loc or "").strip()
        if loc_s and "," in loc_s:
            markers.append((label or str(idx), loc_s, "0x22c55e"))
    if not markers:
        return None
    center = _midpoint_location(ol, dl) if ol and dl else markers[0][1]
    qs = urlencode(
        {
            "center": center,
            "zoom": max(3, min(int(zoom or 12), 18)),
            "markers": "|".join(f"{lab}:{loc}:{color}" for lab, loc, color in markers[:8]),
        }
    )
    return f"/api/amap/map-image?{qs}"


def build_amap_marker_url(location: str, name: str = "") -> str | None:
    loc = str(location or "").strip()
    if not loc or "," not in loc:
        return None
    label = quote(str(name or "").strip() or "地点")
    return f"https://uri.amap.com/marker?position={loc}&name={label}&coordinate=gaode"


def _step_kind(text: str) -> str:
    t = str(text or "")
    if "步行" in t:
        return "walk"
    if any(k in t for k in ("地铁", "公交", "乘坐", "号线")):
        return "transit"
    if "骑行" in t:
        return "bike"
    if "驾车" in t or "开车" in t:
        return "drive"
    return "point"


def _build_route_card_payload(data: dict[str, Any]) -> dict[str, Any]:
    steps = data.get("route_steps") or []
    mode = str(data.get("mode") or "transit")
    return {
        "type": "amap_route",
        "title": f"{data.get('mode_label') or '出行'}路线",
        "origin": data.get("origin"),
        "destination": data.get("destination"),
        "origin_location": data.get("origin_location"),
        "destination_location": data.get("destination_location"),
        "mode": mode,
        "mode_label": data.get("mode_label"),
        "duration_minutes": data.get("duration_minutes"),
        "distance_km": data.get("distance_km"),
        "steps": [{"text": s, "kind": _step_kind(s)} for s in steps if str(s).strip()],
        "map_url": build_amap_navigation_url(
            origin_location=str(data.get("origin_location") or ""),
            origin_name=str(data.get("origin") or ""),
            destination_location=str(data.get("destination_location") or ""),
            destination_name=str(data.get("destination") or ""),
            mode=mode,
        ),
        "map_image_url": build_map_image_proxy_path(
            origin_location=str(data.get("origin_location") or ""),
            destination_location=str(data.get("destination_location") or ""),
            zoom=12 if data.get("distance_km") and float(data.get("distance_km") or 0) < 8 else 11,
        ),
        "provider": "amap",
    }


def tool_result_to_ui_card(tool_name: str, tool_result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(tool_result, dict) or not tool_result.get("ok"):
        return None
    data = tool_result.get("data")
    if not isinstance(data, dict) or data.get("ok") is False:
        return None

    from app.core.playground_cards import playground_tool_to_ui_card

    pg_card = playground_tool_to_ui_card(tool_name, tool_result)
    if pg_card:
        return pg_card

    if tool_name == "get_travel_route":
        if data.get("compare"):
            options: list[dict[str, Any]] = []
            for route in data.get("routes") or []:
                if not isinstance(route, dict):
                    continue
                if route.get("ok"):
                    card = _build_route_card_payload(route)
                    card.pop("type", None)
                    card.pop("map_image_url", None)
                    options.append(card)
                else:
                    options.append(
                        {
                            "mode": route.get("mode"),
                            "mode_label": route.get("mode_label"),
                            "unavailable": True,
                            "hint": str(route.get("hint") or "暂无可用方案"),
                        }
                    )
            if not options:
                return None
            recommended = str(data.get("recommended_mode") or options[0].get("mode") or "transit")
            return {
                "type": "amap_route_compare",
                "title": "出行方案对比",
                "origin": data.get("origin"),
                "destination": data.get("destination"),
                "origin_location": data.get("origin_location"),
                "destination_location": data.get("destination_location"),
                "recommended_mode": recommended,
                "options": options,
                "map_image_url": build_map_image_proxy_path(
                    origin_location=str(data.get("origin_location") or ""),
                    destination_location=str(data.get("destination_location") or ""),
                    zoom=12,
                ),
                "provider": "amap",
            }
        return _build_route_card_payload(data)

    if tool_name in ("search_places_amap", "search_nearby_amap"):
        places = data.get("places") or []
        if not places:
            return None
        items = []
        for p in places:
            if not isinstance(p, dict):
                continue
            loc = str(p.get("location") or "")
            name = str(p.get("name") or "")
            items.append(
                {
                    "name": name,
                    "address": p.get("address"),
                    "distance_m": p.get("distance_m"),
                    "map_url": build_amap_marker_url(loc, name),
                }
            )
        title = data.get("keywords") or data.get("center") or "地点"
        subtitle = data.get("center") if tool_name == "search_nearby_amap" else data.get("city")
        map_points = [
            (str(i + 1), str(p.get("location") or ""))
            for i, p in enumerate(places[:6])
            if isinstance(p, dict) and p.get("location")
        ]
        center_loc = str(data.get("center_location") or "")
        if tool_name == "search_nearby_amap" and center_loc and "," in center_loc:
            map_points = [("中", center_loc)] + map_points
        return {
            "type": "amap_places",
            "title": f"「{title}」" + ("周边" if tool_name == "search_nearby_amap" else "搜索"),
            "subtitle": subtitle,
            "places": items,
            "map_image_url": build_map_image_proxy_path(points=map_points, zoom=14 if len(map_points) <= 2 else 13),
            "provider": "amap",
        }

    if tool_name == "resolve_address_amap":
        loc = str(data.get("location") or "")
        name = str(data.get("formatted_address") or data.get("address") or "")
        return {
            "type": "amap_address",
            "title": "地址解析",
            "address": name,
            "location": loc,
            "map_url": build_amap_marker_url(loc, name),
            "map_image_url": build_map_image_proxy_path(points=[("A", loc)] if loc else None, zoom=15),
            "provider": "amap",
        }

    if tool_name == "suggest_address_amap":
        tips = data.get("tips") or []
        if not tips:
            return None
        items = [
            {
                "name": str(t.get("name") or ""),
                "address": str(t.get("district") or t.get("address") or ""),
                "map_url": build_amap_marker_url(str(t.get("location") or ""), str(t.get("name") or "")),
            }
            for t in tips
            if isinstance(t, dict) and t.get("name")
        ]
        map_points = [
            (str(i + 1), str(t.get("location") or ""))
            for i, t in enumerate(tips[:5])
            if isinstance(t, dict) and t.get("location")
        ]
        return {
            "type": "amap_places",
            "title": f"地址建议「{data.get('keywords') or ''}」",
            "places": items,
            "map_image_url": build_map_image_proxy_path(points=map_points, zoom=13),
            "provider": "amap",
        }

    if tool_name == "locate_coordinates_amap":
        name = str(data.get("formatted_address") or "")
        loc = str(data.get("location") or "")
        return {
            "type": "amap_address",
            "title": "坐标定位",
            "address": name,
            "location": loc,
            "map_url": build_amap_marker_url(loc, name),
            "map_image_url": build_map_image_proxy_path(points=[("A", loc)] if loc else None, zoom=15),
            "provider": "amap",
        }

    if tool_name == "web_search":
        hits = data.get("hits") or []
        if not isinstance(hits, list) or not hits:
            return None
        items = []
        for h in hits[:8]:
            if not isinstance(h, dict):
                continue
            title = str(h.get("title") or "").strip()
            url = str(h.get("url") or "").strip()
            if not title and not url:
                continue
            items.append(
                {
                    "title": title or url,
                    "url": url,
                    "snippet": str(h.get("snippet") or "").strip(),
                    "publishedDate": h.get("publishedDate"),
                    "engine": h.get("engine"),
                }
            )
        if not items:
            return None
        return {
            "type": "web_search",
            "title": "联网搜索结果",
            "query": str(data.get("query") or ""),
            "provider": str(data.get("provider") or ""),
            "hits": items,
        }

    return None
