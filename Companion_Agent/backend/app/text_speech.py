"""清洗 TTS 朗读文本。"""

from __future__ import annotations

import re
import unicodedata

_EMOJI_RE = re.compile(
    "["
    "\U0001f1e0-\U0001f1ff"
    "\U0001f300-\U0001f9ff"
    "\U0001fa00-\U0001faff"
    "\U0001f600-\U0001f64f"
    "\u2600-\u27bf"
    "\u200d"
    "\ufe0f"
    "]+",
    flags=re.UNICODE,
)
_ACTION_RE = re.compile(r"[（(][^）)]+[）)]")
_NAME_PREFIX_RE = re.compile(r"^[\u4e00-\u9fffA-Za-z]{1,8}[:：]\s*")


def sanitize_for_speech(text: str) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", text.strip())
    s = _ACTION_RE.sub("", s)
    s = _EMOJI_RE.sub("", s)
    s = _NAME_PREFIX_RE.sub("", s)
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip()
