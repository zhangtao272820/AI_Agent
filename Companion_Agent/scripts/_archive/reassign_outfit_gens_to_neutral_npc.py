#!/usr/bin/env python3
"""将 12 主角不合格换装图撤出，分类后分配给中立/NPC。

- 不覆盖任何人正式情绪基图（无下划线的 png）
- 不删除文件：先集中到 _quarantine/reassign_pool，再拷/移到 neutral/npc
- 主角换装精修另开，本脚本不做生图
"""
from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
DRAFT = ROOT / "data" / "cast_pick_draft.json"
Q = SPRITES / "_quarantine"
POOL = Q / "reassign_pool"
LEFTOVER = Q / "pool_leftover"
NOTES = Q / "notes"

OUTFIT_PREFIXES = (
    "school_",
    "casual_",
    "work_",
    "home_",
    "date_",
    "rain_",
    "festival_spring_",
    "festival_midautumn_",
)


def load_cast() -> tuple[list[str], list[str]]:
    draft = json.loads(DRAFT.read_text(encoding="utf-8"))
    picks = draft.get("picks") or {}
    romance, others = [], []
    for cid, row in picks.items():
        kind = (row or {}).get("kind") or ""
        if kind in {"romance", "main_candidate"}:
            romance.append(cid)
        elif kind in {"neutral", "npc"}:
            others.append(cid)
    # stable order for recipients
    others_sorted = sorted(
        others,
        key=lambda c: (0 if (picks[c] or {}).get("kind") == "neutral" else 1, c),
    )
    return sorted(romance), others_sorted


def is_outfit_file(name: str) -> bool:
    return name.endswith(".png") and any(name.startswith(p) for p in OUTFIT_PREFIXES)


def pull_from_romance(romance: list[str]) -> dict[str, list[Path]]:
    """Move outfit pngs from romance live dirs into pool/{cid}/."""
    by_src: dict[str, list[Path]] = defaultdict(list)
    for cid in romance:
        live = SPRITES / cid
        if not live.is_dir():
            continue
        dest_dir = POOL / "from_live" / cid
        dest_dir.mkdir(parents=True, exist_ok=True)
        for p in sorted(live.glob("*.png")):
            if not is_outfit_file(p.name):
                continue
            target = dest_dir / p.name
            if target.exists():
                target = dest_dir / f"{p.stem}__dup{p.suffix}"
            shutil.move(str(p), str(target))
            by_src[cid].append(target)
        # also pull matching staging (keep staging copy as archive under pool)
        stage = SPRITES / "_staging" / cid
        if stage.is_dir():
            stage_dest = POOL / "from_staging" / cid
            stage_dest.mkdir(parents=True, exist_ok=True)
            for p in sorted(stage.glob("*.png")):
                if not is_outfit_file(p.name):
                    continue
                target = stage_dest / p.name
                if not target.exists():
                    shutil.copy2(p, target)
    return by_src


def assign_to_others(romance: list[str], others: list[str]) -> dict[str, Any]:
    """Each neutral/npc gets outfit sets from 2 romance sources (round pairing)."""
    report: dict[str, Any] = {
        "assigned_at": datetime.now(timezone.utc).isoformat(),
        "policy": "poor outfit gens reassigned to neutral/npc; romance mains keep emotion bases only",
        "recipients": {},
        "leftover": [],
    }
    LEFTOVER.mkdir(parents=True, exist_ok=True)

    # Pair romance → recipients (12 → 6 means 2 sources each)
    pairs: dict[str, list[str]] = {o: [] for o in others}
    for i, cid in enumerate(romance):
        recip = others[i % len(others)]
        pairs[recip].append(cid)

    for recip, sources in pairs.items():
        recip_dir = SPRITES / recip
        recip_dir.mkdir(parents=True, exist_ok=True)
        got: list[str] = []
        for si, src in enumerate(sources):
            src_dir = POOL / "from_live" / src
            if not src_dir.is_dir():
                # fall back staging archive
                src_dir = POOL / "from_staging" / src
            if not src_dir.is_dir():
                continue
            for p in sorted(src_dir.glob("*.png")):
                # first source keeps original outfit names; second source gets alt_ prefix to avoid clash
                if si == 0:
                    out_name = p.name
                else:
                    # map second pack into casual_* slots if free, else alt_
                    if p.name.startswith("school_"):
                        out_name = "casual_" + p.name.split("_", 1)[1]
                    elif p.name.startswith("rain_"):
                        out_name = "festival_spring_" + p.name.split("_", 1)[1]
                    else:
                        out_name = f"alt_{p.name}"
                dest = recip_dir / out_name
                if dest.exists():
                    # try leftover
                    left = LEFTOVER / recip / src
                    left.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, left / p.name)
                    report["leftover"].append({"to": recip, "from": src, "file": p.name})
                    continue
                shutil.copy2(p, dest)
                got.append(out_name)
        report["recipients"][recip] = {
            "sources": sources,
            "files_added": got,
            "count": len(got),
        }
    return report


def main() -> None:
    NOTES.mkdir(parents=True, exist_ok=True)
    POOL.mkdir(parents=True, exist_ok=True)
    romance, others = load_cast()
    print("romance", romance)
    print("neutral_npc", others)
    pulled = pull_from_romance(romance)
    print("pulled_live", {k: len(v) for k, v in pulled.items()})
    report = assign_to_others(romance, others)
    out = NOTES / "reassign_to_neutral_npc.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out)
    for recip, row in report["recipients"].items():
        print(f"  {recip}: +{row['count']} from {row['sources']}")
    print("leftover", len(report["leftover"]))


if __name__ == "__main__":
    main()
