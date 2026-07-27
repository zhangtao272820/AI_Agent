#!/usr/bin/env python3
"""从 _pools / _quarantine / _staging 再分配立绘到新中立/NPC 正式目录。

- 不覆盖现有 18 恋爱角正式目录
- 差图也迁入新角；搬空后删空壳
- 写出 _quarantine/notes/spinoff_map.json
"""
from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
POOLS = SPRITES / "_pools"
QUAR = SPRITES / "_quarantine"
STAGING = SPRITES / "_staging"
NOTES = QUAR / "notes"

ROMANCE_18 = {
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
}

# 新角 ← 主源脸批次（池内文件最多的几套）
PRIMARY: dict[str, str] = {
    "heqing": "aili",
    "xiaoke": "xiaoyou",
    "lele": "linxi",
    "anran": "wanyu",
    "moxi": "shizuku",
    "luli": "qingcai",
}

STANDARD_EMOTIONS = (
    "neutral",
    "happy",
    "shy",
    "sad",
    "angry",
    "love",
    "surprised",
    "sarcastic",
)

SKIP_DIR_NAMES = {
    "notes",
    "_tasks",
    "archived_bad_batches",
    "near_dup",
    "pool_leftover",
    "wrong_id",
}


def _is_char_id(name: str) -> bool:
    if not name or name.startswith("_"):
        return False
    if name in SKIP_DIR_NAMES:
        return False
    if name in {
        "wave2_edit",
        "reassign_pollution",
        "bad_t2i_wave1",
        "bad_edit_wave1",
        "script_reject",
        "batch_interrupted",
        "from_staging",
        "from_live",
        "reassign_pool",
        "fengyin_emotion_backup",
    }:
        return False
    return True


def infer_source_id(path: Path, root: Path) -> str | None:
    parts = path.relative_to(root).parts
    for part in reversed(parts[:-1]):
        if _is_char_id(part):
            return part
        # fengyin_emotion_backup → fengyin
        if part.endswith("_emotion_backup"):
            return part[: -len("_emotion_backup")]
    return None


def collect_work_pngs() -> dict[str, list[Path]]:
    """按源角色 id 收集工作区 png（pools / quarantine / staging）。"""
    by: dict[str, list[Path]] = defaultdict(list)
    for root in (POOLS, QUAR, STAGING):
        if not root.is_dir():
            continue
        for p in root.rglob("*.png"):
            if "notes" in p.parts:
                continue
            sid = infer_source_id(p, root)
            if sid:
                by[sid].append(p)
    return by


def unique_dest(dest: Path) -> Path:
    if not dest.exists():
        return dest
    n = 1
    while True:
        alt = dest.with_name(f"{dest.stem}__dup{n}{dest.suffix}")
        if not alt.exists():
            return alt
        n += 1


def move_file(src: Path, dest: Path, *, dry_run: bool, moves: list[dict]) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    final = unique_dest(dest)
    moves.append({"from": str(src), "to": str(final)})
    if dry_run:
        return
    shutil.move(str(src), str(final))


def ensure_emotion_bases(dest_dir: Path, *, dry_run: bool, moves: list[dict]) -> dict[str, str]:
    """尽量凑齐 8 情绪基图：已有则保留；否则从 outfit_emotion / 近义复制。"""
    filled: dict[str, str] = {}
    if not dest_dir.is_dir() and dry_run:
        return filled
    existing = {p.stem: p for p in dest_dir.glob("*.png")} if dest_dir.is_dir() else {}

    # 1) 已有标准情绪
    for emo in STANDARD_EMOTIONS:
        if emo in existing:
            filled[emo] = existing[emo].name

    # 2) 从 *_{emo}.png 补
    for emo in STANDARD_EMOTIONS:
        if emo in filled:
            continue
        candidates = sorted(dest_dir.glob(f"*_{emo}.png")) if dest_dir.is_dir() else []
        # 优先 home/casual/work/date
        prefer = ("home_", "casual_", "work_", "date_", "school_", "rain_")
        ordered = sorted(
            candidates,
            key=lambda p: next((i for i, pre in enumerate(prefer) if p.name.startswith(pre)), 99),
        )
        if ordered:
            src = ordered[0]
            dest = dest_dir / f"{emo}.png"
            if dry_run:
                filled[emo] = f"(copy){src.name}->{emo}.png"
                continue
            if not dest.exists():
                shutil.copy2(src, dest)
            filled[emo] = dest.name

    # 3) 近义回退
    aliases = {
        "sad": ["shy", "neutral", "angry"],
        "love": ["happy", "shy", "neutral"],
        "surprised": ["happy", "neutral"],
        "sarcastic": ["angry", "neutral", "happy"],
        "angry": ["neutral", "shy"],
        "shy": ["neutral", "happy"],
        "happy": ["neutral", "shy"],
        "neutral": ["happy", "shy", "home_neutral"],
    }
    for emo in STANDARD_EMOTIONS:
        if emo in filled:
            continue
        for alt in aliases.get(emo, ["neutral", "happy"]):
            src_path = dest_dir / f"{alt}.png"
            if alt.endswith("_neutral"):
                # skip invalid
                pass
            if src_path.is_file() or (dry_run and alt in filled):
                dest = dest_dir / f"{emo}.png"
                if dry_run:
                    filled[emo] = f"(alias){alt}->{emo}"
                    break
                if src_path.is_file() and not dest.exists():
                    shutil.copy2(src_path, dest)
                    filled[emo] = dest.name
                    break
    return filled


