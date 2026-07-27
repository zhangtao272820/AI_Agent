"""万相 wan2.2-s2v：音频驱动对口型 + 本地 Hash 缓存。"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from . import assets, avatar_image, dashscope_upload
from .config import Settings, api_key

logger = logging.getLogger(__name__)

S2V_CREATE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

_OSS_HEADERS = {"X-DashScope-OssResourceResolve": "enable"}


def _mime_to_ext(mime: str) -> str:
    m = (mime or "").lower()
    if "mpeg" in m or "mp3" in m:
        return "mp3"
    return "wav"


def _create_s2v_task(
    settings: Settings,
    *,
    image_url: str,
    audio_url: str,
) -> str:
    key = api_key(settings)
    body = {
        "model": settings.wan_s2v_model,
        "input": {
            "image_url": image_url,
            "audio_url": audio_url,
        },
        "parameters": {
            "resolution": settings.wan_s2v_resolution,
        },
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        **_OSS_HEADERS,
    }
    with httpx.Client(timeout=60.0) as client:
        rsp = client.post(S2V_CREATE_URL, headers=headers, json=body)
    if rsp.status_code != 200:
        raise RuntimeError(f"s2v 创建任务失败: {rsp.text}")
    data = rsp.json()
    out = data.get("output") or {}
    task_id = out.get("task_id")
    if not task_id:
        raise RuntimeError(f"s2v 未返回 task_id: {data}")
    return str(task_id)


def _poll_s2v_task(settings: Settings, task_id: str) -> str:
    key = api_key(settings)
    headers = {"Authorization": f"Bearer {key}", **_OSS_HEADERS}
    deadline = time.monotonic() + settings.wan_wait_timeout_sec
    last_status = ""

    with httpx.Client(timeout=60.0) as client:
        while time.monotonic() < deadline:
            rsp = client.get(TASK_URL.format(task_id=task_id), headers=headers)
            if rsp.status_code != 200:
                raise RuntimeError(f"s2v 查询失败: {rsp.text}")
            data = rsp.json()
            out = data.get("output") or {}
            status = out.get("task_status", "")
            last_status = status
            if status == "SUCCEEDED":
                results = out.get("results") or {}
                video_url = results.get("video_url")
                if video_url:
                    return str(video_url)
                raise RuntimeError("s2v 成功但无 video_url")
            if status in ("FAILED", "CANCELED", "UNKNOWN"):
                msg = out.get("message") or data
                raise RuntimeError(f"s2v 任务失败 ({status}): {msg}")
            time.sleep(settings.wan_poll_interval_sec)

    raise TimeoutError(f"s2v 等待超时，最后状态: {last_status}")


def _download_video(url: str, dest) -> None:
    with httpx.Client(timeout=300.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        dest.write_bytes(r.content)


def _resolve_image_oss_url(settings: Settings, image_bytes: bytes) -> str:
    img_hash = avatar_image.image_content_hash(image_bytes)
    cached = assets.get_cached_avatar_oss(settings, img_hash)
    if cached:
        return cached
    oss_url = dashscope_upload.upload_bytes(
        settings,
        model_name=settings.wan_s2v_model,
        data=image_bytes,
        filename="avatar_frame.jpg",
    )
    assets.save_cached_avatar_oss(settings, img_hash, oss_url)
    return oss_url


def _pack_hit(
    settings: Settings,
    asset_id: str,
    hit: dict,
    *,
    hint: str,
    utterance_hit: bool = False,
    audio_bytes: bytes | None = None,
    audio_mime: str | None = None,
) -> dict[str, Any]:
    ab = audio_bytes
    am = audio_mime
    if ab is None:
        loaded = assets.load_audio_cache(settings, asset_id)
        if loaded:
            ab, am = loaded
    return {
        "mode": "wan_s2v",
        "cache_hit": True,
        "utterance_cache_hit": utterance_hit,
        "asset_id": asset_id,
        "video_url": hit.get("remote_video_url"),
        "play_path": f"/cache/{asset_id}.mp4",
        "hint": hint,
        "tts_audio_bytes": ab,
        "tts_mime": am or "audio/wav",
    }


def get_or_create_lip_sync_video(
    settings: Settings,
    *,
    image_bytes: bytes,
    audio_bytes: bytes,
    audio_mime: str = "audio/wav",
    user_text: str | None = None,
    reply_text: str | None = None,
) -> dict[str, Any]:
    """
    返回 lip_sync 字典：cache_hit, video_url, play_path, mode, asset_id 等。
    play_path 为相对路径 /cache/{id}.mp4，由 FastAPI 静态挂载提供。
    优先按「问题+回复」查磁盘缓存，再按 image+audio 哈希查。
    """
    if user_text and assets.normalize_utterance(user_text):
        uhit = assets.lookup_utterance(
            settings, user_text, reply_text=reply_text or ""
        )
        if uhit:
            aid = str(uhit["asset_id"])
            logger.info("对口型按问题缓存命中 user=%r asset_id=%s", user_text[:20], aid[:12])
            return _pack_hit(
                settings,
                aid,
                uhit,
                hint="相同问题与回复已命中磁盘缓存，未调用万相 API",
                utterance_hit=True,
                audio_bytes=uhit.get("audio_bytes"),
                audio_mime=uhit.get("audio_mime"),
            )

    asset_id = assets.make_asset_id(image_bytes, audio_bytes)
    hit = assets.get_cached_entry(settings, asset_id)
    if hit:
        logger.info("对口型缓存命中 asset_id=%s", asset_id[:12])
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
            hint="音视频哈希命中本地缓存，未调用万相 API",
        )

    image_url = _resolve_image_oss_url(settings, image_bytes)
    ext = _mime_to_ext(audio_mime)
    audio_url = dashscope_upload.upload_bytes(
        settings,
        model_name=settings.wan_s2v_model,
        data=audio_bytes,
        filename=f"tts_reply.{ext}",
    )

    logger.info("开始 wan s2v 任务 asset_id=%s", asset_id[:12])
    task_id = _create_s2v_task(settings, image_url=image_url, audio_url=audio_url)
    remote_url = _poll_s2v_task(settings, task_id)

    local_path = assets.put_cached_entry(
        settings, asset_id, remote_video_url=remote_url, source="wan_s2v"
    )
    _download_video(remote_url, local_path)
    assets.save_audio_cache(settings, asset_id, audio_bytes, audio_mime)
    if user_text:
        assets.register_utterance(
            settings, user_text, asset_id, reply_text=reply_text or ""
        )
    logger.info("对口型视频已缓存 %s", local_path)

    return {
        "mode": "wan_s2v",
        "cache_hit": False,
        "utterance_cache_hit": False,
        "asset_id": asset_id,
        "task_id": task_id,
        "video_url": remote_url,
        "play_path": f"/cache/{asset_id}.mp4",
        "hint": "已调用 wan2.2-s2v 并写入本地缓存（相同问题下次直接复用）",
        "tts_audio_bytes": audio_bytes,
        "tts_mime": audio_mime,
    }
