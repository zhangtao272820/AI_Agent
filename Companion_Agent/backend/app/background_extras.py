"""地点场景路人/NPC 背景层（不可对话）。"""

from __future__ import annotations

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT

_FALLBACK_LOC = {
    "cafe": "street",
    "library": "campus",
    "school": "campus",
    "park": "street",
    "store": "street",
    "forest": "street",
    "room": "home",
}


def _catalog_path() -> Path:
    return PROJECT_ROOT / "data" / "background_extras.json"


def background_root() -> Path:
    return PROJECT_ROOT / "data" / "sprites" / "_background"


@lru_cache(maxsize=1)
def load_background_catalog() -> dict[str, Any]:
    path = _catalog_path()
    if not path.is_file():
        return {"unlock_day": 7, "locations": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def reload_background_catalog() -> None:
    load_background_catalog.cache_clear()


def resolve_background_file(rel_path: str) -> Path | None:
    """rel_path like street/foo.png — only under _background."""
    safe = (rel_path or "").replace("\\", "/").replace("..", "").lstrip("/")
    if not safe or "/" not in safe:
        return None
    path = background_root() / safe
    try:
        path.resolve().relative_to(background_root().resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def pick_background_extras(
    location_id: str,
    *,
    day_index: int,
    seed: str = "",
    limit: int = 3,
) -> list[dict[str, Any]]:
    cat = load_background_catalog()
    unlock = int(cat.get("unlock_day") or 7)
    if int(day_index or 0) < unlock:
        return []
    loc = (location_id or "street").strip()
    locations = cat.get("locations") or {}
    rows = list(locations.get(loc) or [])
    if not rows:
        fb = _FALLBACK_LOC.get(loc, "street")
        rows = list(locations.get(fb) or [])
    if not rows:
        return []
    rng = random.Random(f"{seed}|{loc}|{day_index}")
    sample = rows if len(rows) <= limit else rng.sample(rows, limit)
    # stable left-to-right slots
    slots = ("far-left", "far-right", "mid-left")
    out: list[dict[str, Any]] = []
    for i, row in enumerate(sample):
        file_rel = str(row.get("file") or "")
        if not file_rel or not resolve_background_file(file_rel):
            continue
        loc_name, fname = file_rel.split("/", 1)
        out.append(
            {
                "id": str(row.get("id") or file_rel),
                "url": f"/api/sprites/background/{loc_name}/{fname}",
                "slot": slots[i % len(slots)],
                "decorative": True,
            }
        )
    return out
