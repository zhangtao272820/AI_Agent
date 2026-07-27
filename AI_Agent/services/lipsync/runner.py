"""统一对口型后端：Ultralight 流式优先，Wav2Lip 回退。"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Callable
from pathlib import Path

import numpy as np
import soundfile as sf

from audio_util import SAMPLE_RATE, bytes_to_wav, mux_av
from face_util import ensure_wav2lip_face
from ultralight_processor import (
    DEFAULT_FPS,
    stream_pcm,
    ultralight_ready,
    write_video,
)
from musetalk_runner import generate_mp4 as musetalk_generate
from musetalk_runner import musetalk_ready
from wav2lip_runner import generate_mp4 as wav2lip_generate
from wav2lip_runner import wav2lip_ready

logger = logging.getLogger(__name__)

FrameCb = Callable[[int, bytes], None]


def resolve_backend(
    requested: str,
    *,
    ultralight_data: str,
    wav2lip_root: str,
    musetalk_root: str = "",
) -> str:
    req = (requested or "auto").strip().lower()
    ultra_ok = ultralight_data and ultralight_ready(ultralight_data)
    wav_ok = wav2lip_root and wav2lip_ready(wav2lip_root)
    muse_ok = musetalk_root and musetalk_ready(musetalk_root)

    if req == "ultralight":
        if ultra_ok:
            return "ultralight"
        if muse_ok:
            logger.warning("Ultralight 数据集未就绪，回退 MuseTalk")
            return "musetalk"
        if wav_ok:
            logger.warning("Ultralight 数据集未就绪，回退 Wav2Lip")
            return "wav2lip"
        raise RuntimeError(
            "Ultralight 未配置：设置 ULTRALIGHT_DATA_PATH 并完成数据集导出（见 doc/ultralight-docker-setup.md）"
        )
    if req == "musetalk":
        if muse_ok:
            return "musetalk"
        if ultra_ok:
            logger.warning("MuseTalk 未就绪，回退 Ultralight")
            return "ultralight"
        if wav_ok:
            logger.warning("MuseTalk 未就绪，回退 Wav2Lip")
            return "wav2lip"
        raise RuntimeError(
            "MuseTalk 未配置：克隆 TMElyralab/MuseTalk 到 MUSETALK_ROOT 并下载权重"
        )
    if req == "wav2lip":
        if wav_ok:
            return "wav2lip"
        raise RuntimeError(
            "Wav2Lip 未配置：克隆 Rudrabha/Wav2Lip 并设置 WAV2LIP_ROOT"
        )
    if ultra_ok:
        return "ultralight"
    if muse_ok:
        return "musetalk"
    if wav_ok:
        return "wav2lip"
    raise RuntimeError(
        "无可用对口型后端：请配置 ULTRALIGHT_DATA_PATH、MUSETALK_ROOT 或 WAV2LIP_ROOT"
    )


def generate_lipsync_mp4(
    *,
    audio_bytes: bytes,
    audio_mime: str,
    out_path: Path,
    backend: str,
    ultralight_data: str,
    wav2lip_root: str,
    musetalk_root: str = "",
    face_video: Path | None = None,
    prefer_cuda: bool = True,
    on_frame: FrameCb | None = None,
) -> dict:
    """生成对口型 MP4，返回元信息。"""
    resolved = resolve_backend(
        backend,
        ultralight_data=ultralight_data,
        wav2lip_root=wav2lip_root,
        musetalk_root=musetalk_root,
    )
    wav_path = bytes_to_wav(audio_bytes, audio_mime)
    try:
        if resolved == "ultralight":
            stream, _ = sf.read(str(wav_path))
            if stream.ndim == 2:
                stream = stream[:, 0]
            pcm = (stream.astype(np.float32) * 32767).astype(np.int16)

            def _cb(idx: int, jpeg_bytes: bytes) -> None:
                if on_frame:
                    on_frame(idx, jpeg_bytes)

            frames, out_pcm, (w, h) = stream_pcm(
                ultralight_data,
                pcm,
                prefer_cuda=prefer_cuda,
                on_frame=_cb if on_frame else None,
            )
            raw_video = out_path.with_suffix(".raw.mp4")
            pcm_file = out_path.with_suffix(".pcm")
            write_video(frames, str(raw_video), fps=DEFAULT_FPS)
            pcm_file.write_bytes(out_pcm.tobytes())
            mux_av(raw_video, pcm_file, out_path)
            raw_video.unlink(missing_ok=True)
            pcm_file.unlink(missing_ok=True)
            return {
                "backend": "ultralight",
                "frames": len(frames),
                "fps": DEFAULT_FPS,
                "width": w,
                "height": h,
            }

        if not face_video or not face_video.is_file():
            raise RuntimeError(f"{resolved} 需要 face 视频/图片路径")

        if resolved == "musetalk":
            musetalk_generate(
                musetalk_root=musetalk_root,
                face_path=face_video,
                wav_path=wav_path,
                out_path=out_path,
            )
            return {"backend": "musetalk", "frames": 0, "fps": 25}

        if resolved == "wav2lip":
            face_for_wav2lip, use_static = ensure_wav2lip_face(face_video)
            wav2lip_generate(
                wav2lip_root=wav2lip_root,
                face_path=face_for_wav2lip,
                wav_path=wav_path,
                out_path=out_path,
                static_face=use_static,
            )
            return {"backend": "wav2lip", "frames": 0, "fps": 25}

        raise RuntimeError(f"未知对口型后端: {resolved}")
    finally:
        wav_path.unlink(missing_ok=True)
