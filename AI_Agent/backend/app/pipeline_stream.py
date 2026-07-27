"""流式流水线：ASR → 流式 LLM → 并行分句 TTS → 可选 wan s2v。"""

from __future__ import annotations

import base64
import logging
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from . import assets, bailian, avatar_image, local_lipsync, wan_s2v
from .api_errors import format_dashscope_error
from .config import Settings

logger = logging.getLogger(__name__)

LOCAL_LIP_MODES = frozenset(
    {"local_ultralight", "local_wav2lip", "local_lipsync"}
)
S2V_LIP_MODES = frozenset({"cached_s2v", "wan_s2v"})
ALL_DEFER_TTS_MODES = LOCAL_LIP_MODES | S2V_LIP_MODES

EmitFn = Callable[[str, dict[str, Any]], None]


def _ws_payload(data: dict[str, Any]) -> dict[str, Any]:
    """去掉不可 JSON 序列化的字段（如 bytes）。"""
    return {k: v for k, v in data.items() if not isinstance(v, (bytes, bytearray))}


class _DeltaThrottler:
    """限制 reply_delta 推送频率，减轻前端卡顿。"""

    def __init__(self, emit: EmitFn, interval_ms: int) -> None:
        self._emit = emit
        self._interval = max(0.02, interval_ms / 1000.0)
        self._last = 0.0
        self._text = ""

    def push(self, delta: str, full: str) -> None:
        self._text = full
        now = time.monotonic()
        if now - self._last >= self._interval:
            self.flush()

    def flush(self) -> None:
        if not self._text:
            return
        self._emit("reply_delta", {"text": self._text})
        self._last = time.monotonic()


class _OrderedTts:
    """并行合成 TTS，按句子顺序推送。"""

    def __init__(self, settings: Settings, emit: EmitFn, workers: int) -> None:
        self._settings = settings
        self._emit = emit
        self._pool = ThreadPoolExecutor(max_workers=max(1, workers))
        self._futures: list[tuple[int, str, Future]] = []
        self._next_index = 0
        self._chunk_seq = 0

    def submit(self, index: int, sentence: str) -> None:
        fut = self._pool.submit(self._synth, sentence)
        self._futures.append((index, sentence, fut))

    def _synth(self, sentence: str) -> tuple[bytes, str]:
        return bailian.synthesize_tts_for_sentence(self._settings, text=sentence)

    def drain(self) -> None:
        self._futures.sort(key=lambda x: x[0])
        for idx, sentence, fut in self._futures:
            if idx != self._next_index:
                logger.warning("TTS 顺序错位 idx=%s expect=%s", idx, self._next_index)
            try:
                raw, mime = fut.result()
            except Exception as ex:
                logger.warning("TTS 失败 [%s]: %s", sentence[:20], ex)
                self._next_index += 1
                continue
            self._emit(
                "tts_chunk",
                {
                    "index": self._chunk_seq,
                    "mime": mime,
                    "base64": base64.b64encode(raw).decode("ascii"),
                    "sentence": sentence,
                },
            )
            self._chunk_seq += 1
            self._next_index += 1
        self._futures.clear()

    def shutdown(self) -> None:
        self._pool.shutdown(wait=True)


def _transcribe(settings: Settings, initial: dict[str, Any]) -> dict[str, Any]:
    mode = initial.get("mode")
    if mode == "text":
        t = (initial.get("user_text") or "").strip()
        if not t:
            return {"error": "文本为空"}
        return {"transcript": t, "emotion": None}
    audio = initial.get("audio_bytes")
    if not audio:
        return {"error": "未收到音频数据"}
    mime = (initial.get("audio_mime") or "audio/webm").strip()
    r = bailian.transcribe_audio(settings, audio_bytes=audio, mime_type=mime)
    text = (r.get("text") or "").strip()
    if not text:
        return {"error": "语音识别结果为空，请重试或改用文本输入"}
    return {"transcript": text, "emotion": r.get("emotion")}


