from fastapi import APIRouter, HTTPException

from app.core.playground_catalog import playground_summary
from app.tools.playground import search_arxiv
from app.tools.playground_warm import get_daily_quote, get_tech_pulse, preview_daily_quote, random_wiki_trivia

router = APIRouter()


@router.get("/api/playground/catalog")
async def playground_catalog_api():
    return playground_summary()


@router.get("/api/playground/quote")
async def playground_quote_preview():
    preview = preview_daily_quote()
    if not preview.get("text"):
        result = get_daily_quote()
        if not result.get("ok"):
            raise HTTPException(status_code=502, detail=result.get("human_message") or "每日一句获取失败")
        data = result.get("data") or {}
        preview = {"text": data.get("quote"), "author": data.get("author")}
    return {"ok": True, **preview}


@router.get("/api/playground/tech")
async def playground_tech_preview(source: str = "all", limit: int = 6):
    result = get_tech_pulse(source=source, limit=limit)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("human_message") or "技术脉搏获取失败")
    data = result.get("data") or {}
    return {"ok": True, "items": data.get("items") or [], "count": data.get("count", 0)}


@router.get("/api/playground/wiki")
async def playground_wiki_preview():
    result = random_wiki_trivia()
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("human_message") or "百科盲盒失败")
    data = result.get("data") or {}
    return {
        "ok": True,
        "title": data.get("title"),
        "summary": data.get("summary"),
        "url": data.get("url"),
    }


@router.get("/api/playground/arxiv")
async def playground_arxiv_preview(q: str = "", limit: int = 5):
    query = str(q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="q 不能为空")
    result = search_arxiv(query, max_results=limit)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("human_message") or "检索失败")
    data = result.get("data") or {}
    return {"ok": True, "query": query, "papers": data.get("papers") or []}
