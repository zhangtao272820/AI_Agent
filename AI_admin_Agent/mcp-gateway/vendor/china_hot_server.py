"""Phase 2 内置 stdio MCP：国内热榜（无需 GitHub 拉取）。"""
from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("china-hot")
_UA = os.getenv("PLAYGROUND_HTTP_UA", "Mozilla/5.0 (compatible; Admin-China-Hot-MCP/1.0)")


def _get(url: str) -> dict[str, Any]:
    with httpx.Client(timeout=15.0, follow_redirects=True, headers={"User-Agent": _UA}) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.json()


@mcp.tool()
def weibo_trending(limit: int = 10) -> str:
    """微博热搜榜"""
    data = _get("https://weibo.com/ajax/side/hotSearch")
    items = []
    for row in (data.get("data") or {}).get("realtime") or []:
        word = str(row.get("word") or row.get("note") or "").strip()
        if word:
            items.append({"title": word, "heat": row.get("num"), "url": f"https://s.weibo.com/weibo?q={quote(word)}"})
        if len(items) >= max(1, min(limit, 20)):
            break
    return json.dumps(items, ensure_ascii=False, indent=2)


@mcp.tool()
def zhihu_trending(limit: int = 10) -> str:
    """知乎热榜"""
    data = _get("https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50")
    items = []
    for row in data.get("data") or []:
        target = row.get("target") if isinstance(row.get("target"), dict) else {}
        title = str(target.get("title") or row.get("title") or "").strip()
        if not title:
            continue
        qid = str(target.get("id") or "")
        items.append({"title": title, "url": f"https://www.zhihu.com/question/{qid}" if qid else "https://www.zhihu.com/hot"})
        if len(items) >= max(1, min(limit, 20)):
            break
    return json.dumps(items, ensure_ascii=False, indent=2)


@mcp.tool()
def bilibili_trending(limit: int = 10) -> str:
    """B 站热门"""
    data = _get(f"https://api.bilibili.com/x/web-interface/popular?ps={max(1, min(limit, 20))}")
    items = []
    for row in (data.get("data") or {}).get("list") or []:
        title = str(row.get("title") or "").strip()
        bvid = str(row.get("bvid") or "")
        if title:
            items.append({"title": title, "url": f"https://www.bilibili.com/video/{bvid}" if bvid else "", "view": (row.get("stat") or {}).get("view")})
        if len(items) >= max(1, min(limit, 20)):
            break
    return json.dumps(items, ensure_ascii=False, indent=2)


@mcp.tool()
def all_hot_topics(limit: int = 10) -> str:
    """全平台热榜汇总"""
    out: dict[str, list] = {}
    for name, fn in [("weibo", weibo_trending), ("zhihu", zhihu_trending), ("bilibili", bilibili_trending)]:
        try:
            out[name] = json.loads(fn(limit=limit))
        except Exception as exc:
            out[name] = [{"error": str(exc)}]
    return json.dumps(out, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