def remove_empty_dirs(root: Path) -> list[str]:
    removed: list[str] = []
    if not root.is_dir():
        return removed
    # bottom-up
    for p in sorted(root.rglob("*"), key=lambda x: len(x.parts), reverse=True):
        if p.is_dir():
            try:
                next(p.iterdir())
            except StopIteration:
                p.rmdir()
                removed.append(str(p.relative_to(root)))
            except OSError:
                pass
    return removed


def archive_staging_tasks(*, dry_run: bool) -> list[str]:
    """保留最近 2 个 tasks_*.json + 最近 1 个 gen_*.log，其余移入 quarantine/notes。"""
    tasks = STAGING / "_tasks"
    if not tasks.is_dir():
        return []
    dest = NOTES / "staging_tasks_archive"
    actions: list[str] = []
    jsons = sorted(tasks.glob("tasks_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    logs = sorted(tasks.glob("gen_*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    keep = set(jsons[:2] + logs[:1])
    for p in list(tasks.iterdir()):
        if not p.is_file():
            continue
        if p in keep:
            continue
        target = dest / p.name
        actions.append(f"{p.name} -> notes/staging_tasks_archive/")
        if dry_run:
            continue
        dest.mkdir(parents=True, exist_ok=True)
        target = unique_dest(target)
        shutil.move(str(p), str(target))
    return actions


def run(*, dry_run: bool) -> dict:
    by_src = collect_work_pngs()
    moves: list[dict] = []
    map_rows: dict[str, dict] = {}
    new_ids = list(PRIMARY.keys())
    primary_sources = set(PRIMARY.values())

    # 主批次
    for new_id, src_id in PRIMARY.items():
        dest_dir = SPRITES / (
            "neutral" if new_id in {"heqing", "xiaoke", "lele", "anran"} else "npc"
        ) / new_id
        if dest_dir.exists() and any(dest_dir.glob("*.png")):
            raise SystemExit(f"refuse: {dest_dir} already has pngs (won't overwrite)")
        files = list(by_src.get(src_id) or [])
        for src in files:
            move_file(src, dest_dir / src.name, dry_run=dry_run, moves=moves)
        filled = ensure_emotion_bases(dest_dir, dry_run=dry_run, moves=moves)
        map_rows[new_id] = {
            "primary_source": src_id,
            "moved": len(files),
            "emotion_bases": filled,
        }

    # 剩余源：轮询分给 6 个新角
    extras_count = {nid: 0 for nid in new_ids}

    def _dest_for(new_id: str) -> Path:
        kind = "neutral" if new_id in {"heqing", "xiaoke", "lele", "anran"} else "npc"
        return SPRITES / kind / new_id

    for src_id, files in sorted(by_src.items()):
        if src_id in primary_sources:
            continue
        for i, src in enumerate(files):
            new_id = new_ids[i % len(new_ids)]
            dest = _dest_for(new_id) / f"alt_{src_id}_{src.name}"
            move_file(src, dest, dry_run=dry_run, moves=moves)
            extras_count[new_id] += 1
    for nid, n in extras_count.items():
        map_rows[nid]["extra_alts"] = n

    # 再补一次情绪基图（extras 可能带来更好的基图）
    if not dry_run:
        for new_id in new_ids:
            map_rows[new_id]["emotion_bases"] = ensure_emotion_bases(
                _dest_for(new_id), dry_run=False, moves=moves
            )

    task_actions: list[str] = []
    empty_removed: dict[str, list[str]] = {}
    if not dry_run:
        task_actions = archive_staging_tasks(dry_run=False)
        for name, root in (("_pools", POOLS), ("_staging", STAGING), ("_quarantine", QUAR)):
            empty_removed[name] = remove_empty_dirs(root)
        # 若 pools 下顶级子树已空，再扫一遍
        for name, root in (("_pools", POOLS), ("_staging", STAGING), ("_quarantine", QUAR)):
            empty_removed[name].extend(remove_empty_dirs(root))

    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry_run,
        "primary": PRIMARY,
        "characters": map_rows,
        "moves": len(moves),
        "staging_tasks_archived": task_actions,
        "empty_dirs_removed": empty_removed,
    }
    NOTES.mkdir(parents=True, exist_ok=True)
    map_path = NOTES / "spinoff_map.json"
    if not dry_run:
        # 完整 moves 可能很大，摘要 + 另存 moves
        map_path.write_text(
            json.dumps({k: v for k, v in report.items() if k != "move_details"}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
        (NOTES / "spinoff_moves.json").write_text(
            json.dumps(moves, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps({k: v for k, v in report.items() if k not in {"move_details"}}, ensure_ascii=False, indent=2))
    print(f"map -> {map_path}")
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
