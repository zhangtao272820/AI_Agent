"""MCP HTTP 桥接：可选注册 streamable-http MCP 工具。"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable

import httpx

logger = logging.getLogger(__name__)

_MCP_TOOLS: dict[str, Callable[..., dict]] = {}
_MCP_LOADED = False


def mcp_enabled() -> bool:
    if os.getenv("ADMIN_MCP_ENABLED", "0").strip().lower() in ("0", "false", "no"):
        return False
    return bool(_parse_mcp_servers())


def _parse_mcp_servers() -> dict[str, dict[str, Any]]:
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


def _sanitize_name(server: str, tool: str) -> str:
    s = re.sub(r"[^\w.-]+", "_", str(server or "mcp"))
    t = re.sub(r"[^\w.-]+", "_", str(tool or "tool"))
    return f"mcp_{s}__{t}"[:64]


class _McpHttpClient:
    def __init__(self, server: str, cfg: dict[str, Any]):
        self.server = server
        self.url = str(cfg.get("url") or "").strip()
        self.headers = {str(k): str(v) for k, v in (cfg.get("headers") or {}).items()}
        self.session_id: str | None = None
        self._req_id = 0

    def _post(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.url:
            raise ValueError("MCP url missing")
        self._req_id += 1
        payload = {"jsonrpc": "2.0", "id": self._req_id, "method": method, "params": params or {}}
        headers = dict(self.headers)
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        with httpx.Client(timeout=float(os.getenv("ADMIN_MCP_TIMEOUT", "20"))) as client:
            resp = client.post(self.url, json=payload, headers=headers)
        if resp.headers.get("mcp-session-id"):
            self.session_id = resp.headers["mcp-session-id"]
        resp.raise_for_status()
        body = resp.json()
        if isinstance(body, list):
            for item in body:
                if isinstance(item, dict) and "result" in item:
                    return item
        if isinstance(body, dict):
            if body.get("error"):
                raise RuntimeError(str(body["error"]))
            return body
        return {}

    def initialize(self) -> None:
        self._post(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "ai_admin_agent", "version": "1.0.0"},
            },
        )
        try:
            self._post("notifications/initialized", {})
        except Exception:
            pass

    def list_tools(self) -> list[dict[str, Any]]:
        res = self._post("tools/list", {})
        tools = res.get("result", {}).get("tools", [])
        return tools if isinstance(tools, list) else []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        res = self._post("tools/call", {"name": name, "arguments": arguments})
        return res.get("result")


def _extract_tool_text(result: Any) -> str:
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, list):
            texts = [str(c.get("text") or "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
            if texts:
                return "\n".join(t for t in texts if t)
        if result.get("structuredContent") is not None:
            return json.dumps(result["structuredContent"], ensure_ascii=False, indent=2)
    if isinstance(result, str):
        return result
    return json.dumps(result, ensure_ascii=False)


def _make_tool_fn(client: _McpHttpClient, tool_name: str, lc_name: str) -> Callable[..., dict]:
    def _invoke(**kwargs: Any) -> dict:
        from app.tools.common import _tool_err, _tool_ok

        if kwargs.get("arguments_json"):
            try:
                args = json.loads(str(kwargs["arguments_json"]))
            except json.JSONDecodeError as exc:
                return _tool_err(f"MCP 参数 JSON 无效: {exc}", code="invalid_arguments_json")
        elif kwargs.get("input") is not None and len(kwargs) == 1:
            args = {"input": kwargs["input"]}
        else:
            args = dict(kwargs)
        try:
            raw = client.call_tool(tool_name, args if isinstance(args, dict) else {"input": str(args)})
            text = _extract_tool_text(raw)
            return _tool_ok(text or "MCP 工具执行完成", data={"tool": tool_name, "mcp": lc_name}, code="ok")
        except Exception as exc:
            return _tool_err(f"MCP 工具 {tool_name} 失败: {exc}", code="mcp_call_failed")

    _invoke.__name__ = lc_name  # type: ignore[attr-defined]
    return _invoke


def discover_mcp_tools() -> dict[str, Callable[..., dict]]:
    global _MCP_LOADED
    if _MCP_LOADED:
        return dict(_MCP_TOOLS)
    _MCP_LOADED = True
    if not mcp_enabled():
        return {}
    out: dict[str, Callable[..., dict]] = {}
    for server, cfg in _parse_mcp_servers().items():
        if str(cfg.get("type") or "streamable-http") != "streamable-http":
            continue
        client = _McpHttpClient(server, cfg)
        try:
            client.initialize()
            tools = client.list_tools()
        except Exception as exc:
            logger.warning("MCP server %s discovery failed: %s", server, exc)
            continue
        for tool in tools:
            name = str(tool.get("name") or "").strip()
            if not name:
                continue
            lc_name = _sanitize_name(server, name)
            out[lc_name] = _make_tool_fn(client, name, lc_name)
    _MCP_TOOLS.clear()
    _MCP_TOOLS.update(out)
    return dict(out)


def mcp_tool_names() -> list[str]:
    discover_mcp_tools()
    return sorted(_MCP_TOOLS.keys())


def mcp_summary() -> dict[str, Any]:
    names = mcp_tool_names()
    return {
        "enabled": mcp_enabled(),
        "configured": bool(_parse_mcp_servers()),
        "toolCount": len(names),
        "tools": names[:20],
    }
