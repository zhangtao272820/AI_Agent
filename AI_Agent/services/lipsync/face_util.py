"""Wav2Lip 用静态正脸图，避免读取整段 mp4（65s×30fps 在 CPU 上会卡数十分钟）。"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

import cv2

logger = logging.getLogger(__name__)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _cache_dir() -> Path:
    custom = os.environ.get("LIPSYNC_FACE_CACHE", "").strip()
    if custom:
        p = Path(custom)
    else:
        p = Path(os.environ.get("TEMP", "/tmp")) / "lipsync_face_cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def ensure_wav2lip_face(face_path: Path) -> tuple[Path, bool]:
    """
    返回 (face_path, use_static)。
    视频只取首帧并缓存为 jpg；图片直接使用。
    """
    face_path = face_path.resolve()
    if not face_path.is_file():
        raise RuntimeError(f"face 文件不存在: {face_path}")

    if face_path.suffix.lower() in _IMAGE_EXTS:
        return face_path, True

    stat = face_path.stat()
    sig = f"{face_path}:{stat.st_mtime_ns}:{stat.st_size}"
    key = hashlib.sha256(sig.encode()).hexdigest()[:16]
    cached = _cache_dir() / f"{face_path.stem}_{key}.jpg"
    if cached.is_file() and cached.stat().st_size > 0:
        return cached, True

    cap = cv2.VideoCapture(str(face_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {face_path}")
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise RuntimeError(f"无法从 {face_path} 读取首帧")

    if not cv2.imwrite(str(cached), frame):
        raise RuntimeError(f"无法写入缓存正脸图: {cached}")
    logger.info("Wav2Lip 使用静态首帧 %s -> %s", face_path.name, cached)
    return cached, True
