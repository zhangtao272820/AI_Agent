#!/usr/bin/env python3
"""List cast refs for Q-avatar generation."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLES = json.loads((ROOT / "data" / "model_roles.json").read_text(encoding="utf-8"))
CAT = json.loads((ROOT / "data" / "sprite_catalog.json").read_text(encoding="utf-8"))

IDS = list(CAT.get("romance_18") or []) + list(CAT.get("roster_neutral") or [])


def walk(o, found: dict) -> None:
    if isinstance(o, dict):
        if "character_id" in o and "name" in o:
            found[o["character_id"]] = {
                "name": o.get("name") or "",
                "appearance": o.get("appearance") or "",
            }
        for v in o.values():
            walk(v, found)
    elif isinstance(o, list):
        for i in o:
            walk(i, found)


def main() -> None:
    found: dict = {}
    walk(ROLES, found)
    for cid in IDS:
        info = found.get(cid, {})
        kind = "neutral" if cid in (CAT.get("roster_neutral") or []) else "romance"
        folder = ROOT / "data" / "sprites" / kind / cid
        ref = folder / "work_neutral.png"
        if not ref.is_file():
            ref = folder / "neutral.png"
        avatar = folder / "avatar.png"
        print(
            "|".join(
                [
                    cid,
                    kind,
                    info.get("name") or "?",
                    (info.get("appearance") or "?")[:80],
                    str(ref) if ref.is_file() else "NOREF",
                    "HAS" if avatar.is_file() else "NEED",
                ]
            )
        )


if __name__ == "__main__":
    main()
