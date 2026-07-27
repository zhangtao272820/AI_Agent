#!/usr/bin/env python3
"""将 assets/tachie_{id}_{emotion}.png 整理进 data/sprites/{id}/（全新立绘）。"""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:/Users/Administrator/.cursor/projects/e-Agent/assets")
OUT = ROOT / "data" / "sprites"
PACK = OUT / "_packs" / "cn_gal_18"

ROMANCE = [
    "xiaoyou",
    "shizuku",
    "xingnai",
    "fengyin",
    "qingcai",
    "xiaoyang",
    "qiansha",
    "yeyu",
    "jingliu",
    "aili",
    "miara",
    "shiori",
]
NEUTRALS = ["wanyu", "linxi", "taotao", "moran", "ruolin", "luna"]
ALL = ROMANCE + NEUTRALS

# core emotions we want distinct files for
EMOTIONS = (
    "neutral",
    "happy",
    "shy",
    "sad",
    "angry",
    "love",
    "surprised",
    "sarcastic",
)

# when a dedicated file is missing, fall back to nearest art
FALLBACK = {
    "sad": "shy",
    "angry": "shy",
    "love": "happy",
    "surprised": "happy",
    "sarcastic": "happy",
    "mock": "sarcastic",
    "contempt": "sarcastic",
    "annoyed": "angry",
    "smug": "happy",
}


def find_src(cid: str, emotion: str) -> Path | None:
    cands = [
        SRC / f"tachie_{cid}_{emotion}.png",
        SRC / f"tachie_{cid}.png" if emotion == "neutral" else None,
    ]
    for p in cands:
        if p and p.is_file():
            return p
    return None


def process(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r + g + b < 45:
                px[x, y] = (r, g, b, 0)
            elif r > 245 and g > 245 and b > 245:
                px[x, y] = (r, g, b, 0)
    im.thumbnail((900, 1800), Image.Resampling.LANCZOS)
    return im


def main() -> None:
    PACK.mkdir(parents=True, exist_ok=True)
    missing: list[str] = []
    for cid in ALL:
        dest = OUT / cid
        dest.mkdir(parents=True, exist_ok=True)
        resolved: dict[str, Path] = {}
        for emo in EMOTIONS:
            src = find_src(cid, emo)
            if src:
                resolved[emo] = src
            else:
                missing.append(f"{cid}/{emo}")
        # fill via fallbacks for missing among EMOTIONS
        for emo in EMOTIONS:
            if emo in resolved:
                continue
            fb = FALLBACK.get(emo, "neutral")
            chain = [fb, "neutral", "happy", "shy"]
            for key in chain:
                if key in resolved:
                    resolved[emo] = resolved[key]
                    break
                src = find_src(cid, key)
                if src:
                    resolved[emo] = src
                    break

        for emo, src in resolved.items():
            im = process(Image.open(src))
            master = PACK / f"{cid}_{emo}.png"
            # only overwrite master if we have dedicated source name
            if src.name.endswith(f"_{emo}.png") or (emo == "neutral" and src.name == f"tachie_{cid}.png"):
                im.save(master, "PNG")
                shutil.copy2(master, dest / f"{emo}.png")
            else:
                # fallback copy processed
                out = dest / f"{emo}.png"
                im.save(out, "PNG")

        # extras
        for emo, fb in (("mock", "sarcastic"), ("contempt", "sarcastic"), ("annoyed", "angry"), ("smug", "happy")):
            src_path = dest / f"{fb}.png"
            if src_path.is_file():
                shutil.copy2(src_path, dest / f"{emo}.png")

        n = dest / "neutral.png"
        print(f"[ok] {cid} files={len(list(dest.glob('*.png')))} md5={hashlib.md5(n.read_bytes()).hexdigest()[:8] if n.is_file() else '?'}")

    print("missing dedicated assets:", len(missing))
    for m in missing[:40]:
        print(" ", m)
    if len(missing) > 40:
        print(f"  ... +{len(missing)-40}")


if __name__ == "__main__":
    main()
