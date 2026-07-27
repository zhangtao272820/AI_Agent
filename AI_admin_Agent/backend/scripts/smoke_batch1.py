"""Batch 1 smoke: RAG client, web search, manager profile, tool modules (no live RAG/SMTP)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("ADMIN_SEARCH_MOCK", "1")
os.environ.setdefault("ADMIN_LOAD_PLAYBOOK", "1")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> None:
    from app.tools.registry import AVAILABLE_TOOLS

    assert_true("knowledge_retrieval" in AVAILABLE_TOOLS, "knowledge_retrieval missing")
    assert_true("web_search" in AVAILABLE_TOOLS, "web_search missing")

    from app.tools.search import web_search

    ws = web_search("批次1 smoke 测试")
    assert_true(isinstance(ws, dict) and ws.get("ok"), "web_search should ok in mock mode")
    assert_true(ws.get("data", {}).get("provider") == "mock", "expected mock provider")

    from app.core.rag_client import format_rag_retrieve_for_tool

    human, data = format_rag_retrieve_for_tool(
        {
            "ok": True,
            "evidence": [{"source": "doc.md", "content": "测试证据片段"}],
            "citations": [{"source": "doc.md", "quote": "测试"}],
        },
        "测试问句",
    )
    assert_true("doc.md" in human, "rag format should include source")
    assert_true(data.get("hits") == 1, "rag hits should be 1")

    from app.core.manager_profile import format_manager_profile_block

    with tempfile.TemporaryDirectory() as tmp:
        prof_file = Path(tmp) / "manager-user-profiles.json"
        prof_file.write_text(
            json.dumps(
                {
                    "session:smoke": {
                        "sessionId": "smoke",
                        "runCount": 3,
                        "successCount": 2,
                        "intentCounts": {"admin": 2},
                        "lastIntent": "admin",
                        "recentSuccessSummaries": ["创建了会议提醒"],
                    }
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        with patch("app.core.manager_profile._profiles_file", return_value=prof_file):
            block = format_manager_profile_block("smoke", None)
            assert_true("总管用户画像" in block, "manager profile block missing")
            assert_true("admin" in block, "intent should appear in profile")

    from app.core.memory_context import build_memory_context

    ctx = build_memory_context("default", "user-1")
    assert_true(isinstance(ctx, str), "memory context must be str")

    from app.core.web_search import resolve_search_provider, is_searxng_configured

    with patch.dict(os.environ, {"ADMIN_SEARCH_MOCK": "1"}, clear=False):
        from app.core import web_search as ws_mod

        assert_true(ws_mod.search_mock_enabled(), "mock flag")

    with patch.dict(
        os.environ,
        {"SEARXNG_BASE_URL": "http://searxng:8080", "ADMIN_SEARCH_PROVIDER": "auto", "ADMIN_SEARCH_MOCK": "0"},
        clear=False,
    ):
        assert_true(is_searxng_configured(), "searxng configured")
        assert_true(resolve_search_provider() == "searxng", "auto prefers searxng")

    from app.tools.knowledge import knowledge_retrieval

    with patch.dict(os.environ, {"RAG_AGENT_URL": ""}, clear=False):
        from app.core import config as cfg_mod

        cfg_mod.settings.RAG_AGENT_URL = ""
        kr = knowledge_retrieval("公司制度")
        assert_true(kr.get("code") == "rag_not_configured", "should fail without RAG URL")

    print("smoke: admin-batch1 ok")


if __name__ == "__main__":
    main()
