"""高德地图 Web 服务：路线、POI、地理编码（国内）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

_COORD_RE = re.compile(r"^-?\d+(\.\d+)?,-?\d+(\.\d+)?$")

_AMAP_KEY_HINTS: dict[str, str] = {
    "INVALID_USER_KEY": "高德 Key 无效：请确认控制台 Key 类型为「Web服务」，且完整复制到 ADMIN_AMAP_KEY。",
    "USERKEY_PLAT_NOMATCH": "高德 Key 与接口不匹配：创建 Key 时服务平台必须选「Web服务」（不是 Web端 JS API）。",
    "USERKEY_IP_REFUSED": "高德 Key 受 IP 白名单限制：请在控制台清空白名单或加入本服务器公网 IP。",
    "DAILY_QUERY_OVER_LIMIT": "高德今日调用量已超限，请明日再试或升级配额。",
    "ACCESS_TOO_FREQUENT": "高德调用过于频繁，请稍后再试。",
}


def amap_configured() -> bool:
    return bool(str(settings.ADMIN_AMAP_KEY or "").strip())


def fetch_static_map_bytes(
    *,
    markers: list[tuple[str, str, str]] | None = None,
    center: str = "",
    zoom: int = 12,
    size: str = "640*240",
) -> bytes | None:
    """拉取高德静态地图 PNG（供 /api/amap/map-image 代理，避免前端暴露 Key）。"""
    key = str(settings.ADMIN_AMAP_KEY or "").strip()
    if not key:
        return None
    marker_parts: list[str] = []
    for item in markers or []:
        if len(item) < 2:
            continue
        label = str(item[0] or "A").strip() or "A"
        loc = str(item[1] or "").strip()
        color = str(item[2] if len(item) > 2 else "0x0088FF").strip() or "0x0088FF"
        if loc and "," in loc:
            marker_parts.append(f"mid,{color},{label}:{loc}")
    loc_center = str(center or "").strip()
    if not loc_center and marker_parts:
        first = (markers or [("", "")])[0]
        loc_center = str(first[1] if len(first) > 1 else "").strip()
    if not loc_center and not marker_parts:
        return None
    params: dict[str, str | int] = {
        "zoom": max(3, min(int(zoom or 12), 18)),
        "size": str(size or "640*240"),
        "key": key,
    }
    if loc_center:
        params["location"] = loc_center
    if marker_parts:
        params["markers"] = "|".join(marker_parts[:8])
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get("https://restapi.amap.com/v3/staticmap", params=params)
            resp.raise_for_status()
            if resp.headers.get("content-type", "").startswith("image/"):
                return resp.content
    except Exception:
        return None
    return None


def _amap_city(override: str = "") -> str:
    city = str(override or settings.ADMIN_AMAP_CITY or "").strip()
    return city or "全国"


@dataclass(frozen=True)
class GeoHit:
    location: str
    name: str
    city: str = ""
    adcode: str = ""


def _is_coordinate(text: str) -> bool:
    return bool(_COORD_RE.match(str(text or "").strip().replace(" ", "")))


def _transit_city_param(hit: GeoHit) -> str:
    """公交路径规划 city/cityd：优先起点/终点所在城市名，其次 adcode。"""
    city = str(hit.city or "").strip()
    if city and city not in ("[]", "全国"):
        return city
    adcode = str(hit.adcode or "").strip()
    if adcode:
        return adcode
    cfg = _amap_city()
    return cfg if cfg != "全国" else ""


def _resolve_geo_point(address: str, client: httpx.Client, city: str = "") -> GeoHit | None:
    """地址或 lng,lat 坐标 → 坐标、名称与城市信息。"""
    raw = str(address or "").strip()
    if not raw:
        return None
    if _is_coordinate(raw):
        loc = raw.replace(" ", "")
        try:
            data = _amap_request(client, "geocode/regeo", {"location": loc, "extensions": "base"})
            regeo = data.get("regeocode") or {}
            comp = regeo.get("addressComponent") or {}
            city_name = str(comp.get("city") or comp.get("province") or "").strip()
            if city_name == "[]":
                city_name = ""
            adcode = str(comp.get("adcode") or "").strip()
            formatted = str(regeo.get("formatted_address") or loc).strip()
            return GeoHit(location=loc, name=formatted, city=city_name, adcode=adcode)
        except ValueError:
            return None
    return _geocode(raw, client, city)


def _geocode(address: str, client: httpx.Client, city: str = "") -> GeoHit | None:
    data = _amap_request(
        client,
        "geocode/geo",
        {"address": address, "city": _amap_city(city)},
    )
    geocodes = data.get("geocodes") or []
    if not geocodes:
        return None
    loc = str(geocodes[0].get("location") or "")
    name = str(geocodes[0].get("formatted_address") or address)
    city_name = str(geocodes[0].get("city") or geocodes[0].get("province") or "").strip()
    if city_name == "[]":
        city_name = ""
    if not city_name:
        fallback = _amap_city(city)
        if fallback != "全国":
            city_name = fallback
    adcode = str(geocodes[0].get("adcode") or "").strip()
    if not loc or "," not in loc:
        return None
    return GeoHit(location=loc, name=name, city=city_name, adcode=adcode)


def _amap_error_message(info: str) -> str:
    code = str(info or "").strip()
    return _AMAP_KEY_HINTS.get(code, code or "amap_request_failed")


def _amap_request(client: httpx.Client, path: str, params: dict[str, Any]) -> dict[str, Any]:
    key = str(settings.ADMIN_AMAP_KEY or "").strip()
    merged = {"key": key, "output": "JSON", **params}
    res = client.get(f"https://restapi.amap.com/v3/{path}", params=merged)
    res.raise_for_status()
    data = res.json()
    if str(data.get("status")) != "1":
        raise ValueError(_amap_error_message(str(data.get("info") or "amap_request_failed")))
    return data


def geocode_address(address: str, city: str = "") -> dict[str, Any]:
    """地址 → 标准地址与坐标。"""
    addr = str(address or "").strip()
    if not amap_configured():
        return {"ok": False, "error": "not_configured"}
    if not addr:
        return {"ok": False, "error": "missing_address"}
    try:
        with httpx.Client(timeout=15.0) as client:
            hit = _geocode(addr, client, city)
            if not hit:
                return {
                    "ok": False,
                    "error": "geocode_failed",
                    "hint": f"无法解析「{addr}」，请补充城市或更详细地址。",
                }
            loc, formatted = hit.location, hit.name
            return {
                "ok": True,
                "address": addr,
                "formatted_address": formatted,
                "location": loc,
                "summary": f"「{formatted}」（{loc}）",
            }
    except ValueError as e:
        return {"ok": False, "error": str(e), "hint": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def reverse_geocode(location: str) -> dict[str, Any]:
    """坐标 lng,lat → 地址描述。"""
    loc = str(location or "").strip().replace(" ", "")
    if not amap_configured():
        return {"ok": False, "error": "not_configured"}
    if not loc or "," not in loc:
        return {"ok": False, "error": "invalid_location", "hint": "请提供「经度,纬度」格式坐标。"}
    try:
        with httpx.Client(timeout=15.0) as client:
            data = _amap_request(client, "geocode/regeo", {"location": loc, "extensions": "base"})
            regeo = data.get("regeocode") or {}
            formatted = str(regeo.get("formatted_address") or "").strip()
            comp = regeo.get("addressComponent") or {}
            if not formatted:
                return {"ok": False, "error": "regeo_empty"}
            return {
                "ok": True,
                "location": loc,
                "formatted_address": formatted,
                "province": str(comp.get("province") or ""),
                "city": str(comp.get("city") or comp.get("province") or ""),
                "district": str(comp.get("district") or ""),
                "summary": formatted,
            }
    except ValueError as e:
        return {"ok": False, "error": str(e), "hint": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _format_poi_rows(pois: list, limit: int = 8) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in pois[:limit]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        address = str(item.get("address") or item.get("pname") or "").strip()
        loc = str(item.get("location") or "")
        dist = item.get("distance")
        row: dict[str, Any] = {"name": name, "address": address, "location": loc}
        if dist is not None and str(dist).strip():
            try:
                row["distance_m"] = int(dist)
            except (TypeError, ValueError):
                pass
        rows.append(row)
    return rows


def search_places(keywords: str, city: str = "", limit: int = 8) -> dict[str, Any]:
    """关键字 POI 搜索（餐厅、公司、地标等）。"""
    kw = str(keywords or "").strip()
    if not amap_configured():
        return {"ok": False, "error": "not_configured"}
    if not kw:
        return {"ok": False, "error": "missing_keywords"}
    try:
        with httpx.Client(timeout=15.0) as client:
            data = _amap_request(
                client,
                "place/text",
                {
                    "keywords": kw,
                    "city": _amap_city(city),
                    "offset": min(max(int(limit or 8), 1), 20),
                    "page": 1,
                    "extensions": "base",
                },
            )
            pois = _format_poi_rows(data.get("pois") or [], limit)
            if not pois:
                return {
                    "ok": False,
                    "error": "no_results",
                    "hint": f"未找到与「{kw}」相关的地点，可换关键词或指定城市。",
                }
            lines = [f"**「{kw}」搜索结果**（{_amap_city(city)}）", ""]
            for i, p in enumerate(pois, start=1):
                addr = p.get("address") or "—"
                lines.append(f"{i}. {p['name']} — {addr}")
            return {
                "ok": True,
                "keywords": kw,
                "city": _amap_city(city),
                "places": pois,
                "count": len(pois),
                "summary": "\n".join(lines),
            }
    except ValueError as e:
        return {"ok": False, "error": str(e), "hint": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def search_nearby_places(
    keywords: str,
    near_address: str,
    radius_m: int = 3000,
    limit: int = 8,
) -> dict[str, Any]:
    """以某地址为中心周边 POI 搜索。"""
    kw = str(keywords or "").strip() or "生活服务"
    center = str(near_address or "").strip()
    if not amap_configured():
        return {"ok": False, "error": "not_configured"}
    if not center:
        return {"ok": False, "error": "missing_center"}
    radius = min(max(int(radius_m or 3000), 200), 50000)
    try:
        with httpx.Client(timeout=15.0) as client:
            hit = _geocode(center, client)
            if not hit:
                return {
                    "ok": False,
                    "error": "geocode_failed",
                    "hint": f"无法定位「{center}」，请提供更具体地址。",
                }
            loc, center_name = hit.location, hit.name
            data = _amap_request(
                client,
                "place/around",
                {
                    "location": loc,
                    "keywords": kw,
                    "radius": radius,
                    "offset": min(max(int(limit or 8), 1), 20),
                    "page": 1,
                    "extensions": "base",
                },
            )
            pois = _format_poi_rows(data.get("pois") or [], limit)
            if not pois:
                return {
                    "ok": False,
                    "error": "no_results",
                    "hint": f"「{center_name}」附近 {radius} 米内未找到「{kw}」。",
                }
            lines = [f"**{center_name} 附近「{kw}」**（约 {radius // 1000 or 1} 公里内）", ""]
            for i, p in enumerate(pois, start=1):
                addr = p.get("address") or "—"
                dist = p.get("distance_m")
                dist_txt = f"，约 {dist} 米" if dist is not None else ""
                lines.append(f"{i}. {p['name']} — {addr}{dist_txt}")
            return {
                "ok": True,
                "center": center_name,
                "center_location": loc,
                "keywords": kw,
                "radius_m": radius,
                "places": pois,
                "count": len(pois),
                "summary": "\n".join(lines),
            }
    except ValueError as e:
        return {"ok": False, "error": str(e), "hint": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def suggest_addresses(keywords: str, city: str = "", limit: int = 6) -> dict[str, Any]:
    """输入提示 / 地址补全。"""
    kw = str(keywords or "").strip()
    if not amap_configured():
        return {"ok": False, "error": "not_configured"}
    if not kw:
        return {"ok": False, "error": "missing_keywords"}
    try:
        with httpx.Client(timeout=15.0) as client:
            data = _amap_request(
                client,
                "assistant/inputtips",
                {
                    "keywords": kw,
                    "city": _amap_city(city),
                    "datatype": "all",
                },
            )
            tips_raw = data.get("tips") or []
            tips: list[dict[str, str]] = []
            for item in tips_raw[: min(max(int(limit or 6), 1), 10)]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                if not name:
                    continue
                tips.append(
                    {
                        "name": name,
                        "district": str(item.get("district") or ""),
                        "address": str(item.get("address") or ""),
                        "location": str(item.get("location") or ""),
                    }
                )
            if not tips:
                return {"ok": False, "error": "no_tips", "hint": f"没有「{kw}」相关的地址建议。"}
            lines = [f"**地址建议（{kw}）**", ""]
            for i, t in enumerate(tips, start=1):
                extra = t.get("district") or t.get("address") or ""
                lines.append(f"{i}. {t['name']}" + (f" — {extra}" if extra else ""))
            return {
                "ok": True,
                "keywords": kw,
                "tips": tips,
                "count": len(tips),
                "summary": "\n".join(lines),
            }
    except ValueError as e:
        return {"ok": False, "error": str(e), "hint": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _walking_tail_label(walking: dict) -> str:
    wsteps = walking.get("steps") or []
    for ws in reversed(wsteps):
        if not isinstance(ws, dict):
            continue
        assistant = str(ws.get("assistant_action") or "").strip()
        if assistant:
            return assistant
        inst = str(ws.get("instruction") or "").strip()
        if inst and ("到达" in inst or "步行" in inst):
            return inst
    return ""


def _format_transit_steps(transit: dict) -> list[str]:
    """解析公交/地铁换乘方案为逐步指引。"""
    lines: list[str] = []
    segments = transit.get("segments") or []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        walking = seg.get("walking")
        if isinstance(walking, dict):
            dist = int(walking.get("distance") or 0)
            if dist > 0:
                tail = _walking_tail_label(walking)
                line = f"步行约 {dist} 米"
                if tail:
                    line += f"（{tail}）"
                lines.append(line)

        bus_block = seg.get("bus")
        if isinstance(bus_block, dict):
            for bl in bus_block.get("buslines") or []:
                if not isinstance(bl, dict):
                    continue
                name = str(bl.get("name") or "").strip()
                dep = str((bl.get("departure_stop") or {}).get("name") or "").strip()
                arr = str((bl.get("arrival_stop") or {}).get("name") or "").strip()
                if not (name and dep and arr):
                    continue
                via = bl.get("via_num")
                via_txt = f"，途经 {via} 站" if via not in (None, "", 0) else ""
                lines.append(f"乘坐 {name}，在 {dep} 上车{via_txt}，在 {arr} 下车")

        railway = seg.get("railway")
        if isinstance(railway, dict) and str(railway.get("name") or "").strip():
            rname = str(railway.get("name") or "").strip()
            dep = str((railway.get("departure_stop") or {}).get("name") or "").strip()
            arr = str((railway.get("arrival_stop") or {}).get("name") or "").strip()
            if dep and arr:
                lines.append(f"乘坐 {rname}，{dep} 上车，{arr} 下车")
            else:
                lines.append(f"乘坐 {rname}")

    return lines


def _format_path_steps(path: dict, *, max_steps: int = 10) -> list[str]:
    """驾车/步行分步导航。"""
    raw = path.get("steps") or []
    lines: list[str] = []
    for step in raw[:max_steps]:
        if not isinstance(step, dict):
            continue
        inst = str(step.get("instruction") or "").strip()
        if inst:
            lines.append(inst)
    if len(raw) > max_steps:
        lines.append(f"… 共 {len(raw)} 段导航指引")
    return lines


def _build_route_summary(
    *,
    mode_label: str,
    origin_name: str,
    dest_name: str,
    minutes: int,
    distance_m: int,
    route_steps: list[str],
) -> str:
    head = f"{mode_label}从「{origin_name}」到「{dest_name}」约 {minutes} 分钟"
    if distance_m:
        head += f"，{round(distance_m / 1000, 1)} 公里"
    if not route_steps:
        return head
    numbered = [f"{i}. {line}" for i, line in enumerate(route_steps, start=1)]
    return head + "\n\n推荐路线：\n" + "\n".join(numbered)


def get_route_plan(origin: str, destination: str, mode: str = "driving") -> dict[str, Any]:
    key = str(settings.ADMIN_AMAP_KEY or "").strip()
    o = str(origin or "").strip()
    d = str(destination or "").strip()
    if not key:
        return {"ok": False, "error": "not_configured"}
    if not o or not d:
        return {"ok": False, "error": "missing_address"}

    m = str(mode or "driving").strip().lower()
    path_map = {
        "driving": "direction/driving",
        "drive": "direction/driving",
        "walk": "direction/walking",
        "walking": "direction/walking",
        "transit": "direction/transit/integrated",
        "subway": "direction/transit/integrated",
        "metro": "direction/transit/integrated",
        "bus": "direction/transit/integrated",
        "bicycling": "direction/bicycling",
        "bike": "direction/bicycling",
    }
    api_path = path_map.get(m, "direction/driving")
    city_hint = _amap_city()

    try:
        with httpx.Client(timeout=20.0) as client:
            o_hit = _resolve_geo_point(o, client, city_hint)
            d_hit = _resolve_geo_point(d, client, city_hint)
            if not o_hit or not d_hit:
                return {
                    "ok": False,
                    "error": "geocode_failed",
                    "hint": f"无法解析地址，请使用更具体的地名（当前城市范围：{city_hint}）。",
                    "origin": o,
                    "destination": d,
                }
            req_params: dict[str, Any] = {
                "origin": o_hit.location,
                "destination": d_hit.location,
                "extensions": "all",
            }
            if api_path == "direction/transit/integrated":
                origin_city = _transit_city_param(o_hit)
                if not origin_city:
                    return {
                        "ok": False,
                        "error": "missing_transit_city",
                        "hint": "公交规划需要城市信息：请在 .env 设置 ADMIN_AMAP_CITY，或提供更具体的起终点地址。",
                        "origin": o_hit.name,
                        "destination": d_hit.name,
                    }
                req_params["city"] = origin_city
                dest_city = _transit_city_param(d_hit)
                if dest_city and dest_city != origin_city:
                    req_params["cityd"] = dest_city
                req_params["strategy"] = 0
            data = _amap_request(client, api_path, req_params)
            route = (data.get("route") or {}) if isinstance(data.get("route"), dict) else {}
            route_steps: list[str] = []

            if api_path == "direction/transit/integrated":
                paths = route.get("transits") or []
                first = paths[0] if isinstance(paths, list) and paths else {}
                duration_sec = int(first.get("duration") or 0)
                distance_m = int(first.get("distance") or first.get("walking_distance") or 0)
                if isinstance(first, dict):
                    route_steps = _format_transit_steps(first)
            else:
                paths = route.get("paths") or []
                first = paths[0] if isinstance(paths, list) and paths else {}
                duration_sec = int(first.get("duration") or 0)
                distance_m = int(first.get("distance") or 0)
                if isinstance(first, dict):
                    route_steps = _format_path_steps(first)

            if not paths:
                return {"ok": False, "error": "no_route", "hint": "未找到可用路线，可尝试换出行方式或更具体站点名。"}

            minutes = max(1, duration_sec // 60) if duration_sec else 0

            mode_label = {
                "driving": "驾车",
                "walk": "步行",
                "walking": "步行",
                "transit": "公交/地铁",
                "subway": "公交/地铁",
                "metro": "公交/地铁",
                "bus": "公交/地铁",
                "bicycling": "骑行",
                "bike": "骑行",
            }.get(m, "出行")

            summary = _build_route_summary(
                mode_label=mode_label,
                origin_name=o_hit.name,
                dest_name=d_hit.name,
                minutes=minutes,
                distance_m=distance_m,
                route_steps=route_steps,
            )

            return {
                "ok": True,
                "origin": o_hit.name,
                "destination": d_hit.name,
                "origin_location": o_hit.location,
                "destination_location": d_hit.location,
                "mode": m,
                "mode_label": mode_label,
                "duration_minutes": minutes,
                "distance_km": round(distance_m / 1000, 1) if distance_m else None,
                "route_steps": route_steps,
                "summary": summary,
            }
    except ValueError as e:
        return {"ok": False, "error": str(e), "hint": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
