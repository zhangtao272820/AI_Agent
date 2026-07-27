"""玩法台温情向工具：每日一句、百科盲盒、技术脉搏（Docker 友好）。"""
from __future__ import annotations

import hashlib
from datetime import date
from typing import Any

import httpx

from app.core.web_search import run_web_search
from app.tools.common import HTTP_TIMEOUT, _tool_err, _tool_ok

_UA = "Mozilla/5.0 (compatible; AI-Admin-Playground/1.0)"

_CURATED_QUOTES: list[dict[str, str]] = [
    {"text": "生活不是等待风暴过去，而是学会在雨中跳舞。", "author": "维维安·格林", "source": "local"},
    {"text": "你要允许一些事发生过，然后允许它们离开。", "author": "佚名", "source": "local"},
    {"text": "慢一点没关系，只要在走就好。", "author": "佚名", "source": "local"},
    {"text": "今天能好好吃饭、好好睡觉，就已经是很棒的一天。", "author": "Admin", "source": "local"},
    {"text": "不必和 everyone 比进度，你有自己的时区。", "author": "佚名", "source": "local"},
    {"text": "把复杂的事拆小步，每一步都值得被看见。", "author": "Admin", "source": "local"},
    {"text": "休息不是偷懒，是为了走更远。", "author": "佚名", "source": "local"},
    {"text": "你已经在很多不容易的时刻撑过来了。", "author": "Admin", "source": "local"},
    {"text": "好奇心是最好的长期主义。", "author": "Admin", "source": "local"},
    {"text": "先完成，再完美。", "author": "佚名", "source": "local"},
    {"text": "代码会报错，人生也会，但都能 debug。", "author": "Admin", "source": "local"},
    {"text": "给未来的自己留一点温柔。", "author": "Admin", "source": "local"},
]

_CURATED_TRIVIA: list[dict[str, str]] = [
    {
        "title": "为什么键盘不是按字母顺序排列？",
        "summary": "早期打字机时代为避免机械连键卡住，QWERTY 布局被设计出来并沿用至今。",
        "url": "",
    },
    {
        "title": "蜂蜜为什么几乎不会变质？",
        "summary": "低含水量、酸性环境和天然抑菌成分，让密封蜂蜜可保存极长时间。",
        "url": "",
    },
    {
        "title": "章鱼有几颗心脏？",
        "summary": "三只——两颗负责把血送到鳃，一颗负责把血送到全身。",
        "url": "",
    },
    {
        "title": "香蕉在植物学上算什么？",
        "summary": "香蕉是浆果（berry），不是树果；香蕉树其实是巨型草本。",
        "url": "",
    },
    {
        "title": "一天其实不总是 24 小时整",
        "summary": "地球自转略有不均匀，所以闰秒会偶尔调整，让原子时与天文时对齐。",
        "url": "",
    },
    {
        "title": "为什么镜子左右颠倒但不上下颠倒？",
        "summary": "镜子沿法线翻转前后方向；「左右」是我们相对身体坐标系的感受。",
        "url": "",
    },
    {
        "title": "第一台电子游戏长什么样？",
        "summary": "1958 年《Tennis for Two》在示波器上显示网球，可算早期电子游戏之一。",
        "url": "",
    },
    {
        "title": "Git 为什么叫 Git？",
        "summary": "Linus Torvalds 自嘲取名，在英式俚语里有「讨厌的人」之意——项目起初只是个人工具。",
        "url": "",
    },
    {
        "title": "云有多重？",
        "summary": "一朵普通 cumulus 云可重达数百吨，因水滴/冰晶分散在空中而浮着。",
        "url": "",
    },
    {
        "title": "人类 DNA 与香蕉",
        "summary": "人类与香蕉共享一部分同源基因——生命在演化上彼此关联，不是「变成香蕉」。",
        "url": "",
    },
]

_TECH_QUERIES: dict[str, tuple[str, str]] = {
    "github": ("github", "github trending open source today"),
    "hn": ("hn", "hacker news top stories today"),
    "news": ("news", "科技新闻 今日 热点"),
}


def _day_seed(extra: str = "") -> int:
    raw = f"{date.today().isoformat()}:{extra}"
    return int(hashlib.sha256(raw.encode()).hexdigest()[:12], 16)


def _pick_daily(items: list[dict[str, str]], extra: str = "") -> dict[str, str]:
    idx = _day_seed(extra) % len(items)
    return dict(items[idx])


def _searxng_hits(query: str, *, max_results: int = 6, mode: str = "general") -> list[dict[str, Any]]:
    _, hits, provider = run_web_search(query, max_results=max_results, mode=mode)
    if provider in ("empty_query", "none", "error", "mock") or not hits:
        return []
    return hits


