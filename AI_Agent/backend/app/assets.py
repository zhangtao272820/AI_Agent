"""数字人视频资产：Hash 缓存元数据与本地 MP4 存储。"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings, resolve_proj_path

logger = logging.getLogger(__name__)


def assets_root(settings: Settings) -> Path:
    p = resolve_proj_path(settings.assets_dir)
    p.mkdir(parents=True, exist_ok=True)
    (p / "videos").mkdir(exist_ok=True)
    (p / "audio").mkdir(exist_ok=True)
    return p


def normalize_utterance(text: str) -> str:
    """归一化用户问题，用于「相同问题」磁盘缓存键。"""
    return " ".join((text or "").strip().split())


def utterance_key(text: str) -> str:
    from .text_speech import SPEECH_CACHE_SALT

    payload = f"{SPEECH_CACHE_SALT}:{normalize_utterance(text)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def make_asset_id(image_bytes: bytes, audio_bytes: bytes) -> str:
    h = hashlib.sha256()
    h.update(image_bytes)
    h.update(audio_bytes)
    return h.hexdigest()


def video_cache_path(settings: Settings, asset_id: str) -> Path:
    return assets_root(settings) / "videos" / f"{asset_id}.mp4"


def meta_path(settings: Settings) -> Path:
    return assets_root(settings) / "cache_index.json"


def load_meta(settings: Settings) -> dict[str, Any]:
    p = meta_path(settings)
    if not p.is_file():
        return {"entries": {}}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("cache_index.json 损坏，将重建")
        return {"entries": {}}


def save_meta(settings: Settings, meta: dict[str, Any]) -> None:
    p = meta_path(settings)
    p.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def audio_cache_path(settings: Settings, asset_id: str) -> Path:
    return assets_root(settings) / "audio" / f"{asset_id}.bin"


def audio_mime_path(settings: Settings, asset_id: str) -> Path:
    return assets_root(settings) / "audio" / f"{asset_id}.mime"


def save_audio_cache(
    settings: Settings, asset_id: str, audio_bytes: bytes, mime: str
) -> None:
    audio_cache_path(settings, asset_id).write_bytes(audio_bytes)
    audio_mime_path(settings, asset_id).write_text(mime or "audio/wav", encoding="utf-8")


def load_audio_cache(settings: Settings, asset_id: str) -> tuple[bytes, str] | None:
    ap = audio_cache_path(settings, asset_id)
    mp = audio_mime_path(settings, asset_id)
    if not ap.is_file() or ap.stat().st_size == 0:
        return None
    mime = mp.read_text(encoding="utf-8").strip() if mp.is_file() else "audio/wav"
    return ap.read_bytes(), mime


def _remove_asset_entry(settings: Settings, asset_id: str) -> None:
    meta = load_meta(settings)
    entries = meta.get("entries", {})
    if asset_id in entries:
        del entries[asset_id]
    by_u = meta.get("by_utterance", {})
    stale = [k for k, v in by_u.items() if v.get("asset_id") == asset_id]
    for k in stale:
        del by_u[k]
    save_meta(settings, meta)


def load_utterance_links(settings: Settings) -> None:
    """从 assets/utterance_links.json 导入「问题 → asset_id」映射（可选）。"""
    p = assets_root(settings) / "utterance_links.json"
    if not p.is_file():
        return
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as ex:
        logger.warning("utterance_links.json 无效: %s", ex)
        return
    if not isinstance(data, dict):
        return
    for user_text, asset_id in data.items():
        if str(user_text).startswith("_"):
            continue
        aid = str(asset_id).strip() if isinstance(asset_id, str) else ""
        if isinstance(asset_id, dict):
            aid = str(asset_id.get("asset_id") or "").strip()
        if not aid or not normalize_utterance(str(user_text)):
            continue
        if get_cached_entry(settings, aid):
            meta = load_meta(settings)
            existing = meta.get("by_utterance", {}).get(utterance_key(str(user_text)))
            if existing and str(existing.get("reply_text") or "").strip():
                continue
            reply_from_link = ""
            if isinstance(asset_id, dict):
                reply_from_link = str(asset_id.get("reply_text") or "")
            register_utterance(
                settings, str(user_text), aid, reply_text=reply_from_link
            )
            logger.info("已关联问题缓存 %r -> %s", user_text, aid[:12])


def register_utterance(
    settings: Settings,
    user_text: str,
    asset_id: str,
    *,
    reply_text: str = "",
) -> None:
    if not normalize_utterance(user_text):
        return
    meta = load_meta(settings)
    by_u = meta.setdefault("by_utterance", {})
    by_u[utterance_key(user_text)] = {
        "asset_id": asset_id,
        "user_text": normalize_utterance(user_text),
        "reply_text": (reply_text or "").strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    save_meta(settings, meta)


def lookup_utterance(
    settings: Settings,
    user_text: str,
    reply_text: str | None = None,
) -> dict[str, Any] | None:
    """按用户问题查缓存；若提供 reply_text，须与登记时回复一致才命中。"""
    norm = normalize_utterance(user_text)
    if not norm:
        return None
    meta = load_meta(settings)
    row = meta.get("by_utterance", {}).get(utterance_key(norm))
    if not row:
        return None
    if reply_text is not None:
        cached_reply = normalize_utterance(str(row.get("reply_text") or ""))
        want_reply = normalize_utterance(reply_text)
        if cached_reply != want_reply:
            logger.info(
                "问题缓存未命中（回复已变化） user=%r cached_len=%d new_len=%d",
                norm[:24],
                len(cached_reply),
                len(want_reply),
            )
            return None
    asset_id = str(row.get("asset_id") or "")
    if not asset_id:
        return None
    entry = get_cached_entry(settings, asset_id)
    if not entry:
        _remove_asset_entry(settings, asset_id)
        return None
    audio = load_audio_cache(settings, asset_id)
    return {
        **row,
        **entry,
        "asset_id": asset_id,
        "utterance_cache_hit": True,
        "audio_bytes": audio[0] if audio else None,
        "audio_mime": audio[1] if audio else None,
    }


def get_cached_entry(settings: Settings, asset_id: str) -> dict[str, Any] | None:
    meta = load_meta(settings)
    entry = meta.get("entries", {}).get(asset_id)
    if not entry:
        return None
    local = video_cache_path(settings, asset_id)
    if local.is_file() and local.stat().st_size > 0:
        return {**entry, "local_path": str(local)}
    _remove_asset_entry(settings, asset_id)
    return None


def put_cached_entry(
    settings: Settings,
    asset_id: str,
    *,
    remote_video_url: str | None = None,
    source: str = "wan_s2v",
) -> Path:
    local = video_cache_path(settings, asset_id)
    meta = load_meta(settings)
    entries = meta.setdefault("entries", {})
    entries[asset_id] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "remote_video_url": remote_video_url,
        "source": source,
        "local_path": str(local),
    }
    save_meta(settings, meta)
    logger.info("对口型视频已登记缓存 asset_id=%s path=%s", asset_id[:12], local)
    return local


def avatar_image_cache_path(settings: Settings) -> Path:
    return assets_root(settings) / "avatar_frame.jpg"


def avatar_oss_meta_path(settings: Settings) -> Path:
    return assets_root(settings) / "avatar_image_oss.json"


def get_cached_avatar_oss(settings: Settings, image_hash: str) -> str | None:
    p = avatar_oss_meta_path(settings)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("image_hash") == image_hash and data.get("oss_url"):
            return str(data["oss_url"])
    except Exception:
        pass
    return None


def save_cached_avatar_oss(settings: Settings, image_hash: str, oss_url: str) -> None:
    p = avatar_oss_meta_path(settings)
    p.write_text(
        json.dumps(
            {
                "image_hash": image_hash,
                "oss_url": oss_url,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
