"""纯音乐：根据原曲推断源乐器，并选择对比明显的换音色目标。"""
from __future__ import annotations

import re
from typing import Any

# 源乐器线索（小写关键词）
_SOURCE_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("piano", ("piano", "钢琴", "keyboard", "键盘", "keys", "电钢", "electric_piano")),
    ("strings", ("string", "弦乐", "violin", "小提琴", "cello", "大提琴", "viola")),
    ("guitar", ("guitar", "吉他", "ukulele", "民谣")),
    ("flute", ("flute", "长笛", "笛", "recorder", "pan_flute")),
    ("synth", ("synth", "合成", "electronic", "edm", "电子", "pad")),
    ("harp", ("harp", "竖琴")),
]

# 换音色：避免与源乐器相同
_SWAP_BY_SOURCE: dict[str, tuple[str, ...]] = {
    "piano": ("flute", "violin", "harp", "oboe", "cello"),
    "strings": ("flute", "harp", "oboe", "clarinet"),
    "guitar": ("flute", "violin", "harp", "oboe"),
    "flute": ("violin", "harp", "oboe", "clarinet"),
    "synth": ("flute", "violin", "harp", "strings"),
    "harp": ("flute", "violin", "oboe"),
}

_SWAP_BY_STYLE: dict[str, str] = {
    "bgm": "flute",
    "classical": "violin",
    "folk": "flute",
    "jazz": "vibraphone",
    "electronic": "marimba",
    "jpop": "flute",
    "mandopop": "flute",
}


def _text_blob(analysis: dict[str, Any] | None, plan: dict[str, Any] | None, filename: str) -> str:
    a = analysis or {}
    p = plan or {}
    parts = [
        filename,
        str(a.get("filename") or ""),
        str(a.get("vocal_label") or ""),
        str(a.get("genre") or ""),
        str(a.get("style") or ""),
        str(a.get("note") or ""),
        str(p.get("notes") or ""),
        " ".join(str(x) for x in (p.get("instrument_family") or [])),
        str(p.get("mood") or ""),
    ]
    return " ".join(parts).lower()


def infer_source_instrument(
    analysis: dict[str, Any] | None,
    plan: dict[str, Any] | None,
    filename: str = "",
) -> str:
    """推断原曲主奏乐器（启发式）。"""
    blob = _text_blob(analysis, plan, filename)
    for source, keys in _SOURCE_HINTS:
        if any(k in blob for k in keys):
            return source
    family = [str(x).lower() for x in ((plan or {}).get("instrument_family") or [])]
    for f in family:
        if "piano" in f or "键盘" in f:
            return "piano"
        if "string" in f or "弦" in f:
            return "strings"
        if "guitar" in f or "吉他" in f:
            return "guitar"
        if "flute" in f or "笛" in f:
            return "flute"
        if "synth" in f or "合成" in f:
            return "synth"
    # 纯器乐 BGM 默认按钢琴处理（最常见）
    return "piano"


def infer_swap_lead_instrument(
    analysis: dict[str, Any] | None,
    plan: dict[str, Any] | None,
    filename: str = "",
) -> tuple[str, str]:
    """
    返回 (目标 lead 乐器, 推断的源乐器)。
    目标乐器保证与源不同，并随曲风微调。
    """
    source = infer_source_instrument(analysis, plan, filename)
    style = str((plan or {}).get("remix_style") or (plan or {}).get("style_hint") or "bgm").lower()
    style_pick = _SWAP_BY_STYLE.get(style)
    candidates = _SWAP_BY_SOURCE.get(source, _SWAP_BY_SOURCE["piano"])

    if style_pick and style_pick != source:
        lead = style_pick
    else:
        # 稳定但随文件名略有变化
        seed = sum(ord(c) for c in (filename or "x")) % len(candidates)
        lead = candidates[seed]

    if lead == source:
        for alt in candidates:
            if alt != source:
                lead = alt
                break
    return lead, source


def lead_swap_band_parts(lead_instrument: str) -> list[dict[str, Any]]:
    return [{"role": "melody", "channel": 0, "instrument": lead_instrument}]
