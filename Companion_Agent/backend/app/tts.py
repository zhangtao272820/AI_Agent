"""千问 / CosyVoice TTS 合成（HTTP + WebSocket，无需 dashscope SDK）。"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import uuid
from typing import Any

import httpx

from .config import Settings, api_key
from .text_speech import sanitize_for_speech
from .voice_profile import (
    default_tts_model,
    default_voice,
    is_cosyvoice_model,
    normalize_voice,
    resolve_tts_model,
    voice_catalog_index,
)

logger = logging.getLogger(__name__)

_TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
_COSYVOICE_WS = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"


def _detect_language(text: str) -> str:
    if re.search(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", text):
        return "Chinese"
    return "English"


def _fallback_qwen_voice(voice_id: str) -> str:
    row = voice_catalog_index().get(voice_id) or {}
    explicit = str(row.get("fallback_voice") or "").strip()
    if explicit:
        return normalize_voice(explicit)
    tags = [str(t) for t in (row.get("tags") or [])]
    if "sharp" in tags or "tsundere" in tags:
        return "Vivian"
    if "cheerful" in tags or "loli" in tags or "cute" in tags:
        return "Momo"
    if "mature" in tags or "formal" in tags:
        return "Maia"
    if "shy" in tags:
        return "Seren"
    return default_voice()


def synthesize_tts(
    settings: Settings,
    *,
    text: str,
    voice: str,
    instructions: str = "",
) -> tuple[bytes, str]:
    spoken = sanitize_for_speech(text)
    if not spoken:
        raise ValueError("TTS 文本为空")

    key = api_key(settings)
    if not key:
        raise RuntimeError("未配置 API Key")

    voice_id = normalize_voice(voice or settings.companion_tts_voice or default_voice())
    tts_model = resolve_tts_model(voice_id)
    instruct = (instructions or "").strip()

    if is_cosyvoice_model(tts_model):
        # CosyVoice 无 instruct；有情绪指令时改走 qwen instruct + 兼容音色
        if instruct:
            fallback_voice = _fallback_qwen_voice(voice_id)
            try:
                return _call_qwen_tts(
                    key,
                    model=_instruct_model(settings),
                    text=spoken,
                    voice=fallback_voice,
                    language_type=_detect_language(spoken),
                    instructions=instruct,
                )
            except Exception as ex:
                logger.warning("instruct TTS via CosyVoice fallback failed: %s", ex)
        try:
            return _call_cosyvoice(key, model=tts_model, text=spoken, voice=voice_id)
        except Exception as ex:
            fallback_voice = _fallback_qwen_voice(voice_id)
            logger.warning(
                "CosyVoice %s/%s failed, fallback qwen3 HTTP voice=%s: %s",
                tts_model,
                voice_id,
                fallback_voice,
                ex,
            )
            return _call_qwen_tts(
                key,
                model=default_tts_model(),
                text=spoken,
                voice=fallback_voice,
                language_type=_detect_language(spoken),
                instructions=instruct,
            )

    language_type = _detect_language(spoken)
    prefer_instruct = bool(instruct)
    models: list[str] = []
    if prefer_instruct:
        models.append(_instruct_model(settings))
    models.extend([tts_model, settings.companion_tts_model, default_tts_model(), "qwen-tts"])
    last_err: Exception | None = None

    for model in dict.fromkeys(m for m in models if m):
        try:
            use_instr = instruct if "instruct" in model.lower() else ""
            return _call_qwen_tts(
                key,
                model=model,
                text=spoken,
                voice=voice_id,
                language_type=language_type,
                instructions=use_instr,
            )
        except Exception as ex:
            logger.warning("TTS model %s failed: %s", model, ex)
            last_err = ex

    raise RuntimeError(f"TTS 合成失败: {last_err}")


def _instruct_model(settings: Settings) -> str:
    configured = (getattr(settings, "companion_tts_instruct_model", "") or "").strip()
    if configured:
        return configured
    base = (settings.companion_tts_model or default_tts_model()).strip()
    if "instruct" in base.lower():
        return base
    return "qwen3-tts-instruct-flash"


def _call_cosyvoice(key: str, *, model: str, text: str, voice: str) -> tuple[bytes, str]:
    try:
        return asyncio.run(_cosyvoice_ws(key, model=model, text=text, voice=voice))
    except RuntimeError:
        raise
    except Exception as ex:
        raise RuntimeError(f"CosyVoice 合成失败: {ex}") from ex


async def _cosyvoice_ws(key: str, *, model: str, text: str, voice: str) -> tuple[bytes, str]:
    import websockets

    task_id = str(uuid.uuid4())
    headers = {
        "Authorization": f"bearer {key}",
        "X-DashScope-DataInspection": "enable",
    }
    chunks: list[bytes] = []

    async with websockets.connect(_COSYVOICE_WS, additional_headers=headers, open_timeout=30) as ws:
        await ws.send(
            json.dumps(
                {
                    "header": {"action": "run-task", "task_id": task_id, "streaming": "duplex"},
                    "payload": {
                        "task_group": "audio",
                        "task": "tts",
                        "function": "SpeechSynthesizer",
                        "model": model,
                        "parameters": {
                            "text_type": "PlainText",
                            "voice": voice,
                            "format": "mp3",
                            "sample_rate": 22050,
                            "volume": 50,
                            "rate": 1,
                            "pitch": 1,
                            "enable_ssml": False,
                        },
                        "input": {},
                    },
                },
                ensure_ascii=False,
            )
        )

        text_sent = False
        finish_sent = False

        while True:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=90)
            except TimeoutError as ex:
                raise RuntimeError("CosyVoice 等待响应超时") from ex

            if isinstance(msg, bytes):
                chunks.append(msg)
                continue

            data = json.loads(msg)
            header = data.get("header") or {}
            event = str(header.get("event") or "")

            if event == "task-started" and not text_sent:
                await ws.send(
                    json.dumps(
                        {
                            "header": {"action": "continue-task", "task_id": task_id, "streaming": "duplex"},
                            "payload": {"input": {"text": text}},
                        },
                        ensure_ascii=False,
                    )
                )
                text_sent = True
                await asyncio.sleep(0.3)
                await ws.send(
                    json.dumps(
                        {
                            "header": {"action": "finish-task", "task_id": task_id, "streaming": "duplex"},
                            "payload": {"input": {}},
                        },
                        ensure_ascii=False,
                    )
                )
                finish_sent = True
            elif event == "task-finished":
                break
            elif event == "task-failed":
                err = header.get("error_message") or header.get("error_code") or data
                raise RuntimeError(f"CosyVoice 任务失败: {err}")

        if not text_sent:
            raise RuntimeError("CosyVoice 未收到 task-started 事件")
        if not finish_sent:
            raise RuntimeError("CosyVoice 未完成 finish-task")

    if not chunks:
        raise RuntimeError(f"CosyVoice 合成无音频（model={model}, voice={voice}）")
    return b"".join(chunks), "audio/mpeg"


def _call_qwen_tts(
    key: str,
    *,
    model: str,
    text: str,
    voice: str,
    language_type: str,
    instructions: str = "",
) -> tuple[bytes, str]:
    inp: dict[str, Any] = {
        "text": text,
        "voice": voice,
        "language_type": language_type,
    }
    if instructions and "instruct" in model.lower():
        inp["instructions"] = instructions
        inp["optimize_instructions"] = True
    payload = {
        "model": model,
        "input": inp,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=90.0) as client:
        r = client.post(_TTS_URL, json=payload, headers=headers)
        if r.status_code >= 400:
            detail = r.text[:240]
            try:
                body = r.json()
                detail = str(body.get("message") or body.get("code") or detail)
            except Exception:
                pass
            raise RuntimeError(detail)
        data = r.json()

    if data.get("code"):
        raise RuntimeError(data.get("message") or str(data))

    output = data.get("output") or {}
    audio = output.get("audio") or {}
    url = audio.get("url")
    data_b64 = audio.get("data")

    if data_b64:
        return base64.b64decode(data_b64), "audio/wav"
    if url:
        with httpx.Client(timeout=90.0) as client:
            ar = client.get(str(url))
            ar.raise_for_status()
            mime = ar.headers.get("content-type", "audio/wav")
            if "mpeg" in mime or str(url).endswith(".mp3"):
                mime = "audio/mpeg"
            return ar.content, mime

    raise RuntimeError("TTS 响应无音频数据")


def synthesize_tts_b64(
    settings: Settings,
    *,
    text: str,
    voice: str,
    instructions: str = "",
) -> tuple[str, str]:
    raw, mime = synthesize_tts(settings, text=text, voice=voice, instructions=instructions)
    return base64.b64encode(raw).decode("ascii"), mime
