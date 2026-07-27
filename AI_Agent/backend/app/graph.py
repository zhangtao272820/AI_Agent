"""LangGraph：ASR → LLM → TTS → lip_sync（可选 wan2.2-s2v + 缓存）。"""

from __future__ import annotations

import base64
import logging
from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph

from . import bailian, avatar_image, local_lipsync, wan_s2v
from .config import Settings, api_key

logger = logging.getLogger(__name__)


class AvatarState(TypedDict, total=False):
    mode: Literal["audio", "text"]
    audio_mime: str
    audio_bytes: bytes | None
    user_text: str
    transcript: str
    emotion: str | None
    reply: str
    tts_audio_b64: str
    tts_mime: str
    tts_audio_bytes: bytes | None
    lip_sync: dict[str, Any]
    error: str | None


def _node_transcribe(state: AvatarState, *, settings: Settings) -> dict[str, Any]:
    if state.get("error"):
        return {}
    if state.get("mode") == "text":
        t = (state.get("user_text") or "").strip()
        if not t:
            return {"error": "文本为空"}
        return {"transcript": t, "emotion": None}
    audio = state.get("audio_bytes")
    if not audio:
        return {"error": "未收到音频数据"}
    mime = (state.get("audio_mime") or "audio/webm").strip()
    try:
        r = bailian.transcribe_audio(settings, audio_bytes=audio, mime_type=mime)
        text = (r.get("text") or "").strip()
        if not text:
            return {"error": "语音识别结果为空，请重试或改用文本输入"}
        return {"transcript": text, "emotion": r.get("emotion")}
    except Exception as ex:
        logger.exception("ASR 失败")
        return {"error": f"ASR: {ex}"}


def _node_llm(state: AvatarState, *, settings: Settings) -> dict[str, Any]:
    if state.get("error"):
        return {}
    text = (state.get("transcript") or "").strip()
    try:
        reply = bailian.chat_reply(settings, user_text=text)
        if not reply:
            return {"error": "模型未返回内容"}
        return {"reply": reply}
    except Exception as ex:
        logger.exception("LLM 失败")
        return {"error": f"LLM: {ex}"}


def _node_tts(state: AvatarState, *, settings: Settings) -> dict[str, Any]:
    if state.get("error"):
        return {}
    text = (state.get("reply") or "").strip()
    try:
        raw, mime = bailian.synthesize_tts(settings, text=text)
        b64 = base64.b64encode(raw).decode("ascii")
        return {
            "tts_audio_b64": b64,
            "tts_mime": mime,
            "tts_audio_bytes": raw,
        }
    except Exception as ex:
        logger.exception("TTS 失败")
        return {"error": f"TTS: {ex}"}


def _node_lip_sync_client(state: AvatarState) -> dict[str, Any]:
    return {
        "lip_sync": {
            "mode": "client_rhythm",
            "cache_hit": False,
            "hint": "未启用 s2v，使用本地视频 + TTS 音量驱动口型感",
        }
    }


def _node_lip_sync(state: AvatarState, *, settings: Settings) -> dict[str, Any]:
    if state.get("error"):
        return {}
    audio = state.get("tts_audio_bytes")
    if not audio:
        return {"error": "缺少 TTS 音频，无法生成对口型"}

    mode = (settings.lip_sync_mode or "client_rhythm").strip().lower()
    if mode == "client_rhythm":
        return _node_lip_sync_client(state)

    try:
        image_bytes = avatar_image.get_avatar_image_bytes(settings)
        if mode in ("local_ultralight", "local_wav2lip", "local_lipsync"):
            result = local_lipsync.get_or_create_lip_sync_video(
                settings,
                image_bytes=image_bytes,
                audio_bytes=audio,
                audio_mime=state.get("tts_mime") or "audio/wav",
                user_text=state.get("transcript") or "",
                reply_text=state.get("reply") or "",
            )
        else:
            result = wan_s2v.get_or_create_lip_sync_video(
                settings,
                image_bytes=image_bytes,
                audio_bytes=audio,
                audio_mime=state.get("tts_mime") or "audio/wav",
                user_text=state.get("transcript") or "",
                reply_text=state.get("reply") or "",
            )
        return {"lip_sync": result}
    except Exception as ex:
        logger.exception("对口型生成失败")
        return {
            "lip_sync": {
                "mode": mode,
                "cache_hit": False,
                "fallback": True,
                "error": str(ex),
                "hint": f"对口型失败: {ex}",
            }
        }


def _node_lip_sync_wan(state: AvatarState, *, settings: Settings) -> dict[str, Any]:
    return _node_lip_sync(state, settings=settings)


def build_graph(settings: Settings):
    if not api_key(settings):
        raise RuntimeError("缺少 API Key")

    def transcribe(s: AvatarState) -> dict[str, Any]:
        return _node_transcribe(s, settings=settings)

    def llm(s: AvatarState) -> dict[str, Any]:
        return _node_llm(s, settings=settings)

    def tts(s: AvatarState) -> dict[str, Any]:
        return _node_tts(s, settings=settings)

    def lip(s: AvatarState) -> dict[str, Any]:
        return _node_lip_sync_wan(s, settings=settings)

    g = StateGraph(AvatarState)
    g.add_node("transcribe", transcribe)
    g.add_node("llm", llm)
    g.add_node("tts", tts)
    g.add_node("lip_sync", lip)
    g.set_entry_point("transcribe")
    g.add_edge("transcribe", "llm")
    g.add_edge("llm", "tts")
    g.add_edge("tts", "lip_sync")
    g.add_edge("lip_sync", END)
    return g.compile()


def run_turn(settings: Settings, initial: AvatarState) -> AvatarState:
    graph = build_graph(settings)
    out = graph.invoke(initial)
    merged: AvatarState = {**initial, **out}
    return merged
