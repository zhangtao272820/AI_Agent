"""本地对口型服务客户端（Ultralight 流式 / Wav2Lip 回退）。"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from websockets.sync.client import connect as ws_connect

from . import assets
from .config import Settings

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], None]


def _service_base(settings: Settings) -> str:
    return (settings.lipsync_service_url or "http://127.0.0.1:8091").rstrip("/")


def _ws_base(settings: Settings) -> str:
    base = _service_base(settings)
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :]
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :]
    return "ws://" + base


def check_service(settings: Settings) -> dict[str, Any]:
    url = f"{_service_base(settings)}/health"
    with httpx.Client(timeout=10.0) as client:
        rsp = client.get(url)
    rsp.raise_for_status()
    return rsp.json()


def _pack_hit(
    settings: Settings,
    asset_id: str,
    hit: dict,
    *,
    hint: str,
    utterance_hit: bool = False,
    audio_bytes: bytes | None = None,
    audio_mime: str | None = None,
    backend: str = "",
) -> dict[str, Any]:
    ab = audio_bytes
    am = audio_mime
    if ab is None:
        loaded = assets.load_audio_cache(settings, asset_id)
        if loaded:
            ab, am = loaded
    return {
        "mode": "local_ultralight",
        "backend": backend or hit.get("source", "local"),
        "cache_hit": True,
        "utterance_cache_hit": utterance_hit,
        "asset_id": asset_id,
        "play_path": f"/cache/{asset_id}.mp4",
        "hint": hint,
        "tts_audio_bytes": ab,
        "tts_mime": am or "audio/wav",
    }


def _generate_via_ws(
    settings: Settings,
    *,
    audio_bytes: bytes,
    audio_mime: str,
    out_path: Path,
    emit: EmitFn | None = None,
) -> dict[str, Any]:
    ws_url = f"{_ws_base(settings)}/ws/generate"
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    start_msg = {
        "type": "start",
        "audio_base64": b64,
        "mime": audio_mime,
        "backend": settings.lipsync_backend or "auto",
    }

    meta: dict[str, Any] = {"backend": "unknown", "frames": 0, "fps": 20}
    with ws_connect(ws_url, open_timeout=30, close_timeout=600) as ws:
        ws.send(json.dumps(start_msg))
        while True:
            raw = ws.recv()
            msg = json.loads(raw)
            mtype = msg.get("type")
            if mtype == "started":
                meta["backend"] = msg.get("backend", "unknown")
                if emit:
                    emit(
                        "lip_sync",
                        {
                            "status": "generating",
                            "backend": meta["backend"],
                            "hint": f"本地 {meta['backend']} 流式推理中…",
                        },
                    )
            elif mtype == "frame":
                if emit and settings.lipsync_stream_frames:
                    emit(
                        "lip_sync_frame",
                        {
                            "index": msg.get("index", 0),
                            "jpeg_base64": msg.get("jpeg_base64", ""),
                        },
                    )
            elif mtype == "done":
                meta["backend"] = msg.get("backend", meta["backend"])
                meta["frames"] = int(msg.get("frames") or 0)
                meta["fps"] = int(msg.get("fps") or 20)
                mp4_b64 = msg.get("mp4_base64") or ""
                if not mp4_b64:
                    raise RuntimeError("对口型服务未返回 mp4")
                out_path.write_bytes(base64.b64decode(mp4_b64))
                break
            elif mtype == "error":
                raise RuntimeError(str(msg.get("message") or "对口型服务错误"))
            else:
                logger.debug("lipsync ws 忽略: %s", mtype)

    return meta


def _generate_via_http(
    settings: Settings,
    *,
    audio_bytes: bytes,
    audio_mime: str,
    out_path: Path,
) -> dict[str, Any]:
    url = f"{_service_base(settings)}/generate"
    with httpx.Client(timeout=600.0) as client:
        rsp = client.post(
            url,
            files={"audio": ("tts.wav", audio_bytes, audio_mime)},
            data={"backend": settings.lipsync_backend or "auto"},
        )
    if rsp.status_code != 200:
        raise RuntimeError(f"对口型 HTTP 失败: {rsp.text[:500]}")
    out_path.write_bytes(rsp.content)
    return {
        "backend": rsp.headers.get("X-Lipsync-Backend", "unknown"),
        "frames": int(rsp.headers.get("X-Lipsync-Frames") or 0),
        "fps": 20,
    }


def get_or_create_lip_sync_video(
    settings: Settings,
    *,
    image_bytes: bytes,
    audio_bytes: bytes,
    audio_mime: str = "audio/wav",
    user_text: str | None = None,
    reply_text: str | None = None,
    emit: EmitFn | None = None,
) -> dict[str, Any]:
    """
    与 wan_s2v 相同签名：查缓存 → 调本地服务 → 写 MP4。
    image_bytes 仅用于 asset_id 哈希（与万相一致）。
    """
    if user_text and assets.normalize_utterance(user_text):
        uhit = assets.lookup_utterance(
            settings, user_text, reply_text=reply_text or ""
        )
        if uhit:
            aid = str(uhit["asset_id"])
            logger.info("本地对口型按问题缓存命中 user=%r", user_text[:20])
            return _pack_hit(
                settings,
                aid,
                uhit,
                hint="相同问题与回复已命中磁盘缓存",
                utterance_hit=True,
                audio_bytes=uhit.get("audio_bytes"),
                audio_mime=uhit.get("audio_mime"),
                backend=str(uhit.get("source") or "local"),
            )

    asset_id = assets.make_asset_id(image_bytes, audio_bytes)
    hit = assets.get_cached_entry(settings, asset_id)
    if hit:
        logger.info("本地对口型缓存命中 asset_id=%s", asset_id[:12])
        if not assets.load_audio_cache(settings, asset_id):
            assets.save_audio_cache(settings, asset_id, audio_bytes, audio_mime)
        if user_text:
            assets.register_utterance(
                settings, user_text, asset_id, reply_text=reply_text or ""
            )
        return _pack_hit(
            settings,
            asset_id,
            hit,
            hint="音视频哈希命中本地缓存",
            backend=str(hit.get("source") or "local"),
        )

    local_path = assets.put_cached_entry(
        settings, asset_id, remote_video_url=None, source="local_lipsync"
    )

    resolved_backend = ""
    try:
        resolved_backend = str(check_service(settings).get("backend") or "")
    except Exception:
        pass
    # Wav2Lip 无逐帧流，走 HTTP 更直接，避免 WS 长时间无反馈
    use_stream = bool(
        settings.lipsync_stream_frames
        and emit
        and resolved_backend == "ultralight"
    )
    if emit and resolved_backend == "wav2lip":
        emit(
            "lip_sync",
            {
                "status": "generating",
                "backend": "wav2lip",
                "hint": "Wav2Lip CPU 生成对口型中（约 1–5 分钟），请稍候…",
            },
        )
    elif emit and resolved_backend == "musetalk":
        emit(
            "lip_sync",
            {
                "status": "generating",
                "backend": "musetalk",
                "hint": "MuseTalk 生成对口型中，请稍候…",
            },
        )
    try:
        if use_stream:
            meta = _generate_via_ws(
                settings,
                audio_bytes=audio_bytes,
                audio_mime=audio_mime,
                out_path=local_path,
                emit=emit,
            )
        else:
            meta = _generate_via_http(
                settings,
                audio_bytes=audio_bytes,
                audio_mime=audio_mime,
                out_path=local_path,
            )
    except Exception as ex:
        logger.warning("流式失败，尝试 HTTP: %s", ex)
        meta = _generate_via_http(
            settings,
            audio_bytes=audio_bytes,
            audio_mime=audio_mime,
            out_path=local_path,
        )

    backend = str(meta.get("backend") or "local")
    assets.save_audio_cache(settings, asset_id, audio_bytes, audio_mime)
    if user_text:
        assets.register_utterance(
            settings, user_text, asset_id, reply_text=reply_text or ""
        )

    try:
        data = assets.load_meta(settings)
        entry = data.get("entries", {}).get(asset_id, {})
        entry["source"] = backend
        data.setdefault("entries", {})[asset_id] = entry
        assets.save_meta(settings, data)
    except Exception:
        pass

    logger.info("本地对口型已缓存 %s backend=%s", local_path, backend)

    return {
        "mode": "local_ultralight",
        "backend": backend,
        "cache_hit": False,
        "utterance_cache_hit": False,
        "asset_id": asset_id,
        "play_path": f"/cache/{asset_id}.mp4",
        "hint": f"已用本地 {backend} 生成并缓存",
        "tts_audio_bytes": audio_bytes,
        "tts_mime": audio_mime,
        "frames": meta.get("frames", 0),
    }
