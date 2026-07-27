"""立绘差分：sprite_catalog + 静态资源 URL + 分档目录解析。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT

_EMOTION_FALLBACK = "neutral"
_CAST_DIRS = ("romance", "neutral", "npc")


def _catalog_path() -> Path:
    return PROJECT_ROOT / "data" / "sprite_catalog.json"


def sprites_root() -> Path:
    return PROJECT_ROOT / "data" / "sprites"


def load_sprite_catalog_data() -> dict[str, Any]:
    path = _catalog_path()
    if not path.is_file():
        return {"characters": []}
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _cast_kind_index() -> dict[str, str]:
    """character_id → romance|neutral|npc（来自 social_graph）。"""
    try:
        from .social_graph import load_social_graph

        return {
            cid: (social.cast_kind if social.cast_kind in _CAST_DIRS else "romance")
            for cid, social in load_social_graph().characters.items()
        }
    except Exception:
        return {}


def reload_sprite_paths() -> None:
    _cast_kind_index.cache_clear()


def cast_kind_for_sprite(character_id: str) -> str:
    cid = (character_id or "").strip()
    kind = _cast_kind_index().get(cid)
    if kind in _CAST_DIRS:
        return kind
    root = sprites_root()
    for k in _CAST_DIRS:
        if (root / k / cid).is_dir():
            return k
    return "romance"


def resolve_sprite_dir(character_id: str) -> Path | None:
    """正式立绘目录：data/sprites/{cast_kind}/{id}/；兼容旧顶层 {id}/。"""
    cid = (character_id or "").strip()
    if not cid or cid.startswith("_"):
        return None
    root = sprites_root()
    kind = cast_kind_for_sprite(cid)
    preferred = root / kind / cid
    if preferred.is_dir():
        return preferred
    for k in _CAST_DIRS:
        alt = root / k / cid
        if alt.is_dir():
            return alt
    legacy = root / cid
    if legacy.is_dir():
        return legacy
    return preferred


def resolve_sprite_file(character_id: str, filename: str) -> Path | None:
    """filename 不含路径，如 neutral.png / home_happy.png。"""
    safe = (filename or "").replace("\\", "").replace("/", "").replace("..", "")
    if not safe:
        return None
    folder = resolve_sprite_dir(character_id)
    if not folder:
        return None
    path = folder / safe
    return path if path.is_file() else None


def find_sprite_binding(character_id: str) -> dict[str, Any] | None:
    cid = (character_id or "").strip()
    for row in load_sprite_catalog_data().get("characters") or []:
        if str(row.get("id") or "") == cid:
            return row
    return None


def sprite_url(character_id: str, emotion: str = "neutral") -> str | None:
    """API 仍为 /api/sprites/{id}/{emotion}.png；磁盘按分档目录存放。"""
    cid = (character_id or "").strip()
    if not cid:
        return None
    emo = (emotion or _EMOTION_FALLBACK).strip().lower()
    for name in (emo, _EMOTION_FALLBACK):
        if resolve_sprite_file(cid, f"{name}.png"):
            return f"/sprites/{cid}/{name}.png"
    return None


def public_sprite_roster() -> list[dict[str, Any]]:
    data = load_sprite_catalog_data()
    out: list[dict[str, Any]] = []
    for row in data.get("characters") or []:
        cid = str(row.get("id") or "")
        out.append(
            {
                "id": cid,
                "label": row.get("label", cid),
                "base_id": row.get("base_id", ""),
                "vibe": row.get("vibe", ""),
                "cast_kind": row.get("cast_kind") or cast_kind_for_sprite(cid),
                "preview": sprite_url(cid, "neutral"),
                "emotions": data.get("standard_emotions") or [],
            }
        )
    return out
