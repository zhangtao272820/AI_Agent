#!/usr/bin/env python3
"""从已解压的立绘包，为 roster 角色复制精选差分到 data/sprites/{character_id}/。

支持：OGA Kuudere/Codel/FALLiNG_AiR/cabbit/DoomGirl，以及 itch Potat0Master 命名约定。
优先使用 catalog 中 character.pack_id；若源缺失则尝试 fallback_pack_id。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "sprite_catalog.json"
OUT_ROOT = ROOT / "data" / "sprites"
PACKS = OUT_ROOT / "_packs"
KUUDERE_BASE = PACKS / "kuudere" / "KUUDERE LisadiKaprio"
FALLING_BASE = PACKS / "falling_air"
CABBIT_BASE = PACKS / "cabbit_vn" / "VN Characters (by cabbit KusSv)"
DOOM_BASE = PACKS / "doom_girl"
ITCH_BASE = PACKS / "itch"

PICK = ("neutral", "happy", "shy", "sad", "angry", "love")

KUUDERE_FILES = {
    "neutral": "neutral.png",
    "happy": "smile.png",
    "shy": "neutral blush.png",
    "sad": "neutral.png",
    "angry": "pissed.png",
    "love": "smile blush.png",
}


def _copy(src: Path | None, dest: Path) -> bool:
    if not src or not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def _first_existing(candidates: list[Path]) -> Path | None:
    for p in candidates:
        if p.is_file():
            return p
    return None


def resolve_pack_paths(emotion_map: dict[str, str], base: Path) -> dict[str, Path | None]:
    out: dict[str, Path | None] = {}
    for emo in PICK:
        rel = emotion_map.get(emo)
        out[emo] = (base / rel) if rel else None
    return out


def kuudere_paths(outfit: str, head: str) -> dict[str, Path | None]:
    result: dict[str, Path | None] = {}
    for emo in PICK:
        fname = KUUDERE_FILES.get(emo)
        if not fname:
            result[emo] = None
            continue
        use_head = "HEAD DOWN" if emo == "sad" else head
        path = KUUDERE_BASE / use_head / outfit / fname
        result[emo] = path if path.is_file() else None
    return result


def itch_expression_paths(char_dir: Path, tmpl: dict[str, str]) -> dict[str, Path | None]:
    """Potat0Master：目录内文件名通常含 Normal/Happy/Blush 等。"""
    pngs = list(char_dir.rglob("*.png")) + list(char_dir.rglob("*.webp"))
    if not pngs:
        return {e: None for e in PICK}

    def find_token(token: str) -> Path | None:
        token_l = token.lower().replace(" ", "")
        for p in pngs:
            stem = p.stem.lower().replace(" ", "").replace("_", "")
            if token_l in stem:
                return p
        return None

    result: dict[str, Path | None] = {}
    for emo in PICK:
        token = tmpl.get(emo, emo)
        result[emo] = find_token(token)
    # fallback: any Normal-ish for missing
    if result.get("neutral") is None:
        result["neutral"] = find_token("normal") or find_token("idle") or (pngs[0] if pngs else None)
    for emo in PICK:
        if result[emo] is None:
            result[emo] = result.get("neutral")
    return result


def find_itch_character_dir(pack_local: str, character_key: str) -> Path | None:
    """在 itch 解压目录中按角色名模糊定位文件夹。"""
    root = ITCH_BASE / pack_local if pack_local else ITCH_BASE
    if not root.is_dir():
        # zip may extract as sibling folder names under itch/
        root = ITCH_BASE
    if not root.is_dir():
        return None
    key = character_key.lower().replace(" ", "")
    # prefer directory named after character
    dirs = [d for d in root.rglob("*") if d.is_dir()]
    for d in dirs:
        if key and key in d.name.lower().replace(" ", ""):
            if any(d.rglob("*.png")) or any(d.rglob("*.webp")):
                return d
    # flat files named Character_Expression
    flat = list(root.rglob("*.png")) + list(root.rglob("*.webp"))
    hits = [p for p in flat if key in p.stem.lower().replace(" ", "")]
    if hits:
        return hits[0].parent
    return None


def paths_for_pack(pack_id: str, row: dict, templates: dict) -> dict[str, Path | None] | None:
    if pack_id == "oga_kuudere":
        return kuudere_paths(row.get("outfit", "school uniform"), row.get("head", "HEAD UP"))

    if pack_id == "oga_codel":
        tmpl = templates.get("oga_codel") or {}
        return {e: (PACKS / "codel" / tmpl[e]) if tmpl.get(e) else None for e in PICK}

    if pack_id == "oga_falling_air":
        cha = row.get("source_character", "cha 1")
        outfit = row.get("outfit", "summer")  # summer | winter (w* prefix)
        tmpl = (templates.get("oga_falling_air") or {}).get(cha) or {}
        base = FALLING_BASE / cha / "image"
        result: dict[str, Path | None] = {}
        for emo in PICK:
            fname = tmpl.get(emo)
            if not fname:
                result[emo] = None
                continue
            if outfit == "winter" and not fname.startswith("w"):
                # try winter prefix form: plN wXXXX.png already in templates if set
                pass
            result[emo] = base / fname if fname else None
        return result

    if pack_id == "oga_cabbit":
        prefix = row.get("source_character", "VN_Anna")
        tmpl = (templates.get("oga_cabbit") or {}).get(prefix) or {}
        result = {}
        for emo in PICK:
            fname = tmpl.get(emo)
            result[emo] = (CABBIT_BASE / fname) if fname else None
        return result

    if pack_id == "oga_doom_girl":
        tmpl = templates.get("oga_doom_girl") or {}
        outfit = str(row.get("outfit", "0"))
        outfit_map = tmpl.get(outfit) or tmpl.get("0") or {}
        result = {}
        for emo in PICK:
            name = outfit_map.get(emo)
            result[emo] = (DOOM_BASE / name) if name else None
        return result

    if pack_id.startswith("itch_"):
        local = row.get("itch_local_dir") or pack_id.replace("itch_", "")
        char_key = row.get("source_character") or row.get("itch_character") or ""
        char_dir = find_itch_character_dir(local, char_key)
        if not char_dir:
            return None
        tmpl = templates.get("potat0master_generic") or {
            "neutral": "Normal",
            "happy": "Happy",
            "shy": "Blush",
            "sad": "Sad",
            "angry": "Angry",
            "love": "Blush",
        }
        return itch_expression_paths(char_dir, tmpl)

    return None


def stage_character(cid: str, row: dict, templates: dict) -> tuple[bool, str]:
    pack_id = row.get("pack_id") or ""
    fallback = row.get("fallback_pack_id") or ""
    attempts = [pack_id] + ([fallback] if fallback and fallback != pack_id else [])

    dest_dir = OUT_ROOT / cid
    dest_dir.mkdir(parents=True, exist_ok=True)

    last_reason = "no pack"
    for pid in attempts:
        if not pid:
            continue
        # for itch, inject local dir from catalog packs section via row hints
        paths = paths_for_pack(pid, row, templates)
        if not paths:
            last_reason = f"{pid} unresolved"
            continue
        copied = 0
        for emo in PICK:
            if _copy(paths.get(emo), dest_dir / f"{emo}.png"):
                copied += 1
        if copied:
            return True, f"{pid} ({copied} png)"
        last_reason = f"{pid} files missing"
    return False, last_reason


def main() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    templates = data.get("emotion_map_templates") or {}
    roster = data.get("roster_18") or data.get("roster_12") or [c["id"] for c in data.get("characters") or []]
    by_id = {c["id"]: c for c in data.get("characters") or []}
    packs = data.get("packs") or {}

    # enrich rows with itch_local_dir from pack meta
    for row in by_id.values():
        pid = row.get("pack_id") or ""
        meta = packs.get(pid) or {}
        if "local_dir" in meta and "itch" in str(meta.get("local_dir", "")):
            # local_dir like data/sprites/_packs/itch/set_a01 → set_a01
            parts = Path(meta["local_dir"]).parts
            if "itch" in parts:
                idx = parts.index("itch")
                row.setdefault("itch_local_dir", "/".join(parts[idx + 1 :]) or "")

    staged = 0
    for cid in roster:
        row = by_id.get(cid)
        if not row:
            print(f"[skip] {cid} not in catalog")
            continue
        ok, detail = stage_character(cid, row, templates)
        if ok:
            staged += 1
            print(f"[ok] {cid} <- {detail}")
        else:
            print(f"[fail] {cid} {detail}")

    print(f"\nstaged {staged}/{len(roster)} roster characters")


if __name__ == "__main__":
    main()
