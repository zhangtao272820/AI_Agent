"""解析可用的 Magenta sgm_plus SoundFont 上游（国内优先走 ghproxy，再回退 GCS）。"""
from __future__ import annotations

import logging

import httpx

from .config import get_settings
from .httpx_compat import async_client

logger = logging.getLogger(__name__)

_resolved_base: str | None = None

_BUILTIN_ORDER = (
    "https://ghproxy.net/https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",
    "https://mirror.ghproxy.com/https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",
    "https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus",
)


def _candidate_bases() -> list[str]:
    s = get_settings()
    seen: set[str] = set()
    out: list[str] = []
    for raw in (
        s.midi_soundfont_upstream,
        *s.midi_soundfont_upstream_fallbacks.split(","),
        *_BUILTIN_ORDER,
    ):
        b = (raw or "").strip().rstrip("/")
        if not b or b in seen:
            continue
        seen.add(b)
        out.append(b)
    return out


async def resolve_soundfont_base() -> str:
    """探测 soundfont.json 可访问的基址，结果缓存到进程内。"""
    global _resolved_base
    if _resolved_base:
        return _resolved_base

    candidates = _candidate_bases()
    timeout = httpx.Timeout(15.0, connect=6.0)
    async with async_client(timeout=timeout) as client:
        for base in candidates:
            url = f"{base}/soundfont.json"
            try:
                r = await client.get(url)
                if r.status_code != 200:
                    continue
                data = r.json()
                if isinstance(data, dict) and "instruments" in data:
                    _resolved_base = base
                    logger.info("MIDI SoundFont 使用上游: %s", base)
                    return base
            except Exception as e:
                logger.debug("SoundFont 探测失败 %s: %s", url, e)

    _resolved_base = candidates[-1] if candidates else _BUILTIN_ORDER[-1]
    logger.warning("SoundFont 全部探测失败，仍使用末项基址: %s", _resolved_base)
    return _resolved_base


def reset_soundfont_base_cache() -> None:
    global _resolved_base
    _resolved_base = None
