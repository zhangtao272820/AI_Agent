"""音频转 16kHz mono PCM（Ultralight / Wav2Lip 共用）。"""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import tempfile
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000


def _resolve_ffmpeg() -> str | None:
    """PATH / FFMPEG_PATH / imageio-ffmpeg 内置二进制。"""
    env_path = os.environ.get("FFMPEG_PATH", "").strip()
    if env_path and Path(env_path).is_file():
        return env_path
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except Exception:
        pass
    return None


def ffmpeg_available() -> bool:
    return _resolve_ffmpeg() is not None


def _to_mono(data: np.ndarray) -> np.ndarray:
    if data.ndim == 1:
        return data.astype(np.float32)
    return np.mean(data, axis=1).astype(np.float32)


def _resample_mono(data: np.ndarray, sr: int) -> np.ndarray:
    mono = _to_mono(data)
    if sr == SAMPLE_RATE:
        return mono
    g = gcd(sr, SAMPLE_RATE)
    return resample_poly(mono, SAMPLE_RATE // g, sr // g).astype(np.float32)


def _write_16k_wav(data: np.ndarray) -> Path:
    out_path = Path(tempfile.mktemp(suffix=".16k.wav"))
    sf.write(str(out_path), data, SAMPLE_RATE, subtype="PCM_16")
    return out_path


def _bytes_to_wav_soundfile(audio_bytes: bytes) -> Path | None:
    """WAV/FLAC 等 soundfile 可读格式，无需 ffmpeg。"""
    try:
        data, sr = sf.read(io.BytesIO(audio_bytes))
    except Exception as ex:
        logger.debug("soundfile 无法解析音频: %s", ex)
        return None
    if data.size == 0:
        raise RuntimeError("音频数据为空")
    pcm = _resample_mono(data, int(sr))
    return _write_16k_wav(pcm)


def bytes_to_wav(audio_bytes: bytes, mime: str = "audio/wav") -> Path:
    """任意音频字节 → 临时 wav 文件（16kHz mono）。"""
    if not audio_bytes:
        raise RuntimeError("音频为空")

    m = (mime or "").lower()
    is_wav = "wav" in m or audio_bytes[:4] == b"RIFF"
    if is_wav or "flac" in m or "x-flac" in m:
        hit = _bytes_to_wav_soundfile(audio_bytes)
        if hit is not None:
            return hit

    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            "未找到 ffmpeg：请安装 ffmpeg 并加入 PATH，"
            "或 pip install imageio-ffmpeg，或设置 FFMPEG_PATH"
        )

    suffix = ".wav"
    if "webm" in m:
        suffix = ".webm"
    elif "mpeg" in m or "mp3" in m:
        suffix = ".mp3"
    elif "ogg" in m:
        suffix = ".ogg"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as src:
        src.write(audio_bytes)
        src_path = Path(src.name)

    out_path = src_path.with_suffix(".16k.wav")
    try:
        proc = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(src_path),
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "wav",
                str(out_path),
            ],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace")[-800:]
            raise RuntimeError(f"ffmpeg 转 wav 失败: {err}")
        if not out_path.is_file() or out_path.stat().st_size == 0:
            raise RuntimeError("ffmpeg 输出为空")
        return out_path
    finally:
        src_path.unlink(missing_ok=True)


def _ffmpeg_shim_dir() -> Path | None:
    """把 imageio-ffmpeg 二进制伪装成 PATH 里的 ffmpeg.exe。"""
    if shutil.which("ffmpeg"):
        return None
    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        return None
    shim_dir = Path(tempfile.gettempdir()) / "lipsync_ffmpeg_shim"
    shim_dir.mkdir(parents=True, exist_ok=True)
    shim = shim_dir / "ffmpeg.exe"
    src = Path(ffmpeg)
    if not shim.is_file() or shim.stat().st_size != src.stat().st_size:
        shutil.copy2(src, shim)
    return shim_dir


def prepare_subprocess_env(env: dict[str, str] | None = None) -> dict[str, str]:
    """为 Wav2Lip 子进程准备环境（ffmpeg shim 等）。"""
    merged = dict(env or os.environ)
    shim = _ffmpeg_shim_dir()
    if shim is not None:
        merged["PATH"] = str(shim) + os.pathsep + merged.get("PATH", "")
    return merged


def mux_av(video_path: Path, pcm_path: Path, out_path: Path) -> None:
    """video + pcm → h264/aac mp4。"""
    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("合成 MP4 需要 ffmpeg（或 imageio-ffmpeg）")
    proc = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-f",
            "s16le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "1",
            "-i",
            str(pcm_path),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(out_path),
        ],
        capture_output=True,
        timeout=300,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[-800:]
        raise RuntimeError(f"ffmpeg 合成 mp4 失败: {err}")
