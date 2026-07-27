"""httpx 版本兼容：spleeter 等旧依赖可能降级 httpx，导致 follow_redirects 不可用。"""
from __future__ import annotations

import httpx


def async_client(**kwargs) -> httpx.AsyncClient:
    kw = dict(kwargs)
    if "follow_redirects" not in kw:
        kw["follow_redirects"] = True
    try:
        return httpx.AsyncClient(**kw)
    except TypeError:
        kw.pop("follow_redirects", None)
        return httpx.AsyncClient(**kw)
