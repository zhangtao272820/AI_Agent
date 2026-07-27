"""玩法台内置工具：对应 MCP 趣味八件套 Phase 1。"""
from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.web_search import run_web_search
from app.tools.common import HTTP_TIMEOUT, _tool_err, _tool_ok

_ATOM = "{http://www.w3.org/2005/Atom}"
_UA = os.getenv(
    "PLAYGROUND_HTTP_UA",
    "Mozilla/5.0 (compatible; AI-Admin-Playground/1.0; +https://github.com/Agent)",
)


def _http_get(url: str, *, timeout: float = HTTP_TIMEOUT) -> httpx.Response:
    with httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        return client.get(url)


def _http_post(url: str, payload: dict[str, Any], *, timeout: float = 60.0) -> httpx.Response:
    with httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        return client.post(url, json=payload)


def _graph_path() -> str:
    os.makedirs(settings.WORKSPACE_DIR, exist_ok=True)
    return os.path.join(settings.WORKSPACE_DIR, "memory_graph.json")


def _load_graph() -> dict[str, Any]:
    path = _graph_path()
    if not os.path.isfile(path):
        return {"entities": [], "relations": []}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            data.setdefault("entities", [])
            data.setdefault("relations", [])
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"entities": [], "relations": []}


def _save_graph(data: dict[str, Any]) -> None:
    path = _graph_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _jobs_path() -> str:
    os.makedirs(settings.WORKSPACE_DIR, exist_ok=True)
    return os.path.join(settings.WORKSPACE_DIR, "scheduled_jobs.json")


def _load_jobs() -> list[dict[str, Any]]:
    path = _jobs_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</p>", "\n\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return re.sub(r" {2,}", " ", text).strip()


# Docker 内直连微博/B 站 API 会被反爬；改用自建 SearXNG 聚合（与 web_search 同链路）。
_HOT_PLATFORM_QUERIES: dict[str, tuple[str, str]] = {
    "weibo": ("weibo", "微博 热搜 今日"),
    "zhihu": ("zhihu", "知乎 热榜 今日"),
    "bilibili": ("bilibili", "site:bilibili.com 热门 推荐"),
    "news": ("news", "今日热点"),
}


def _searxng_hits(query: str, *, max_results: int = 6, mode: str = "general") -> list[dict[str, Any]]:
    _, hits, provider = run_web_search(query, max_results=max_results, mode=mode)
    if provider in ("empty_query", "none", "error", "mock") or not hits:
        return []
    return hits


def _hits_to_topics(hits: list[dict[str, Any]], platform: str, limit: int) -> list[dict[str, str]]:
    topics: list[dict[str, str]] = []
    for row in hits:
        title = str(row.get("title") or "").strip()
        url = str(row.get("url") or "").strip()
        if not title:
            continue
        topics.append(
            {
                "title": title,
                "url": url,
                "heat": str(row.get("snippet") or "")[:80],
                "platform": platform,
            }
        )
        if len(topics) >= limit:
            break
    return topics


