"""高德相关客户端上下文（浏览器定位），不含话术正则解析。"""
from __future__ import annotations

from typing import Any


def client_location_origin(client_context: dict | None) -> str:
    """把浏览器定位转成高德可识别的起点（地址或 lng,lat）。"""
    if not isinstance(client_context, dict):
        return ""
    loc = client_context.get("location")
    if not isinstance(loc, dict):
        return ""
    address = str(loc.get("address") or loc.get("formatted_address") or "").strip()
    if address:
        return address
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    if lat is not None and lng is not None:
        return f"{lng},{lat}"
    return ""


def format_client_location_line(client_context: dict | None) -> str:
    if not isinstance(client_context, dict):
        return "（未共享）"
    loc = client_context.get("location")
    if not isinstance(loc, dict):
        return "（未共享）"
    address = str(loc.get("address") or loc.get("formatted_address") or "").strip()
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    if address:
        return address
    if lat is not None and lng is not None:
        return f"坐标 {lng},{lat}"
    return "（未共享）"


def apply_client_location_to_tool_args(
    tool_name: str,
    tool_args: dict[str, Any] | None,
    client_context: dict | None,
    *,
    uses_current_location: bool = False,
) -> dict[str, Any]:
    """将「当前位置」占位替换为浏览器共享的地址/坐标。"""
    args = dict(tool_args or {})
    origin = client_location_origin(client_context)
    if tool_name == "get_travel_route":
        if uses_current_location or not str(args.get("origin") or "").strip():
            if origin:
                args["origin"] = origin
    if tool_name == "search_nearby_amap":
        if uses_current_location or not str(args.get("near_address") or "").strip():
            if origin:
                args["near_address"] = origin
    return args
