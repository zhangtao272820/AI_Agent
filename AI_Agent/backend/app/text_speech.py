"""将 LLM 回复清洗为适合 TTS / 对口型的文本（去掉表情与无用符号）。"""

from __future__ import annotations

import re
import unicodedata

# 常见 emoji / 符号区段
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

# 装饰性符号（一般不朗读）
_DECORATIVE_RE = re.compile(r"[~～^_*#`|\\<>【】\[\]{}「」『』《》]+")

# ASCII 颜文字
_EMOTICON_RE = re.compile(r"[:;8][-~]?[)(DPp3Oo]|<3")

# 方括号/圆括号内仅含非汉字内容，如 [微笑]、(笑)
_BRACKET_NOISE_RE = re.compile(
    r"[\[【（(][^\u4e00-\u9fff\w]{1,12}[\]】）)]"
)

# 缓存版本：清洗规则变更后递增，避免命中旧口型/TTS
SPEECH_CACHE_SALT = "speech-v2"


def sanitize_for_speech(text: str) -> str:
    """
    供 TTS 与 wan s2v 使用：移除 emoji、装饰符号，合并重复标点。
    保留中英文、数字及常见句读（，。！？、；：,.!?）。
    """
    if not text:
        return ""

    s = unicodedata.normalize("NFKC", text.strip())
    s = _EMOJI_RE.sub("", s)
    s = s.replace("\u200b", "").replace("\ufeff", "")
    s = _DECORATIVE_RE.sub("", s)
    s = _EMOTICON_RE.sub("", s)
    s = _BRACKET_NOISE_RE.sub("", s)
    s = re.sub(r"https?://\S+", "", s)

    # 省略号、英文句点重复 → 单句读点
    s = re.sub(r"[.…．·]{2,}", "。", s)
    s = re.sub(r"[！!]{2,}", "！", s)
    s = re.sub(r"[？?]{2,}", "？", s)
    s = re.sub(r"[，,]{2,}", "，", s)
    # 仅去掉首尾无意义的分隔符（保留句末 。！？ 以利语调）
    s = re.sub(r"^[，,、；：~～\s]+", "", s)
    s = re.sub(r"[~～\s]+$", "", s)
    # 标点前多余空格
    s = re.sub(r"\s+([，。！？、；：])", r"\1", s)
    s = re.sub(r"\s{2,}", " ", s)

    return s.strip()


def speech_fingerprint(text: str) -> str:
    """用于缓存键的归一化指纹（与展示用原文分离）。"""
    return sanitize_for_speech(text)
