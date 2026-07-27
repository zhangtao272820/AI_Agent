"""玩法台工具 → 前端 UI 卡片。"""
from __future__ import annotations

from typing import Any


def playground_tool_to_ui_card(tool_name: str, tool_result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(tool_result, dict) or not tool_result.get("ok"):
        return None
    data = tool_result.get("data")
    if not isinstance(data, dict) or data.get("ok") is False:
        return None

    if tool_name == "get_daily_quote":
        quote = str(data.get("quote") or "").strip()
        if not quote:
            return None
        return {
            "type": "daily_quote",
            "title": "每日一句",
            "quote": quote,
            "author": str(data.get("author") or ""),
        }

    if tool_name == "random_wiki_trivia":
        title = str(data.get("title") or "").strip()
        summary = str(data.get("summary") or "").strip()
        if not title or not summary:
            return None
        return {
            "type": "random_wiki",
            "title": title,
            "summary": summary,
            "url": str(data.get("url") or ""),
        }

    if tool_name == "get_tech_pulse":
        items = data.get("items") or []
        if not items:
            return None
        return {
            "type": "tech_pulse",
            "title": "技术脉搏",
            "items": items[:10],
        }

    if tool_name == "get_hot_topics":
        topics = data.get("topics") or []
        if not topics:
            return None
        return {
            "type": "hot_topics",
            "title": "今日热榜",
            "platform": str(data.get("platform") or "all"),
            "items": topics[:12],
        }

    if tool_name == "search_bilibili":
        videos = data.get("videos") or []
        if not videos:
            return None
        return {
            "type": "bilibili_search",
            "title": f"B 站 · {data.get('query') or '搜索'}",
            "query": str(data.get("query") or ""),
            "videos": videos[:8],
        }

    if tool_name == "search_arxiv":
        papers = data.get("papers") or []
        if not papers:
            return None
        return {
            "type": "arxiv_search",
            "title": f"arXiv · {data.get('query') or '检索'}",
            "query": str(data.get("query") or ""),
            "papers": papers[:8],
        }

    if tool_name == "fetch_url_content":
        excerpt = str(data.get("excerpt") or "").strip()
        if not excerpt:
            return None
        return {
            "type": "fetch_url",
            "title": str(data.get("title") or "网页精读"),
            "url": str(data.get("url") or ""),
            "excerpt": excerpt[:1200],
        }

    if tool_name == "memory_graph_manage":
        entities = data.get("entities") or []
        if not entities:
            return None
        return {
            "type": "memory_graph",
            "title": "记忆墙",
            "entities": entities[:12],
            "relation_count": data.get("relation_count"),
        }

    if tool_name == "create_thinking_outline":
        steps = data.get("steps") or []
        if not steps:
            return None
        return {
            "type": "thinking_outline",
            "title": f"分步规划 · {data.get('goal') or ''}"[:80],
            "goal": str(data.get("goal") or ""),
            "steps": steps,
        }

    return None
