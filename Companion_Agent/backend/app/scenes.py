"""GAL 场景背景：按 archetype / event / stage 解析背景图与 CSS fallback。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT

_SAFE_BG = re.compile(r"^[a-z0-9_\-]+\.(png|jpe?g|webp)$", re.I)


def _path() -> Path:
    return PROJECT_ROOT / "data" / "scenes.json"


def bg_dir() -> Path:
    return PROJECT_ROOT / "data" / "bgs"


def load_scenes_data() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {"default": {}, "scenes": []}
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_bg_file(name: str) -> Path | None:
    raw = (name or "").strip().replace("\\", "/").split("/")[-1]
    if not _SAFE_BG.match(raw):
        return None
    path = bg_dir() / raw
    return path if path.is_file() else None


def public_image_url(image: str | None) -> str | None:
    if not image:
        return None
    raw = str(image).strip()
    if raw.startswith("/api/bgs/"):
        return raw
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    name = raw.replace("\\", "/").split("/")[-1]
    if resolve_bg_file(name):
        return f"/api/bgs/{name}"
    return None


def _publicize(scene: dict[str, Any]) -> dict[str, Any]:
    out = dict(scene)
    url = public_image_url(str(out.get("image") or ""))
    if url:
        out["image"] = url
    elif "image" in out:
        out.pop("image", None)
    return out


def list_scenes() -> list[dict[str, Any]]:
    data = load_scenes_data()
    default = data.get("default") or {}
    scenes = list(data.get("scenes") or [])
    if default:
        return [default, *scenes]
    return scenes


def resolve_scene(
    *,
    base_id: str = "",
    stage_id: str = "",
    event_id: str = "",
    scene_id: str = "",
    season: str = "",
) -> dict[str, Any]:
    data = load_scenes_data()
    default = data.get("default") or {
        "id": "default",
        "label": "日常",
        "image": "campus.png",
        "css": "linear-gradient(180deg, #1a1028 0%, #2d1f3d 100%)",
    }
    scenes: list[dict[str, Any]] = list(data.get("scenes") or [])

    picked: dict[str, Any] | None = None
    if scene_id:
        for scene in scenes:
            if scene.get("id") == scene_id:
                picked = scene
                break

    if picked is None and event_id:
        for scene in scenes:
            if event_id in (scene.get("events") or []):
                picked = scene
                break

    if picked is None and stage_id:
        for scene in scenes:
            if stage_id in (scene.get("stages") or []):
                picked = scene
                break

    if picked is None and base_id:
        for scene in scenes:
            if base_id in (scene.get("archetypes") or []):
                picked = scene
                break

    out = dict(picked or default)
    season_key = (season or "").strip().lower()
    # Prefer seasonal variant file when present: campus.png → campus_winter.png
    if season_key:
        raw_image = str(out.get("image") or "")
        name = raw_image.replace("\\", "/").split("/")[-1]
        if name and "." in name:
            stem, ext = name.rsplit(".", 1)
            # already seasonal?
            if not stem.endswith(f"_{season_key}"):
                seasonal = f"{stem}_{season_key}.{ext}"
                if resolve_bg_file(seasonal):
                    out["image"] = seasonal
                    out["season"] = season_key
                else:
                    out["season"] = season_key
            else:
                out["season"] = season_key
    return _publicize(out)


def public_scenes() -> list[dict[str, Any]]:
    return [_publicize(s) for s in list_scenes()]
