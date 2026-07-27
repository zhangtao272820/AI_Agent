#!/usr/bin/env python3
"""Smoke: MCP 趣味八件套 Phase 1 内置工具。"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.tools.registry import AVAILABLE_TOOLS


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    names = [
        "get_daily_quote",
        "random_wiki_trivia",
        "get_tech_pulse",
        "search_arxiv",
        "memory_graph_manage",
        "list_scheduled_briefings",
        "fetch_url_content",
        "parse_document",
        "create_thinking_outline",
    ]
    for n in names:
        assert_true(n in AVAILABLE_TOOLS, f"missing tool {n}")

    outline = AVAILABLE_TOOLS["create_thinking_outline"](goal="smoke test", steps=4)
    assert_true(outline.get("ok"), "create_thinking_outline failed")
    assert_true((outline.get("data") or {}).get("steps"), "outline steps empty")

    mem = AVAILABLE_TOOLS["memory_graph_manage"](action="list")
    assert_true(mem.get("ok"), "memory_graph_manage list failed")

    quote = AVAILABLE_TOOLS["get_daily_quote"]()
    assert_true(quote.get("ok"), "get_daily_quote failed")

    wiki = AVAILABLE_TOOLS["random_wiki_trivia"]()
    assert_true(wiki.get("ok"), "random_wiki_trivia failed")

    from app.core.playground_catalog import playground_summary
    from app.core.playground_cards import playground_tool_to_ui_card

    summary = playground_summary()
    assert_true(summary.get("total") == 8, "playground catalog should have 8 items")

    card = playground_tool_to_ui_card("create_thinking_outline", outline)
    assert_true(card and card.get("type") == "thinking_outline", "thinking card missing")

    from app.core.mcp_playground import default_mcp_servers_json, PLAYGROUND_MCP_KEYS

    servers_json = default_mcp_servers_json()
    assert_true("arxiv" in servers_json and "admin_mcp_gateway" in servers_json, "default mcp servers json")
    assert_true(len(PLAYGROUND_MCP_KEYS) >= 4, "playground mcp keys")

    summary = playground_summary()
    assert_true(summary.get("mcpGateway") is not None, "mcp gateway check missing")

    print("smoke_playground: OK")


if __name__ == "__main__":
    main()
