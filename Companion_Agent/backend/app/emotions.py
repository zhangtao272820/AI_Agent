"""从角色模型输出中解析情绪、动作、选项与口型文本。"""

from __future__ import annotations

import re
from typing import Any

from .character import load_expression_map

_ACTION_RE = re.compile(r"[（(]([^）)]+)[）)]")
_CHOICE_LINE_RE = re.compile(r"^【选项】\s*(.+?)\s*$", re.MULTILINE)
_SPEAKER_RE = re.compile(r"^【\s*speaker\s*[:：]\s*([a-z0-9_]+)\s*】\s*", re.IGNORECASE | re.MULTILINE)
_GUEST_RE = re.compile(r"^【\s*guest\s*[:：]\s*(.+?)\s*】\s*$", re.IGNORECASE | re.MULTILINE)
_EMOTION_HINTS = {
    "happy": ["笑", "开心", "高兴", "嘻嘻", "哈哈", "微笑", "乐"],
    "shy": ["害羞", "脸红", "不好意思", "羞涩", "躲"],
    "sad": ["哭", "难过", "伤心", "失落", "叹"],
    "angry": ["生气", "怒", "哼", "别过脸", "鼓腮", "瞪"],
    "love": ["心动", "喜欢", "爱", "亲", "抱", "贴"],
    "surprised": ["惊讶", "吃惊", "睁大", "愣"],
    "sarcastic": ["冷笑", "翻白眼", "呵呵", "啧", "讽刺", "尖酸", "刻薄", "毒舌"],
    "mock": ["指指点点", "指着", "嘲笑", "笑话", "鄙视"],
    "contempt": ["抱胸", "嫌弃", "不屑", "轻蔑", "白眼", "无语"],
    "annoyed": ["扶额", "捂脸", "头疼", "无奈", "服了"],
    "smug": ["得意", "嘚瑟", "骄傲", "早就知道"],
    "neutral": [],
}


def parse_choices(raw: str) -> list[str]:
    match = _CHOICE_LINE_RE.search(raw or "")
    if not match:
        return []
    return [part.strip() for part in match.group(1).split("|") if part.strip()]


def strip_choice_line(raw: str) -> str:
    return _CHOICE_LINE_RE.sub("", raw or "").strip()


def _extract_speaker_and_guest(raw: str) -> tuple[str, str, str]:
    """返回 (speaker_id, guest_reaction, text_without_markers)。"""
    text = raw or ""
    speaker = ""
    guest = ""
    m = _SPEAKER_RE.search(text)
    if m:
        speaker = m.group(1).strip().lower()
        text = _SPEAKER_RE.sub("", text, count=1)
    g = _GUEST_RE.search(text)
    if g:
        guest = g.group(1).strip()
        text = _GUEST_RE.sub("", text, count=1)
    return speaker, guest, text.strip()


def _keyword_emotion(text: str) -> str:
    expr_map = load_expression_map()
    keywords: dict[str, list[str]] = expr_map.get("keywords") or {}
    merged = {**_EMOTION_HINTS, **keywords}
    scores: dict[str, int] = {}
    for emotion, words in merged.items():
        if emotion == "neutral":
            continue
        score = sum(1 for w in words if w and w in text)
        if score:
            scores[emotion] = score
    if not scores:
        return "neutral"
    return max(scores.items(), key=lambda x: x[1])[0]


def apply_mood_arc_to_avatar(parsed: dict[str, Any], *, day_mood_base: int | None) -> dict[str, Any]:
    """按当日心情基调微调表情，避免每句乱跳高能脸。"""
    if day_mood_base is None:
        return parsed
    emo = str(parsed.get("emotion") or "neutral")
    if day_mood_base <= -25 and emo in {"happy", "love", "smug"}:
        parsed = {**parsed, "emotion": "neutral", "expression": "neutral"}
    elif day_mood_base <= -45 and emo not in {"sad", "angry", "annoyed", "neutral"}:
        parsed = {**parsed, "emotion": "sad", "expression": "sad"}
    elif day_mood_base >= 35 and emo == "neutral":
        parsed = {**parsed, "emotion": "happy", "expression": "happy"}
    return parsed


def parse_character_reply(raw: str) -> dict[str, Any]:
    speaker_id, guest_reaction, body = _extract_speaker_and_guest(raw or "")
    text = strip_choice_line(body)
    choices = parse_choices(raw or "")
    actions = _ACTION_RE.findall(text)
    spoken = _ACTION_RE.sub("", text).strip()
    spoken = re.sub(r"\s+", " ", spoken)
    action_blob = " ".join(actions)
    emotion = _keyword_emotion(action_blob + text)

    expr_map = load_expression_map()
    emotion_cfg: dict[str, Any] = (expr_map.get("emotions") or {}).get(emotion, {})
    expression = str(emotion_cfg.get("expression") or emotion)
    motion = str(emotion_cfg.get("motion") or "idle")

    return {
        "raw": raw,
        "spoken": spoken or text,
        "actions": actions,
        "choices": choices,
        "emotion": emotion,
        "expression": expression,
        "motion": motion,
        "mouth_open": 0.65 if len(spoken) > 8 else 0.35,
        "speaker_id": speaker_id,
        "guest_reaction": guest_reaction,
    }
