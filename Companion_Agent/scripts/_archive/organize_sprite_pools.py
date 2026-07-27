#!/usr/bin/env python3
"""整理立绘目录：主角正式目录只留情绪基图；新图→中立池；差图→NPC 池。

- 不删除 png，只 move
- 不覆盖已有目标（重名则加 __dupN）
- 不改 social_graph / cast_kind；池子不进游戏 resolve
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
CATALOG = ROOT / "data" / "sprite_catalog.json"
NOTES = SPRITES / "_quarantine" / "notes"
POOLS = SPRITES / "_pools"
NEUTRAL = POOLS / "neutral"
NPC = POOLS / "npc"

STANDARD_EMOTIONS = {
    "neutral",
    "happy",
    "shy",
    "sad",
    "angry",
    "love",
    "surprised",
    "sarcastic",
}

ROSTER_FALLBACK = [
    "xiaoyou",
    "shizuku",
    "wanyu",
    "xingnai",
    "fengyin",
    "linxi",
    "qingcai",
    "xiaoyang",
    "taotao",
    "qiansha",
    "yeyu",
    "moran",
    "aili",
    "jingliu",
    "ruolin",
    "miara",
    "shiori",
    "luna",
]

BAD_STAGING_DIRS = ("_bad_t2i_wave1", "_bad_edit_wave1")


def roster() -> list[str]:
    if CATALOG.is_file():
        raw = json.loads(CATALOG.read_text(encoding="utf-8"))
        ids = raw.get("romance_18") or raw.get("roster_18") or []
        if ids:
            return list(ids)
    return list(ROSTER_FALLBACK)


def unique_dest(dest: Path) -> Path:
    if not dest.exists():
        return dest
    n = 1
    while True:
        alt = dest.with_name(f"{dest.stem}__dup{n}{dest.suffix}")
        if not alt.exists():
            return alt
        n += 1


def move_file(src: Path, dest: Path, *, dry_run: bool, moves: list[dict[str, str]]) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    final = unique_dest(dest)
    moves.append({"from": str(src.relative_to(SPRITES)), "to": str(final.relative_to(SPRITES))})
    if not dry_run:
        shutil.move(str(src), str(final))


def is_emotion_base(name: str) -> bool:
    return name.endswith(".png") and Path(name).stem in STANDARD_EMOTIONS


def clean_live_outfits(ids: list[str], *, dry_run: bool) -> list[dict[str, str]]:
    moves: list[dict[str, str]] = []
    for cid in ids:
        live = SPRITES / "romance" / cid
        if not live.is_dir():
            live = SPRITES / cid
        if not live.is_dir():
            continue
        for p in sorted(live.glob("*.png")):
            if is_emotion_base(p.name):
                continue
            dest = NPC / "reassign_pollution" / cid / p.name
            move_file(p, dest, dry_run=dry_run, moves=moves)
    return moves


def move_staging_wave2(ids: list[str], *, dry_run: bool) -> list[dict[str, str]]:
    moves: list[dict[str, str]] = []
    staging = SPRITES / "_staging"
    if not staging.is_dir():
        return moves
    for cid in ids:
        src_dir = staging / cid
        if not src_dir.is_dir():
            continue
        for p in sorted(src_dir.rglob("*.png")):
            rel = p.relative_to(src_dir)
            dest = NEUTRAL / "wave2_edit" / cid / rel
            move_file(p, dest, dry_run=dry_run, moves=moves)
    return moves


def move_bad_batches(*, dry_run: bool) -> list[dict[str, str]]:
    moves: list[dict[str, str]] = []
    staging = SPRITES / "_staging"
    for dirname in BAD_STAGING_DIRS:
        src_dir = staging / dirname
        if not src_dir.is_dir():
            continue
        # pool name without leading underscore
        pool_name = dirname.lstrip("_")
        for p in sorted(src_dir.rglob("*.png")):
            rel = p.relative_to(src_dir)
            dest = NPC / pool_name / rel
            move_file(p, dest, dry_run=dry_run, moves=moves)
    return moves


def count_pngs(root: Path) -> int:
    if not root.is_dir():
        return 0
    return sum(1 for _ in root.rglob("*.png"))


def verify_live(ids: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for cid in ids:
        live = SPRITES / "romance" / cid
        if not live.is_dir():
            live = SPRITES / cid
        emos, outfits = [], []
        if live.is_dir():
            for p in sorted(live.glob("*.png")):
                if is_emotion_base(p.name):
                    emos.append(p.name)
                else:
                    outfits.append(p.name)
        out[cid] = {"emotion": emos, "outfit_leftover": outfits, "ok": len(outfits) == 0}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不移动文件")
    args = ap.parse_args()
    dry = bool(args.dry_run)
    ids = roster()

    live_moves = clean_live_outfits(ids, dry_run=dry)
    wave_moves = move_staging_wave2(ids, dry_run=dry)
    bad_moves = move_bad_batches(dry_run=dry)

    report: dict[str, Any] = {
        "organized_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry,
        "policy": {
            "live": "emotion bases under data/sprites/romance/{id}/",
            "neutral_live": "data/sprites/neutral/{id}/",
            "npc_live": "data/sprites/npc/{id}/",
            "neutral_pool": "_pools/neutral — newer batch edits workspace",
            "npc_pool": "_pools/npc — bad batches workspace",
            "game": "resolve via sprite_catalog.resolve_sprite_dir; pools not served",
        },
        "counts": {
            "live_outfits_to_npc": len(live_moves),
            "staging_to_neutral": len(wave_moves),
            "bad_to_npc": len(bad_moves),
            "total_moves": len(live_moves) + len(wave_moves) + len(bad_moves),
        },
        "moves": {
            "live_outfits_to_npc": live_moves,
            "staging_to_neutral": wave_moves,
            "bad_to_npc": bad_moves,
        },
    }

    if not dry:
        report["pool_png_counts"] = {
            "neutral": count_pngs(NEUTRAL),
            "npc": count_pngs(NPC),
        }
        report["live_verify"] = verify_live(ids)
        NOTES.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        path = NOTES / f"organize_pools_{stamp}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report["report_path"] = str(path.relative_to(ROOT))
        print(f"wrote {path}")
    else:
        print(json.dumps(report["counts"], ensure_ascii=False, indent=2))

    print(
        f"done dry_run={dry} "
        f"live_outfits={len(live_moves)} wave2={len(wave_moves)} bad={len(bad_moves)}"
    )
    if not dry:
        bad_live = [cid for cid, row in report["live_verify"].items() if not row["ok"]]
        if bad_live:
            print(f"WARN leftover outfits in: {bad_live}")
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
