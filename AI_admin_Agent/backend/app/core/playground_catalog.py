"""玩法台八件套 SSOT：供 API、集成页与前端卡片复用。"""
from __future__ import annotations

import os
from typing import Any

from app.core.mcp_playground import (
    PLAYGROUND_MCP_KEYS,
    check_mcp_gateway,
    mcp_sidecar_configured,
    parse_configured_mcp_servers,
)


def _env(name: str) -> str:
    return str(os.getenv(name) or "").strip()


def mineru_configured() -> bool:
    return bool(_env("MINERU_API_URL"))


def mcp_enabled() -> bool:
    return _env("ADMIN_MCP_ENABLED") == "1" and bool(parse_configured_mcp_servers())


def _base_items() -> list[dict[str, Any]]:
    return [
        {
            "id": "daily_quote",
            "name": "每日一句",
            "emoji": "💬",
            "tagline": "一言 / 精选语录，陪你开启今天",
            "tool": "get_daily_quote",
            "deployPhase": 1,
            "builtin": True,
            "samplePrompt": "来一句适合今天的话，顺便讲讲为什么",
        },
        {
            "id": "random_wiki",
            "name": "百科盲盒",
            "emoji": "📖",
            "tagline": "随机冷知识，开盒涨见识",
            "tool": "random_wiki_trivia",
            "deployPhase": 1,
            "builtin": True,
            "samplePrompt": "给我开一个百科盲盒，用朋友聊天的语气讲讲",
        },
        {
            "id": "tech_pulse",
            "name": "技术脉搏",
            "emoji": "⚡",
            "tagline": "GitHub / HN / 科技圈今日动态",
            "tool": "get_tech_pulse",
            "deployPhase": 1,
            "builtin": True,
            "samplePrompt": "GitHub 和 HN 今天有什么值得看的技术动态？挑 3 条讲讲",
        },
        {
            "id": "arxiv",
            "name": "论文角",
            "emoji": "📄",
            "tagline": "arXiv 检索预印本",
            "tool": "search_arxiv",
            "mcpServerKey": "arxiv",
            "mcpPath": "arxiv",
            "deployPhase": 3,
            "builtin": True,
            "mcpRef": "arxiv-mcp-server",
            "samplePrompt": "最近 arxiv 上 transformer efficiency 有什么新论文？",
        },
        {
            "id": "memory_graph",
            "name": "记忆墙",
            "emoji": "🧠",
            "tagline": "跨会话知识图谱",
            "tool": "memory_graph_manage",
            "mcpServerKey": "memory",
            "mcpPath": "memory",
            "deployPhase": 3,
            "builtin": True,
            "mcpRef": "server-memory",
            "samplePrompt": "记住：小李是我同事，负责后端；我们每周五站会",
        },
        {
            "id": "fetch_url",
            "name": "链接精读",
            "emoji": "🔗",
            "tagline": "抓取网页正文",
            "tool": "fetch_url_content",
            "mcpServerKey": "fetch",
            "mcpPath": "fetch",
            "deployPhase": 3,
            "builtin": True,
            "mcpRef": "server-fetch",
            "samplePrompt": "帮我精读这个链接并总结要点：https://example.com",
        },
        {
            "id": "parse_document",
            "name": "文档解析",
            "emoji": "📑",
            "tagline": "PDF / PPT（MinerU）",
            "tool": "parse_document",
            "deployPhase": 3,
            "builtin": True,
            "mcpRef": "MinerU",
            "samplePrompt": "解析工作区里的 report.pdf，提取目录和摘要",
        },
        {
            "id": "thinking_outline",
            "name": "分步推理",
            "emoji": "🧩",
            "tagline": "Sequential Thinking 规划",
            "tool": "create_thinking_outline",
            "mcpServerKey": "sequential_thinking",
            "mcpPath": "sequential-thinking",
            "deployPhase": 3,
            "builtin": True,
            "mcpRef": "sequential-thinking",
            "samplePrompt": "我想学 Rust 做 CLI 工具，帮我拆成 5 步计划",
        },
    ]


def playground_catalog() -> list[dict[str, Any]]:
    gateway = check_mcp_gateway()
    items: list[dict[str, Any]] = []
    for raw in _base_items():
        item = dict(raw)
        pid = str(item.get("id") or "")
        item["phase"] = 1
        item["builtinReady"] = True
        if pid == "parse_document":
            item["configured"] = mineru_configured()
            item["mineruSidecar"] = mineru_configured()
        else:
            item["configured"] = True
        mcp_key = PLAYGROUND_MCP_KEYS.get(pid)
        if mcp_key:
            item["mcpConfigured"] = mcp_sidecar_configured(pid) and mcp_enabled()
            item["mcpSidecarReady"] = bool(gateway.get("ok")) and item["mcpConfigured"]
        items.append(item)
    return items


def playground_summary() -> dict[str, Any]:
    items = playground_catalog()
    ready = [i for i in items if i.get("configured", True)]
    mcp_ready = [i for i in items if i.get("mcpSidecarReady")]
    gateway = check_mcp_gateway()
    return {
        "total": len(items),
        "ready": len(ready),
        "mcpSidecarEnabled": mcp_enabled(),
        "mcpGateway": gateway,
        "mcpSidecarReadyCount": len(mcp_ready),
        "mineruConfigured": mineru_configured(),
        "configuredMcpServers": list(parse_configured_mcp_servers().keys()),
        "items": items,
    }
