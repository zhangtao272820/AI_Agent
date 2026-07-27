"""从配置或 ai.mp4 准备对口型用的正脸图字节（自动满足 wan s2v 分辨率要求）。"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import subprocess
from pathlib import Path

from PIL import Image

from .assets import assets_root, avatar_image_cache_path
from .config import Settings, resolve_proj_path

logger = logging.getLogger(__name__)

# wan2.2-s2v：最短边 > 400，最长边 < 7000
S2V_MIN_SIDE = 480
S2V_MAX_SIDE = 4096


def resolve_avatar_video(settings: Settings) -> Path:
    return resolve_proj_path(settings.avatar_video_path)


def resolve_avatar_image_override(settings: Settings) -> Path | None:
    raw = (settings.avatar_image_path or "").strip()
    if not raw:
        return None
    p = resolve_proj_path(raw)
    return p if p.is_file() else None


def _extract_frame_ffmpeg(video: Path, out_jpg: Path) -> bool:
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(video),
                "-vframes",
                "1",
                "-q:v",
                "2",
                str(out_jpg),
            ],
            capture_output=True,
            timeout=120,
        )
        return proc.returncode == 0 and out_jpg.is_file() and out_jpg.stat().st_size > 0
    except FileNotFoundError:
        logger.warning("未找到 ffmpeg，无法从视频截帧")
        return False
    except Exception as ex:
        logger.warning("ffmpeg 截帧失败: %s", ex)
        return False


def ensure_avatar_jpeg(settings: Settings) -> Path:
    override = resolve_avatar_image_override(settings)
    if override:
        return override

    video = resolve_avatar_video(settings)
    if video.is_file():
        cached = avatar_image_cache_path(settings)
        if _extract_frame_ffmpeg(video, cached):
            logger.info("已从视频生成正脸缓存: %s", cached)
            return cached

    bundled = _proj_root() / "video" / "avatar_frame.jpg"
    if bundled.is_file():
        return bundled

    cached = avatar_image_cache_path(settings)
    if cached.is_file():
        return cached

    if not video.is_file():
        raise FileNotFoundError(
            f"未找到数字人视频 {video}，请设置 AVATAR_VIDEO_PATH 或提供 AVATAR_IMAGE_PATH"
        )

    raise FileNotFoundError(
        "无法生成正脸图：请安装 ffmpeg 并加入 PATH，或在 video/ 下放置 avatar_frame.jpg，"
        "或设置 AVATAR_IMAGE_PATH 指向 jpg/png"
    )


def normalize_image_for_s2v(image_bytes: bytes) -> bytes:
    """
    将图片缩放到 wan2.2-s2v 合法范围：400 < min(w,h) < max(w,h) < 7000。
    同时保持原始构图比例，避免裁剪带来的脸部偏移。
    """
    im = Image.open(io.BytesIO(image_bytes))
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    else:
        im = im.convert("RGB")

    w, h = im.size
    min_s, max_s = min(w, h), max(w, h)

    scale = 1.0
    if min_s < S2V_MIN_SIDE:
        scale = max(scale, (S2V_MIN_SIDE + 1) / min_s)
    if max_s * scale > S2V_MAX_SIDE:
        scale = min(scale, S2V_MAX_SIDE / max_s)
    if min(w * scale, h * scale) <= 400:
        scale = max(scale, 401 / min_s)

    if abs(scale - 1.0) > 1e-6:
        nw = max(401, int(round(w * scale)))
        nh = max(401, int(round(h * scale)))
        logger.info("正脸图等比缩放 %dx%d -> %dx%d", w, h, nw, nh)
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    else:
        logger.info("正脸图保持原始分辨率 %dx%d", w, h)

    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=96)
    return buf.getvalue()


def _s2v_ready_meta_path(settings: Settings) -> Path:
    return assets_root(settings) / "avatar_s2v_meta.json"


def _s2v_ready_image_path(settings: Settings) -> Path:
    return assets_root(settings) / "avatar_s2v_ready.jpg"


def get_avatar_image_bytes(settings: Settings) -> bytes:
    src = ensure_avatar_jpeg(settings)
    src_bytes = src.read_bytes()
    src_sig = hashlib.sha256(src_bytes).hexdigest()

    meta_path = _s2v_ready_meta_path(settings)
    ready_path = _s2v_ready_image_path(settings)

    if ready_path.is_file() and meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if meta.get("source_hash") == src_sig:
                return ready_path.read_bytes()
        except Exception:
            pass

    normalized = normalize_image_for_s2v(src_bytes)
    ready_path.parent.mkdir(parents=True, exist_ok=True)
    ready_path.write_bytes(normalized)
    meta_path.write_text(
        json.dumps(
            {
                "source_hash": src_sig,
                "source": str(src),
                "size": list(Image.open(io.BytesIO(normalized)).size),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    w, h = Image.open(io.BytesIO(normalized)).size
    logger.info("已生成 s2v 合规正脸图 %dx%d -> %s", w, h, ready_path)
    return normalized


def image_content_hash(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()
