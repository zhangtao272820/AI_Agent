"""TTS 磁盘缓存 + 预生成 manifest 查找。"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT, Settings, resolve_proj_path
from .tts import synthesize_tts

logger = logging.getLogger(__name__)

_session_stats: dict[str, int] = {"api_calls": 0, "cache_hits": 0, "pregen_hits": 0}


def reset_session_stats() -> None:
    _session_stats["api_calls"] = 0
    _session_stats["cache_hits"] = 0
    _session_stats["pregen_hits"] = 0


def session_stats() -> dict[str, Any]:
    api = _session_stats["api_calls"]
    hits = _session_stats["cache_hits"] + _session_stats["pregen_hits"]
    total = api + hits
    return {
        "tts_api_calls_session": api,
        "tts_cache_hits": _session_stats["cache_hits"],
        "pregen_hits": _session_stats["pregen_hits"],
        "tts_cache_hit_rate": round(hits / total, 3) if total else 0.0,
    }


def _cache_dir(settings: Settings) -> Path:
    raw = getattr(settings, "companion_tts_cache_dir", "data/tts_cache")
    return resolve_proj_path(raw)


def _hash_key(voice: str, text: str, instructions: str = "") -> str:
    payload = f"{voice}\0{text}\0{instructions}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _manifest_path() -> Path:
    return PROJECT_ROOT / "data" / "tts_pregen_manifest.json"


def _load_manifest() -> dict[str, Any]:
    path = _manifest_path()
    if not path.is_file():
        return {"entries": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _manifest_lookup(voice: str, text: str) -> Path | None:
    spoken = text.strip()
    for entry in _load_manifest().get("entries") or []:
        if str(entry.get("voice") or "") != voice:
            continue
        if str(entry.get("text") or "").strip() != spoken:
            continue
        rel = str(entry.get("file") or "")
        if not rel:
            continue
        path = resolve_proj_path(rel)
        if path.is_file():
            return path
    return None


def _cache_path(settings: Settings, voice: str, text: str, instructions: str = "") -> Path:
    key = _hash_key(voice, text, instructions)
    return _cache_dir(settings) / f"{key}.audio"


def _mime_for_path(path: Path) -> str:
    if path.suffix.lower() == ".mp3":
        return "audio/mpeg"
    if path.suffix.lower() == ".wav":
        return "audio/wav"
    return "audio/mpeg"


def has_pregen_audio(voice: str, text: str) -> bool:
    return _manifest_lookup(voice, text.strip()) is not None


def is_key_tts_moment(
    *,
    stage_changed: bool = False,
    ending_id: str | None = None,
    is_opening: bool = False,
    event_fired: bool = False,
    event_applied: bool = False,
    quest_completed: bool = False,
) -> bool:
    return bool(
        is_opening
        or stage_changed
        or ending_id
        or event_fired
        or event_applied
        or quest_completed
    )


def should_synthesize_tts(
    settings: Settings,
    *,
    spoken: str,
    voice: str = "",
    stage_changed: bool = False,
    ending_id: str | None = None,
    is_opening: bool = False,
    event_fired: bool = False,
    event_applied: bool = False,
    quest_completed: bool = False,
) -> bool:
    if not settings.companion_tts_enabled:
        return False
    if not spoken.strip():
        return False
    mode = getattr(settings, "companion_tts_mode", "key_only")
    if mode == "off":
        return False
    key_moment = is_key_tts_moment(
        stage_changed=stage_changed,
        ending_id=ending_id,
        is_opening=is_opening,
        event_fired=event_fired,
        event_applied=event_applied,
        quest_completed=quest_completed,
    )
    if mode == "key_only":
        if key_moment:
            return True
        if voice and has_pregen_audio(voice, spoken):
            return True
        return False
    skip_len = int(getattr(settings, "companion_tts_skip_short_chars", 20) or 0)
    if skip_len > 0 and len(spoken.strip()) <= skip_len and not key_moment:
        return False
    return True


def synthesize_cached(
    settings: Settings,
    *,
    text: str,
    voice: str,
    instructions: str = "",
) -> tuple[bytes, str, str]:
    """返回 (audio_bytes, mime, source) source=cache|pregen|api"""
    spoken = text.strip()
    if not spoken:
        raise ValueError("TTS 文本为空")
    instr = (instructions or "").strip()

    # 带情绪指令时不用无指令预生成，避免平板音色冒充有情绪
    if not instr:
        pregen = _manifest_lookup(voice, spoken)
        if pregen:
            _session_stats["pregen_hits"] += 1
            return pregen.read_bytes(), _mime_for_path(pregen), "pregen"

    cache_file = _cache_path(settings, voice, spoken, instr)
    if cache_file.is_file():
        _session_stats["cache_hits"] += 1
        sidecar = cache_file.with_suffix(cache_file.suffix + ".mime")
        mime = sidecar.read_text(encoding="utf-8").strip() if sidecar.is_file() else _mime_for_path(cache_file)
        return cache_file.read_bytes(), mime, "cache"

    try:
        raw, mime = synthesize_tts(settings, text=spoken, voice=voice, instructions=instr)
        source = "api"
    except Exception as primary_ex:
        fallback = getattr(settings, "companion_tts_fallback", "none")
        if fallback != "edge":
            raise
        logger.warning("Primary TTS failed, trying edge-tts: %s", primary_ex)
        from .tts_edge import synthesize_edge_tts

        raw, mime = synthesize_edge_tts(text=spoken, voice=voice)
        source = "edge"

    _session_stats["api_calls"] += 1
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(raw)
    cache_file.with_suffix(cache_file.suffix + ".mime").write_text(mime, encoding="utf-8")
    return raw, mime, source
