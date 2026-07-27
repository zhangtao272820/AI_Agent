"""MCP 网关与玩法台侧车状态。"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

# playground item id → ADMIN_MCP_SERVERS key
PLAYGROUND_MCP_KEYS: dict[str, str] = {
    "arxiv": "arxiv",
    "memory_graph": "memory",
    "fetch_url": "fetch",
    "thinking_outline": "sequential_thinking",
}


def mcp_gateway_base_url() -> str:
    return str(os.getenv("ADMIN_MCP_GATEWAY_URL") or "http://admin_mcp_gateway:8790").strip().rstrip("/")


def default_mcp_servers_json() -> str:
    """fun-mcp profile 默认侧车注册表（单行 JSON）。"""
    base = mcp_gateway_base_url()
    servers = {
        key: {"type": "streamable-http", "url": f"{base}/mcp/{path}"}
        for key, path in [
            ("arxiv", "arxiv"),
            ("memory", "memory"),
            ("cron", "cron"),
            ("fetch", "fetch"),
            ("sequential_thinking", "sequential-thinking"),
        ]
    }
    return json.dumps(servers, ensure_ascii=False, separators=(",", ":"))


def parse_configured_mcp_servers() -> dict[str, dict[str, Any]]:
    raw = str(os.getenv("ADMIN_MCP_SERVERS") or os.getenv("ADMIN_MCP_URL") or "").strip()
    if not raw:
        return {}
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return {str(k): v for k, v in parsed.items() if k and isinstance(v, dict)}
        except json.JSONDecodeError:
            return {}
    return {"default": {"type": "streamable-http", "url": raw}}


def mcp_sidecar_configured(playground_id: str) -> bool:
    key = PLAYGROUND_MCP_KEYS.get(playground_id)
    if not key:
        return False
    return key in parse_configured_mcp_servers()


def check_mcp_gateway() -> dict[str, Any]:
    url = f"{mcp_gateway_base_url()}/health"
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url)
        ok = resp.status_code == 200
        return {"ok": ok, "url": mcp_gateway_base_url(), "status": resp.status_code}
    except Exception as exc:
        return {"ok": False, "url": mcp_gateway_base_url(), "error": str(exc)}
