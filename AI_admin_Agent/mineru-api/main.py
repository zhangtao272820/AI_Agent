"""轻量 MinerU 兼容 API：PDF 文本提取（Phase 3 侧车，可换真实 MinerU）。"""
from __future__ import annotations

import io
import os
import re
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="admin-mineru-api", version="1.0.0")

_UA = "Mozilla/5.0 (compatible; Admin-MinerU-API/1.0)"


class ParseRequest(BaseModel):
    file_path: str = ""
    url: str = ""


def _strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def _read_pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf 未安装") from exc
    reader = PdfReader(path)
    parts: list[str] = []
    for page in reader.pages[:30]:
        parts.append(page.extract_text() or "")
    return "\n\n".join(p for p in parts if p.strip())


def _read_local(path: str) -> str:
    lower = path.lower()
    if lower.endswith(".pdf"):
        return _read_pdf(path)
    with open(path, encoding="utf-8", errors="ignore") as f:
        return f.read(12000)


def _fetch_url(url: str) -> str:
    with httpx.Client(timeout=30.0, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        resp = client.get(url)
        resp.raise_for_status()
        ctype = str(resp.headers.get("content-type") or "")
        if "pdf" in ctype or url.lower().endswith(".pdf"):
            try:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(resp.content))
                return "\n\n".join((p.extract_text() or "") for p in reader.pages[:30])
            except Exception:
                return resp.text[:8000]
        if "html" in ctype:
            return _strip_html(resp.text)[:8000]
        return resp.text[:8000]


@app.get("/health")
async def health():
    return {"ok": True, "service": "mineru_api", "mode": "lite-pypdf"}


@app.post("/parse")
async def parse_document(body: ParseRequest):
    url = str(body.url or "").strip()
    fpath = str(body.file_path or "").strip()
    workspace = str(os.getenv("MINERU_WORKSPACE_DIR") or "/data/workspace").strip()
    os.makedirs(workspace, exist_ok=True)

    try:
        if url:
            text = _fetch_url(url)
            source = url
        elif fpath:
            safe = os.path.basename(fpath)
            full = fpath if os.path.isabs(fpath) else os.path.join(workspace, safe)
            if not os.path.isfile(full):
                raise HTTPException(status_code=404, detail=f"文件不存在: {safe}")
            text = _read_local(full)
            source = safe
        else:
            raise HTTPException(status_code=400, detail="需要 file_path 或 url")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    text = str(text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="未能提取正文")
    return {
        "ok": True,
        "source": source,
        "text": text[:12000],
        "markdown": text[:12000],
        "provider": "mineru_api_lite",
    }
