"""edge-tts 离线兜底（API 失败时使用）。"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

DEFAULT_EDGE_VOICE = "zh-CN-XiaoyiNeural"

_VOICE_MAP: dict[str, str] = {
    "Cherry": "zh-CN-XiaoyiNeural",
    "Serena": "zh-CN-XiaohanNeural",
    "Chelsie": "zh-CN-XiaoyiNeural",
    "Vivian": "zh-CN-XiaohanNeural",
    "longyingtian": "zh-CN-XiaoyiNeural",
    "longwanjun_v3": "zh-CN-XiaohanNeural",
}


def resolve_edge_voice(voice_id: str) -> str:
    vid = (voice_id or "").strip()
    return _VOICE_MAP.get(vid, DEFAULT_EDGE_VOICE)


def synthesize_edge_tts(*, text: str, voice: str) -> tuple[bytes, str]:
    spoken = text.strip()
    if not spoken:
        raise ValueError("TTS 文本为空")
    try:
        import edge_tts  # type: ignore[import-untyped]
    except ImportError as ex:
        raise RuntimeError("未安装 edge-tts，请 pip install edge-tts") from ex

    edge_voice = resolve_edge_voice(voice)

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(spoken, edge_voice)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                chunks.append(chunk["data"])
        if not chunks:
            raise RuntimeError("edge-tts 无音频输出")
        return b"".join(chunks)

    try:
        return asyncio.run(_run()), "audio/mpeg"
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_run()), "audio/mpeg"
        finally:
            loop.close()
