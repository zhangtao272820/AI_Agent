"""结局图鉴：全量 catalog + 存档解锁聚合。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import PROJECT_ROOT
from .save_store import _connect, init_db


def load_endings_catalog() -> list[dict[str, Any]]:
    path = PROJECT_ROOT / "data" / "endings.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data.get("endings") or [])


def public_endings_catalog() -> list[dict[str, Any]]:
    from .presentation import resolve_ending_presentation

    out: list[dict[str, Any]] = []
    for row in load_endings_catalog():
        eid = str(row.get("id") or "")
        chars = row.get("character_ids") or []
        cid = str(chars[0]) if chars else ""
        present = resolve_ending_presentation(
            eid,
            ending_type=str(row.get("type") or "good"),
            character_id=cid,
        )
        out.append(
            {
                "id": eid,
                "type": row.get("type"),
                "title": row.get("title"),
                "subtitle": row.get("subtitle", ""),
                "description": row.get("description", ""),
                "cg_hint": row.get("cg_hint", ""),
                "character_ids": chars,
                "presentation": present,
            }
        )
    return out


def collect_unlocked_endings(user_id: str = "default") -> dict[str, Any]:
    init_db()
    unlocked: set[str] = set()
    by_character: dict[str, list[str]] = {}
    with _connect() as conn:
        rows = conn.execute(
            "SELECT character_id, runtime_json FROM game_saves WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    for row in rows:
        cid = row["character_id"] or ""
        try:
            runtime = json.loads(row["runtime_json"] or "{}")
        except json.JSONDecodeError:
            runtime = {}
        endings = runtime.get("unlocked_endings") or []
        for eid in endings:
            unlocked.add(str(eid))
            by_character.setdefault(cid, [])
            if str(eid) not in by_character[cid]:
                by_character[cid].append(str(eid))
    catalog = {e["id"]: e for e in load_endings_catalog() if e.get("id")}
    return {
        "unlocked_ids": sorted(unlocked),
        "by_character": by_character,
        "entries": [
            {**catalog[eid], "unlocked": True}
            for eid in sorted(unlocked)
            if eid in catalog
        ],
        "catalog": public_endings_catalog(),
    }