def get_hot_topics(platform: str = "all", limit: int = 10) -> dict:
    plat = str(platform or "all").strip().lower()
    max_n = max(1, min(int(limit or 10), 20))
    per = max_n if plat != "all" else max(3, max_n // 3 + 1)
    targets = [plat] if plat in _HOT_PLATFORM_QUERIES else list(_HOT_PLATFORM_QUERIES.keys())
    topics: list[dict[str, str]] = []
    errors: list[str] = []
    for key in targets:
        label, query = _HOT_PLATFORM_QUERIES[key]
        mode = "news" if key == "news" else "general"
        try:
            hits = _searxng_hits(query, max_results=per + 2, mode=mode)
            batch = _hits_to_topics(hits, label, per)
            if batch:
                topics.extend(batch)
            else:
                errors.append(f"{key}: searxng 无结果")
        except Exception as exc:
            errors.append(f"{key}: {exc}")
    if not topics:
        return _tool_err(
            "热榜获取失败：请确认 Docker 中 searxng 已启动且 ADMIN_SEARCH_PROVIDER=auto。"
            + (" " + "; ".join(errors) if errors else ""),
            data={"ok": False, "platform": plat, "topics": [], "errors": errors, "source": "searxng"},
            code="hot_topics_failed",
        )
    lines = [f"· [{t.get('platform', '?')}] {t.get('title', '')}" for t in topics[:max_n]]
    return _tool_ok(
        "今日热榜（SearXNG 聚合）：\n" + "\n".join(lines),
        data={
            "ok": True,
            "platform": plat,
            "topics": topics[:max_n],
            "count": len(topics[:max_n]),
            "source": "searxng",
        },
        code="ok",
    )


def search_bilibili(query: str, limit: int = 5) -> dict:
    q = str(query or "").strip()
    if not q:
        return _tool_err("B 站搜索：query 不能为空", data={"ok": False}, code="missing_query")
    max_n = max(1, min(int(limit or 5), 10))
    search_q = f"site:bilibili.com {q}"
    try:
        hits = _searxng_hits(search_q, max_results=max_n + 5)
    except Exception as exc:
        return _tool_err(f"B 站搜索失败：{exc}", data={"ok": False, "query": q}, code="bilibili_failed")
    videos: list[dict[str, str]] = []
    for row in hits:
        url = str(row.get("url") or "").strip()
        if "bilibili.com" not in url:
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        videos.append(
            {
                "title": title,
                "author": "",
                "url": url,
                "description": str(row.get("snippet") or "")[:160],
            }
        )
        if len(videos) >= max_n:
            break
    if not videos and hits:
        for row in hits[:max_n]:
            title = str(row.get("title") or "").strip()
            if not title:
                continue
            videos.append(
                {
                    "title": title,
                    "author": "",
                    "url": str(row.get("url") or ""),
                    "description": str(row.get("snippet") or "")[:160],
                }
            )
    if not videos:
        return _tool_err(
            f"B 站未找到「{q}」相关内容（SearXNG）。请确认 searxng 容器 healthy。",
            data={"ok": False, "query": q, "videos": [], "source": "searxng"},
            code="no_hits",
        )
    lines = [f"· {v['title']}" + (f" — {v['url']}" if v.get("url") else "") for v in videos]
    return _tool_ok(
        f"B 站「{q}」搜索结果（SearXNG）：\n" + "\n".join(lines),
        data={"ok": True, "query": q, "videos": videos, "count": len(videos), "source": "searxng"},
        code="ok",
    )


def search_arxiv(query: str, max_results: int = 5) -> dict:
    q = str(query or "").strip()
    if not q:
        return _tool_err("arXiv 检索：query 不能为空", data={"ok": False}, code="missing_query")
    max_n = max(1, min(int(max_results or 5), 10))
    url = (
        "http://export.arxiv.org/api/query?"
        f"search_query=all:{quote(q)}&start=0&max_results={max_n}&sortBy=submittedDate&sortOrder=descending"
    )
    try:
        resp = _http_get(url, timeout=25.0)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
    except Exception as exc:
        return _tool_err(f"arXiv 检索失败：{exc}", data={"ok": False, "query": q}, code="arxiv_failed")
    papers: list[dict[str, str]] = []
    for entry in root.findall(f"{_ATOM}entry"):
        title = (entry.findtext(f"{_ATOM}title") or "").strip().replace("\n", " ")
        summary = (entry.findtext(f"{_ATOM}summary") or "").strip().replace("\n", " ")
        link = ""
        for link_el in entry.findall(f"{_ATOM}link"):
            if link_el.get("rel") == "alternate":
                link = str(link_el.get("href") or "")
                break
        published = (entry.findtext(f"{_ATOM}published") or "")[:10]
        authors = [
            (a.findtext(f"{_ATOM}name") or "").strip()
            for a in entry.findall(f"{_ATOM}author")
        ]
        papers.append(
            {
                "title": title,
                "summary": summary[:280],
                "url": link,
                "published": published,
                "authors": ", ".join(authors[:4]),
            }
        )
    if not papers:
        return _tool_err(f"arXiv 未找到「{q}」相关论文", data={"ok": False, "query": q, "papers": []}, code="no_hits")
    lines = [f"· {p['title']} ({p.get('published', '')})" for p in papers]
    return _tool_ok(
        f"arXiv「{q}」检索结果：\n" + "\n".join(lines),
        data={"ok": True, "query": q, "papers": papers, "count": len(papers)},
        code="ok",
    )


def memory_graph_manage(
    action: str = "list",
    entity_name: str = "",
    entity_type: str = "general",
    observation: str = "",
    relation_to: str = "",
    relation_type: str = "related_to",
    search_query: str = "",
) -> dict:
    act = str(action or "list").strip().lower()
    graph = _load_graph()
    entities: list[dict[str, Any]] = graph.setdefault("entities", [])
    relations: list[dict[str, Any]] = graph.setdefault("relations", [])

    def _find(name: str) -> dict[str, Any] | None:
        n = str(name or "").strip().lower()
        for ent in entities:
            if str(ent.get("name") or "").strip().lower() == n:
                return ent
        return None

    if act == "list":
        preview = [
            {"name": e.get("name"), "type": e.get("type"), "observations": (e.get("observations") or [])[:3]}
            for e in entities[:20]
        ]
        return _tool_ok(
            f"记忆墙共 {len(entities)} 个实体、{len(relations)} 条关系。",
            data={"ok": True, "entities": preview, "relation_count": len(relations)},
            code="ok",
        )

    if act == "search":
        q = str(search_query or entity_name or "").strip().lower()
        if not q:
            return _tool_err("记忆搜索：请提供 search_query", data={"ok": False}, code="missing_query")
        hits = [
            e for e in entities
            if q in str(e.get("name") or "").lower()
            or any(q in str(o).lower() for o in (e.get("observations") or []))
        ]
        return _tool_ok(
            f"找到 {len(hits)} 条相关记忆。",
            data={"ok": True, "query": q, "entities": hits[:15]},
            code="ok",
        )

    if act == "add":
        name = str(entity_name or "").strip()
        if not name:
            return _tool_err("添加记忆：entity_name 不能为空", data={"ok": False}, code="missing_name")
        ent = _find(name)
        if not ent:
            ent = {"id": f"e{len(entities) + 1}", "name": name, "type": entity_type or "general", "observations": []}
            entities.append(ent)
        obs = str(observation or "").strip()
        if obs:
            ent.setdefault("observations", []).append(obs)
        rel_target = str(relation_to or "").strip()
        if rel_target:
            other = _find(rel_target)
            if not other:
                other = {"id": f"e{len(entities) + 1}", "name": rel_target, "type": "general", "observations": []}
                entities.append(other)
            relations.append(
                {"from": ent.get("id"), "to": other.get("id"), "type": relation_type or "related_to"}
            )
        _save_graph(graph)
        return _tool_ok(
            f"已更新记忆：{name}" + (f"（关联 {rel_target}）" if rel_target else ""),
            data={"ok": True, "entity": ent, "relation_count": len(relations)},
            code="ok",
        )

    return _tool_err(f"未知 action：{act}（支持 list / search / add）", data={"ok": False}, code="invalid_action")


def list_scheduled_briefings() -> dict:
    jobs = _load_jobs()
    try:
        from app.core.reminders import reminder_manager

        active = reminder_manager.list_reminders() if hasattr(reminder_manager, "list_reminders") else []
    except Exception:
        active = []
    lines = []
    for j in jobs[:10]:
        lines.append(f"· {j.get('name', '未命名')} — {j.get('cron', j.get('schedule', '?'))}")
    if not lines:
        lines.append("· （暂无自定义 cron 任务，可用 add_reminder 添加定时提醒）")
    return _tool_ok(
        "定时简报 / 任务：\n" + "\n".join(lines),
        data={"ok": True, "jobs": jobs, "active_reminders": active},
        code="ok",
    )


def fetch_url_content(url: str, max_chars: int = 6000) -> dict:
    target = str(url or "").strip()
    if not target.startswith(("http://", "https://")):
        return _tool_err("链接精读：请提供 http(s) URL", data={"ok": False}, code="invalid_url")
    max_n = max(500, min(int(max_chars or 6000), 12000))
    try:
        resp = _http_get(target, timeout=20.0)
        resp.raise_for_status()
        ctype = str(resp.headers.get("content-type") or "")
        if "html" in ctype or "<html" in resp.text[:500].lower():
            text = _strip_html(resp.text)
        else:
            text = resp.text
        excerpt = text[:max_n]
        title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", resp.text)
        title = _strip_html(title_m.group(1)) if title_m else target
    except Exception as exc:
        return _tool_err(f"抓取失败：{exc}", data={"ok": False, "url": target}, code="fetch_failed")
    if not excerpt.strip():
        return _tool_err("页面无可用正文", data={"ok": False, "url": target}, code="empty_content")
    return _tool_ok(
        f"已抓取「{title}」正文（前 {len(excerpt)} 字）。",
        data={"ok": True, "url": target, "title": title, "excerpt": excerpt, "length": len(excerpt)},
        code="ok",
    )


def parse_document(file_path: str = "", url: str = "") -> dict:
    mineru = str(os.getenv("MINERU_API_URL") or "").strip().rstrip("/")
    target_url = str(url or "").strip()
    fname = os.path.basename(str(file_path or "").strip())
    if mineru:
        payload: dict[str, Any] = {}
        if target_url:
            payload["url"] = target_url
        elif fname:
            safe = os.path.join(settings.WORKSPACE_DIR, fname)
            if not os.path.isfile(safe):
                return _tool_err(f"工作区找不到文件：{fname}", data={"ok": False}, code="file_not_found")
            payload["file_path"] = safe
        else:
            return _tool_err("文档解析：请提供 file_path 或 url", data={"ok": False}, code="missing_input")
        try:
            resp = _http_post(f"{mineru}/parse", payload, timeout=120.0)
            resp.raise_for_status()
            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"text": resp.text}
            text = str(body.get("text") or body.get("content") or body.get("markdown") or "")[:8000]
            return _tool_ok(
                f"MinerU 解析完成（{len(text)} 字）。",
                data={"ok": True, "source": fname or target_url, "text": text, "provider": "mineru"},
                code="ok",
            )
        except Exception as exc:
            return _tool_err(f"MinerU 解析失败：{exc}", data={"ok": False}, code="mineru_failed")
    if fname:
        safe = os.path.join(settings.WORKSPACE_DIR, fname)
        if os.path.isfile(safe):
            try:
                with open(safe, encoding="utf-8", errors="ignore") as f:
                    snippet = f.read(2000)
                return _tool_ok(
                    f"MinerU 未配置，已读取文本文件前 {len(snippet)} 字（PDF/PPT 需配置 MINERU_API_URL）。",
                    data={"ok": True, "source": fname, "text": snippet, "provider": "local_text"},
                    code="local_fallback",
                )
            except OSError as exc:
                return _tool_err(f"读取失败：{exc}", data={"ok": False}, code="read_failed")
    return _tool_err(
        "文档解析未配置：请设置 MINERU_API_URL，或将 PDF 放入工作区后重试。",
        data={"ok": False, "hint": "见 doc/MCP趣味八件套-分阶段接入.md Phase 3"},
        code="mineru_not_configured",
    )


def create_thinking_outline(goal: str, steps: int = 5) -> dict:
    g = str(goal or "").strip()
    if not g:
        return _tool_err("分步规划：goal 不能为空", data={"ok": False}, code="missing_goal")
    n = max(3, min(int(steps or 5), 8))
    templates = [
        "澄清目标与约束",
        "拆解子问题 / 依赖",
        "收集信息与资源",
        "制定执行顺序",
        "风险与验证点",
        "落地第一步行动",
        "复盘与迭代",
        "收尾与文档化",
    ]
    outline = [{"step": i + 1, "title": templates[i] if i < len(templates) else f"步骤 {i + 1}"} for i in range(n)]
    lines = [f"{o['step']}. {o['title']}" for o in outline]
    return _tool_ok(
        f"「{g}」分步规划草案：\n" + "\n".join(lines),
        data={"ok": True, "goal": g, "steps": outline, "count": n},
        code="ok",
    )
