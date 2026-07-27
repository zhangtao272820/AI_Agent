"""Phase 2 内置 stdio MCP：B 站搜索/热门（无需 GitHub 拉取）。"""
from __future__ import annotations

import json
import os
import re
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("bilibili")
_UA = os.getenv("PLAYGROUND_HTTP_UA", "Mozilla/5.0 (compatible; Admin-Bilibili-MCP/1.0)")


def _strip_em(title: str) -> str:
    return re.sub(r"</?em[^>]*>", "", str(title or ""))

@mcp.tool()
def bili_search(keyword: str, limit: int = 5) -> str:
    """按关键词搜索 B 站视频"""
    q = str(keyword or "").strip()
    if not q:
        return json.dumps({"error": "keyword 不能为空"}, ensure_ascii=False)
    url = f"https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={quote(q)}&page=1"
    with httpx.Client(timeout=15.0, follow_redirects=True, headers={"User-Agent": _UA}) as c:
        data = c.get(url).json()
    videos = []
    for row in (data.get("data") or {}).get("result") or []:
        title = _strip_em(str(row.get("title") or ""))
        bvid = str(row.get("bvid") or "")
        if not title:
            continue
        videos.append({
            "title": title,
            "author": row.get("author"),
            "url": f"https://www.bilibili.com/video/{bvid}" if bvid else "",
            "description": str(row.get("description") or "")[:160],
        })
        if len(videos) >= max(1, min(int(limit or 5), 10)):
            break
    return json.dumps({"query": q, "videos": videos}, ensure_ascii=False, indent=2)


@mcp.tool()
def bili_hot_videos(limit: int = 10) -> str:
    """B 站当前热门视频"""
    url = f"https://api.bilibili.com/x/web-interface/popular?ps={max(1, min(int(limit or 10), 20))}"
    with httpx.Client(timeout=15.0, follow_redirects=True, headers={"User-Agent": _UA}) as c:
        data = c.get(url).json()
    videos = []
    for row in (data.get("data") or {}).get("list") or []:
        title = str(row.get("title") or "").strip()
        bvid = str(row.get("bvid") or "")
        if title:
            videos.append({"title": title, "url": f"https://www.bilibili.com/video/{bvid}" if bvid else "", "view": (row.get("stat") or {}).get("view")})
    return json.dumps({"videos": videos}, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
