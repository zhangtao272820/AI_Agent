"""本地对口型微服务：Ultralight 流式 + MuseTalk / Wav2Lip 回退。"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response

from runner import generate_lipsync_mp4, resolve_backend, ultralight_ready
from audio_util import ffmpeg_available
from musetalk_runner import musetalk_ready
from wav2lip_runner import wav2lip_ready

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI_Agent LipSync Service", version="0.2.0")

ULTRALIGHT_DATA = os.environ.get("ULTRALIGHT_DATA_PATH", "").strip()
WAV2LIP_ROOT = os.environ.get("WAV2LIP_ROOT", "").strip()
MUSETALK_ROOT = os.environ.get("MUSETALK_ROOT", "").strip()
LIPSYNC_BACKEND = os.environ.get("LIPSYNC_BACKEND", "auto").strip()
AVATAR_VIDEO = os.environ.get("LIPSYNC_FACE_VIDEO", "").strip()
PREFER_CUDA = os.environ.get("LIPSYNC_PREFER_CUDA", "true").lower() in (
    "1",
    "true",
    "yes",
)


def _face_video_path() -> Path | None:
    if AVATAR_VIDEO and Path(AVATAR_VIDEO).is_file():
        return Path(AVATAR_VIDEO)
    default = Path(__file__).resolve().parents[2] / "video" / "ai.mp4"
    return default if default.is_file() else None


def _backend_kwargs() -> dict:
    return {
        "ultralight_data": ULTRALIGHT_DATA,
        "wav2lip_root": WAV2LIP_ROOT,
        "musetalk_root": MUSETALK_ROOT,
    }


@app.get("/health")
async def health():
    backend = None
    err = None
    wav_deps_ok = False
    try:
        backend = resolve_backend(LIPSYNC_BACKEND, **_backend_kwargs())
        if WAV2LIP_ROOT:
            wav_deps_ok = wav2lip_ready(WAV2LIP_ROOT)
    except Exception as ex:
        err = str(ex)
    return {
        "ok": True,
        "ready": backend is not None,
        "backend": backend,
        "error": err,
        "ultralight_ready": bool(ULTRALIGHT_DATA and ultralight_ready(ULTRALIGHT_DATA)),
        "musetalk_ready": bool(MUSETALK_ROOT and musetalk_ready(MUSETALK_ROOT)),
        "wav2lip_ready": bool(WAV2LIP_ROOT and wav2lip_ready(WAV2LIP_ROOT)),
        "wav2lip_deps_ok": wav_deps_ok,
        "face_video": str(_face_video_path() or ""),
        "prefer_cuda": PREFER_CUDA,
        "ffmpeg": ffmpeg_available(),
    }


@app.post("/generate")
async def generate(
    audio: UploadFile = File(...),
    backend: str = Form(""),
    stream_frames: bool = Form(False),
):
    """批量生成对口型 MP4，返回文件。"""
    body = await audio.read()
    if not body:
        return JSONResponse({"error": "音频为空"}, status_code=400)

    be = backend.strip() or LIPSYNC_BACKEND
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "lipsync.mp4"
        frames_sent: list[int] = []

        def on_frame(idx: int, jpeg: bytes) -> None:
            frames_sent.append(idx)

        meta = await asyncio.to_thread(
            generate_lipsync_mp4,
            audio_bytes=body,
            audio_mime=audio.content_type or "audio/wav",
            out_path=out,
            backend=be,
            face_video=_face_video_path(),
            prefer_cuda=PREFER_CUDA,
            on_frame=on_frame if stream_frames else None,
            **_backend_kwargs(),
        )
        if not out.is_file():
            return JSONResponse({"error": "生成失败"}, status_code=500)
        mp4_bytes = out.read_bytes()
        headers = {
            "X-Lipsync-Backend": meta.get("backend", ""),
            "X-Lipsync-Frames": str(meta.get("frames", 0)),
        }
        return Response(
            content=mp4_bytes,
            media_type="video/mp4",
            headers=headers,
        )


@app.websocket("/ws/generate")
async def ws_generate(ws: WebSocket):
    """流式：边推理边推 jpeg 帧，最后推 mp4 base64。"""
    await ws.accept()
    try:
        raw = await ws.receive_text()
        msg = json.loads(raw)
        if msg.get("type") != "start":
            await ws.send_json({"type": "error", "message": "首包需 type=start"})
            return

        b64 = msg.get("audio_base64") or ""
        mime = msg.get("mime") or "audio/wav"
        backend = (msg.get("backend") or LIPSYNC_BACKEND).strip()
        try:
            audio_bytes = base64.b64decode(b64, validate=True)
        except Exception:
            await ws.send_json({"type": "error", "message": "audio_base64 无效"})
            return

        if not audio_bytes:
            await ws.send_json({"type": "error", "message": "音频为空"})
            return

        resolved = resolve_backend(backend, **_backend_kwargs())
        await ws.send_json({"type": "started", "backend": resolved})

        frame_lock = asyncio.Lock()
        loop = asyncio.get_running_loop()

        async def push_frame(idx: int, jpeg: bytes) -> None:
            async with frame_lock:
                await ws.send_json(
                    {
                        "type": "frame",
                        "index": idx,
                        "jpeg_base64": base64.b64encode(jpeg).decode("ascii"),
                    }
                )

        def on_frame(idx: int, jpeg: bytes) -> None:
            if resolved != "ultralight":
                return
            asyncio.run_coroutine_threadsafe(push_frame(idx, jpeg), loop)

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "lipsync.mp4"

            def work():
                return generate_lipsync_mp4(
                    audio_bytes=audio_bytes,
                    audio_mime=mime,
                    out_path=out,
                    backend=backend,
                    face_video=_face_video_path(),
                    prefer_cuda=PREFER_CUDA,
                    on_frame=on_frame if resolved == "ultralight" else None,
                    **_backend_kwargs(),
                )

            meta = await asyncio.to_thread(work)
            if not out.is_file():
                await ws.send_json({"type": "error", "message": "未生成 MP4"})
                return

            mp4_b64 = base64.b64encode(out.read_bytes()).decode("ascii")
            await ws.send_json(
                {
                    "type": "done",
                    "backend": meta.get("backend"),
                    "frames": meta.get("frames", 0),
                    "fps": meta.get("fps", 20),
                    "mp4_base64": mp4_b64,
                }
            )
    except WebSocketDisconnect:
        logger.info("WS 客户端断开")
    except Exception as ex:
        logger.exception("ws_generate")
        try:
            await ws.send_json({"type": "error", "message": str(ex)})
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("LIPSYNC_PORT", "8091"))
    uvicorn.run(app, host="0.0.0.0", port=port)
