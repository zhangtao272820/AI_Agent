#!/usr/bin/env python3
"""将立绘按 cast 分目录：romance/ · neutral/ · npc/（与工作区 _pools 等分开）。"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
SOCIAL = ROOT / "data" / "social_graph.json"

WORK_PREFIXES = ("_",)


def load_kinds() -> dict[str, str]:
    data = json.loads(SOCIAL.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for cid, row in (data.get("characters") or {}).items():
        kind = str(row.get("cast_kind") or "romance").strip().lower()
        if kind not in {"romance", "neutral", "npc"}:
            kind = "romance"
        out[cid] = kind
    return out


def main() -> None:
    kinds = load_kinds()
    moved = []
    for cid, kind in sorted(kinds.items()):
        src = SPRITES / cid
        if not src.is_dir():
            # already nested?
            nested = SPRITES / kind / cid
            if nested.is_dir():
                print(f"skip already {kind}/{cid}")
                continue
            print(f"missing {cid}")
            continue
        dest_parent = SPRITES / kind
        dest_parent.mkdir(parents=True, exist_ok=True)
        dest = dest_parent / cid
        if dest.exists():
            print(f"refuse: {dest} exists")
            continue
        shutil.move(str(src), str(dest))
        moved.append(f"{cid} -> {kind}/{cid}")
        print(moved[-1])
    print(f"done moves={len(moved)}")


if __name__ == "__main__":
    main()