def _fetch_hitokoto(category: str = "") -> dict[str, str] | None:
    params: dict[str, str] = {"encode": "json"}
    cat = str(category or "").strip().lower()
    if cat in ("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"):
        params["c"] = cat
    try:
        with httpx.Client(timeout=min(HTTP_TIMEOUT, 10.0), headers={"User-Agent": _UA}) as client:
            resp = client.get("https://v1.hitokoto.cn/", params=params)
            resp.raise_for_status()
            body = resp.json()
        text = str(body.get("hitokoto") or "").strip()
        if not text:
            return None
        author = str(body.get("from") or body.get("from_who") or "一言").strip() or "一言"
        return {"text": text, "author": author, "source": "hitokoto"}
    except Exception:
        return None


def _fetch_wikipedia_random(language: str = "zh") -> dict[str, str] | None:
    lang = "zh" if str(language or "").startswith("zh") else "en"
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/random/summary"
    try:
        with httpx.Client(timeout=8.0, headers={"User-Agent": _UA}) as client:
            resp = client.get(url)
            resp.raise_for_status()
            body = resp.json()
        title = str(body.get("title") or "").strip()
        summary = str(body.get("extract") or "").strip()
        page_url = str(body.get("content_urls", {}).get("desktop", {}).get("page") or "").strip()
        if title and summary:
            return {"title": title, "summary": summary[:480], "url": page_url, "source": f"wikipedia-{lang}"}
    except Exception:
        return None
    return None


def get_daily_quote(theme: str = "") -> dict:
    """每日一句：一言 API + 本地精选兜底（同一天相对稳定）。"""
    theme_key = str(theme or "").strip().lower()
    cat_map = {"诗词": "i", "哲学": "k", "电影": "h", "游戏": "g", "文学": "d"}
    hit = _fetch_hitokoto(cat_map.get(theme_key, ""))
    if not hit:
        hit = _pick_daily(_CURATED_QUOTES, theme_key or "quote")
    text = hit["text"]
    author = hit.get("author") or ""
    source = hit.get("source") or "local"
    human = f"「{text}」" + (f" —— {author}" if author else "")
    return _tool_ok(
        human,
        data={"ok": True, "quote": text, "author": author, "source": source, "theme": theme_key or "default"},
        code="ok",
    )


def random_wiki_trivia(language: str = "zh") -> dict:
    """百科盲盒：维基随机条目 + 本地冷知识兜底。"""
    item = _fetch_wikipedia_random(language)
    if not item:
        item = _pick_daily(_CURATED_TRIVIA, f"wiki-{language}")
        item.setdefault("source", "local")
    title = str(item.get("title") or "冷知识").strip()
    summary = str(item.get("summary") or "").strip()
    url = str(item.get("url") or "").strip()
    human = f"📖 {title}\n\n{summary}"
    if url:
        human += f"\n\n阅读原文：{url}"
    return _tool_ok(
        human,
        data={
            "ok": True,
            "title": title,
            "summary": summary,
            "url": url,
            "source": str(item.get("source") or "local"),
        },
        code="ok",
    )


def get_tech_pulse(source: str = "all", limit: int = 6) -> dict:
    """技术脉搏：GitHub / HN / 科技新闻（SearXNG 聚合）。"""
    src = str(source or "all").strip().lower()
    max_n = max(1, min(int(limit or 6), 12))
    per = max_n if src != "all" else max(2, max_n // 3 + 1)
    targets = [src] if src in _TECH_QUERIES else list(_TECH_QUERIES.keys())
    items: list[dict[str, str]] = []
    errors: list[str] = []
    for key in targets:
        label, query = _TECH_QUERIES[key]
        mode = "news" if key == "news" else "general"
        try:
            hits = _searxng_hits(query, max_results=per + 2, mode=mode)
            for row in hits:
                title = str(row.get("title") or "").strip()
                if not title:
                    continue
                items.append(
                    {
                        "title": title,
                        "url": str(row.get("url") or ""),
                        "snippet": str(row.get("snippet") or "")[:160],
                        "source": label,
                    }
                )
                if sum(1 for x in items if x.get("source") == label) >= per:
                    break
            if not any(x.get("source") == label for x in items):
                errors.append(f"{key}: 无结果")
        except Exception as exc:
            errors.append(f"{key}: {exc}")
    if not items:
        return _tool_err(
            "技术脉搏获取失败，请确认 searxng 容器 healthy。",
            data={"ok": False, "items": [], "errors": errors, "source": "searxng"},
            code="tech_pulse_failed",
        )
    lines = [f"· [{it.get('source', '?')}] {it.get('title', '')}" for it in items[:max_n]]
    return _tool_ok(
        "技术圈今日脉搏（SearXNG）：\n" + "\n".join(lines),
        data={"ok": True, "items": items[:max_n], "count": len(items[:max_n]), "source": "searxng"},
        code="ok",
    )


def preview_daily_quote() -> dict[str, str]:
    """玩法台顶栏预览：轻量每日一句。"""
    result = get_daily_quote()
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    return {
        "text": str(data.get("quote") or ""),
        "author": str(data.get("author") or ""),
    }
