# -*- coding: utf-8 -*-
"""Organize demoted/passerby sprite pools into location-tagged background extras.

Background extras are NOT playable cast. They only decorate late-game location scenes
(same role as scene BGs in data/bgs/): nameless, no dialogue, no roster id.
"""
from __future__ import annotations

import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
OUT = SPRITES / "_background"
CATALOG = ROOT / "data" / "background_extras.json"
QUAR = SPRITES / "_quarantine"

# Heuristic: filename keywords → location pack
LOC_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("cafe", re.compile(r"cafe|barista|tray|latte|apron", re.I)),
    ("campus", re.compile(r"school|campus|lecture|club", re.I)),
    ("library", re.compile(r"library|book|shelf|archive", re.I)),
    ("office", re.compile(r"work|office|boardroom|desk", re.I)),
    ("street", re.compile(r"casual|street|rain|date|festival", re.I)),
    ("home", re.compile(r"home|dorm|room", re.I)),
    ("store", re.compile(r"store|merch|shop", re.I)),
    ("park", re.compile(r"park|festival_spring|midautumn", re.I)),
]

KEEP_EMOTION = re.compile(r"(neutral|happy|shy)\.png$", re.I)
SKIP = re.compile(r"(__dup|contempt|mock|smug|annoyed)", re.I)
MAX_PER_LOC = 24
MAX_PER_SOURCE = 8


def guess_loc(name: str) -> str:
    for loc, pat in LOC_RULES:
        if pat.search(name):
            return loc
    return "street"


def _keep_file(name: str) -> bool:
    if SKIP.search(name):
        return False
    if name.startswith("alt_"):
        return bool(
            KEEP_EMOTION.search(name)
            or "_neutral" in name
            or name.endswith("_happy.png")
            or name.endswith("_shy.png")
        )
    return name in {"neutral.png", "happy.png", "shy.png"}


def collect_sources() -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    # Former named NPCs (moxi/luli) — nameless background raw only
    demoted = QUAR / "named_npc_demoted"
    if demoted.is_dir():
        for src_dir in sorted(demoted.iterdir()):
            if not src_dir.is_dir():
                continue
            for p in src_dir.glob("*.png"):
                if _keep_file(p.name):
                    out.append((f"bg_{src_dir.name}", p))
    # Legacy alt dumps (if still present)
    alts = QUAR / "npc_alts"
    if alts.is_dir():
        for src_dir in sorted(alts.iterdir()):
            if not src_dir.is_dir():
                continue
            for p in src_dir.glob("*.png"):
                if _keep_file(p.name):
                    out.append((f"bg_{src_dir.name}", p))
    # Old neutrals already quarantined
    pool = QUAR / "passerby_pool"
    if pool.is_dir():
        for src_dir in sorted(pool.iterdir()):
            if not src_dir.is_dir():
                continue
            for p in src_dir.glob("*.png"):
                if _keep_file(p.name):
                    out.append((f"pool_{src_dir.name}", p))
    return out


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    by_loc: dict[str, list[dict]] = defaultdict(list)
    per_source: dict[str, int] = defaultdict(int)

    for source, path in collect_sources():
        if per_source[source] >= MAX_PER_SOURCE:
            continue
        loc = guess_loc(path.name)
        if len(by_loc[loc]) >= MAX_PER_LOC:
            # try street overflow
            loc = "street"
            if len(by_loc[loc]) >= MAX_PER_LOC:
                continue
        dest_dir = OUT / loc
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem = f"{source}__{path.stem}"[:80]
        dest = dest_dir / f"{stem}.png"
        if dest.exists():
            continue
        shutil.copy2(path, dest)
        by_loc[loc].append(
            {
                "id": stem,
                "file": f"{loc}/{dest.name}",
                "source": source,
                "location": loc,
            }
        )
        per_source[source] += 1

    catalog = {
        "version": "2026-07-18",
        "note": (
            "无名路人装饰层（与 data/bgs 场景底图同类）：仅装饰地点场景，不可对话、无角色名。"
            "解锁：calendar.day_index >= unlock_day"
        ),
        "unlock_day": 7,
        "root": "data/sprites/_background",
        "locations": {loc: rows for loc, rows in sorted(by_loc.items())},
        "counts": {loc: len(rows) for loc, rows in sorted(by_loc.items())},
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("background extras:", catalog["counts"])
    print("wrote", CATALOG)


if __name__ == "__main__":
    main()
