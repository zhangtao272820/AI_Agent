"""根据立绘情绪 / 关系阶段拼 TTS 情绪指令（qwen3-tts-instruct-flash）。"""

from __future__ import annotations

from typing import Any


_EMOTION_LINE: dict[str, str] = {
    "happy": "语气温柔开心，嘴角带笑，节奏略轻快",
    "shy": "语气害羞含蓄，声音偏软，略带犹豫停顿",
    "sad": "语气低落温柔，语速稍慢，带着一点叹息感",
    "angry": "语气不满但克制，略冲但不要吼",
    "surprised": "语气微微惊讶，句首可有短促上扬",
    "thinking": "语气若有所思，略慢，像在边想边说",
    "neutral": "语气自然亲切，像面对面轻声聊天",
}


def build_tts_instructions(
    *,
    emotion: str = "",
    expression: str = "",
    stage_tts_hint: str = "",
    speaking_style: str = "",
    character_name: str = "",
) -> str:
    """自然语言指令，控制语速/情绪/语气；仅 instruct 模型生效。"""
    emo = (emotion or expression or "neutral").strip().lower()
    emo_line = _EMOTION_LINE.get(emo, _EMOTION_LINE["neutral"])
    bits = [
        "用中文口语朗读，像真人女友/女主在对话，不要播音腔、不要机械平板。",
        emo_line + "。",
    ]
    hint = (stage_tts_hint or "").strip()
    if hint:
        bits.append(f"关系语气参考：{hint}。")
    style = (speaking_style or "").strip().lower()
    if style == "cute":
        bits.append("略带可爱气口，但不要夸张捏嗓。")
    elif style == "sharp":
        bits.append("吐字利落一点，可带轻微别扭感。")
    elif style == "formal":
        bits.append("吐字清楚克制，不要过分甜腻。")
    name = (character_name or "").strip()
    if name:
        bits.append(f"角色是「{name}」，保持她一贯的声线气质。")
    return "".join(bits)


def instructions_from_turn(
    *,
    parsed: dict[str, Any] | None,
    profile: Any = None,
    relationship_update: dict[str, Any] | None = None,
) -> str:
    parsed = parsed or {}
    rel = relationship_update or {}
    rs = rel.get("relationship_state") or {}
    stage_hint = ""
    if isinstance(rs, dict):
        # public state 未必带 tts_hint；从 stage 表兜底
        stage_hint = str(rs.get("tts_hint") or "")
    if not stage_hint:
        try:
            from .relationship import stage_for_affinity

            aff = int(rs.get("affinity") or 0) if isinstance(rs, dict) else 0
            stage_hint = stage_for_affinity(aff).tts_hint
        except Exception:
            stage_hint = ""

    name = ""
    style = ""
    if profile is not None:
        name = str(getattr(profile, "name", "") or "")
        style = str(getattr(profile, "speaking_style", "") or "")
        if hasattr(profile, "model_dump"):
            pass

    return build_tts_instructions(
        emotion=str(parsed.get("emotion") or ""),
        expression=str(parsed.get("expression") or ""),
        stage_tts_hint=stage_hint,
        speaking_style=style,
        character_name=name,
    )