def _cache_expected(settings: Settings, user_text: str, reply_text: str) -> bool:
    """相同问题且相同回复是否已有磁盘对口型缓存。"""
    ukey = assets.normalize_utterance(user_text)
    if not ukey:
        return False
    return assets.lookup_utterance(settings, user_text, reply_text=reply_text) is not None


def _run_lip_sync_video(
    settings: Settings,
    *,
    user_text: str,
    full_reply: str,
    api_base: str,
    emit: EmitFn,
    pre_tts: tuple[bytes, str] | None = None,
    cache_expected: bool = False,
) -> None:
    lip_mode = (settings.lip_sync_mode or "").strip().lower()
    if lip_mode not in ALL_DEFER_TTS_MODES:
        return

    local_mode = lip_mode in LOCAL_LIP_MODES
    ukey = assets.normalize_utterance(user_text)
    if cache_expected:
        hint = "检测到相同问题缓存，正在加载对口型视频…"
    elif local_mode:
        hint = "本地对口型生成中，语音已先播放…"
        try:
            h = local_lipsync.check_service(settings)
            if h.get("backend") == "wav2lip":
                hint = "Wav2Lip CPU 生成对口型中（约 1–5 分钟），语音已先播放…"
            elif h.get("backend") == "musetalk":
                hint = "MuseTalk 生成对口型中，语音已先播放…"
            elif h.get("backend") == "ultralight":
                hint = "本地 Ultralight 流式推理中，语音已先播放…"
        except Exception:
            pass
    else:
        hint = "正在生成对口型视频（首次约 5–10 分钟），语音已先播放…"
    emit(
        "lip_sync",
        {
            "status": "generating",
            "cache_expected": cache_expected,
            "hint": hint,
            "local": local_mode,
        },
    )
    try:
        image_bytes = avatar_image.get_avatar_image_bytes(settings)
        uhit = (
            assets.lookup_utterance(settings, user_text, reply_text=full_reply)
            if ukey
            else None
        )
        if pre_tts:
            raw, mime = pre_tts
        elif uhit and uhit.get("audio_bytes"):
            raw = uhit["audio_bytes"]
            mime = str(uhit.get("audio_mime") or "audio/wav")
        else:
            raw, mime = bailian.synthesize_tts(settings, text=full_reply)

        if local_mode:
            result = local_lipsync.get_or_create_lip_sync_video(
                settings,
                image_bytes=image_bytes,
                audio_bytes=raw,
                audio_mime=mime,
                user_text=user_text,
                reply_text=full_reply,
                emit=emit,
            )
        else:
            result = wan_s2v.get_or_create_lip_sync_video(
                settings,
                image_bytes=image_bytes,
                audio_bytes=raw,
                audio_mime=mime,
                user_text=user_text,
                reply_text=full_reply,
            )
        cached_audio = result.get("tts_audio_bytes")
        if isinstance(cached_audio, (bytes, bytearray)) and len(cached_audio) > 0:
            raw = bytes(cached_audio)
            mime = str(result.get("tts_mime") or mime)
        play_path = result.get("play_path")
        if play_path:
            asset_id = str(result.get("asset_id") or "")
            av_payload: dict[str, Any] = {
                "url": f"{api_base}{play_path}",
                "cache_hit": bool(result.get("cache_hit")),
                "utterance_cache_hit": bool(result.get("utterance_cache_hit")),
                "asset_id": asset_id,
                "sync_mode": "embedded",
            }
            disk_audio = (
                assets.load_audio_cache(settings, asset_id) if asset_id else None
            )
            if disk_audio:
                av_payload["tts_mime"] = disk_audio[1]
                av_payload["tts_base64"] = base64.b64encode(disk_audio[0]).decode(
                    "ascii"
                )
            elif raw:
                av_payload["tts_mime"] = mime
                av_payload["tts_base64"] = base64.b64encode(raw).decode("ascii")
                av_payload["legacy_cache"] = True
                if asset_id:
                    assets.save_audio_cache(settings, asset_id, raw, mime)
            if av_payload.get("tts_base64"):
                av_payload["sync_mode"] = "dual"
            emit("avatar_video", av_payload)
        emit("lip_sync", _ws_payload({**result, "status": "done"}))
    except Exception as ex:
        logger.exception("lip_sync")
        emit(
            "lip_sync",
            {
                "mode": "client_rhythm" if local_mode else lip_mode,
                "status": "done",
                "fallback": True,
                "error": str(ex),
                "hint": f"对口型生成失败: {ex}",
            },
        )


def run_turn_stream(
    settings: Settings,
    initial: dict[str, Any],
    emit: EmitFn,
    *,
    api_base: str = "",
) -> None:
    try:
        tr = _transcribe(settings, initial)
    except Exception as ex:
        logger.exception("ASR")
        emit("error", {"message": f"ASR: {ex}"})
        return

    if tr.get("error"):
        emit("error", {"message": tr["error"]})
        return

    emit(
        "transcript",
        {"text": tr.get("transcript", ""), "emotion": tr.get("emotion")},
    )
    user_text = (tr.get("transcript") or "").strip()

    lip_mode = (settings.lip_sync_mode or "client_rhythm").strip().lower()
    defer_tts_for_s2v = lip_mode in ALL_DEFER_TTS_MODES

    emit("reply_start", {})
    throttler = _DeltaThrottler(emit, settings.stream_delta_throttle_ms)
    tts: _OrderedTts | None = None
    if settings.stream_tts and not defer_tts_for_s2v:
        tts = _OrderedTts(settings, emit, settings.tts_parallel_workers)

    full_reply = ""
    buf = ""
    got_first_tts = False
    tts_sentence_idx = 0

    try:
        if settings.stream_llm:
            stream = bailian.chat_reply_stream(settings, user_text=user_text)
        else:
            text = bailian.chat_reply(settings, user_text=user_text)
            stream = [text] if text else []

        for delta in stream:
            if not settings.stream_llm:
                full_reply = delta
                throttler.push(delta, full_reply)
                break

            full_reply += delta
            buf += delta
            throttler.push(delta, full_reply)

            if not settings.stream_tts or not tts:
                continue

            frags, buf, got_first_tts = bailian.pop_tts_fragments(
                buf,
                first_min_chars=settings.tts_first_chunk_chars,
                pause_min_chars=settings.tts_pause_min_chars,
                rest_min_chars=2,
                got_first=got_first_tts,
            )
            for sent in frags:
                tts.submit(tts_sentence_idx, sent)
                tts_sentence_idx += 1

        throttler.flush()

        if not full_reply.strip():
            emit("error", {"message": "模型未返回内容"})
            return

        emit("reply", {"text": full_reply})

        if settings.stream_tts and tts:
            tail = buf.strip()
            if tail:
                tts.submit(tts_sentence_idx, tail)
            tts.drain()
            tts.shutdown()
        elif not settings.stream_tts:
            raw, mime = bailian.synthesize_tts(settings, text=full_reply)
            emit(
                "tts_audio",
                {
                    "mime": mime,
                    "base64": base64.b64encode(raw).decode("ascii"),
                },
            )

        if lip_mode == "client_rhythm":
            emit(
                "lip_sync",
                {
                    "mode": "client_rhythm",
                    "status": "done",
                    "streaming": True,
                    "hint": "流式对话；假口型随 TTS 播放",
                },
            )

        emit("stream_done", {"tts_sentences": tts_sentence_idx})

        if lip_mode in ALL_DEFER_TTS_MODES:
            cache_hit = _cache_expected(settings, user_text, full_reply)
            pre_tts: tuple[bytes, str] | None = None
            if not cache_hit:
                pre_tts = bailian.synthesize_tts(settings, text=full_reply)
                emit(
                    "tts_while_waiting",
                    {
                        "mime": pre_tts[1],
                        "base64": base64.b64encode(pre_tts[0]).decode("ascii"),
                    },
                )
            _run_lip_sync_video(
                settings,
                user_text=user_text,
                full_reply=full_reply,
                api_base=api_base,
                emit=emit,
                pre_tts=pre_tts,
                cache_expected=cache_hit,
            )

        emit("done", {})

    except Exception as ex:
        logger.exception("流式流水线")
        if tts:
            tts.shutdown()
        emit("error", {"message": format_dashscope_error(ex)})
