#!/usr/bin/env python3
"""Remove baked checkerboard / light mattes from yeyu sprites only.

yeyu wears mostly black — edge-flood of low-sat light/mid-grey is safe.
Does not touch other characters. Backs up originals under
data/sprites/_archive/pre_yeyu_matte_clean/romance/yeyu/.
"""

from __future__ import annotations

import argparse
import shutil
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
YEYU = ROOT / "data" / "sprites" / "romance" / "yeyu"
BACKUP = ROOT / "data" / "sprites" / "_archive" / "pre_yeyu_matte_clean" / "romance" / "yeyu"


def _needs_clean(arr: np.ndarray) -> bool:
    a = arr[:, :, 3]
    rgb = arr[:, :, :3]
    sat = rgb.max(2) - rgb.min(2)
    lum = rgb.mean(2)
    light = ((rgb.min(2) > 200) & (a > 200)).mean()
    mid = ((sat <= 22) & (lum >= 100) & (lum < 200) & (a > 200)).mean()
    return float(light) > 0.02 or float(mid) > 0.05


def clean_matte(im: Image.Image) -> Image.Image:
    arr = np.asarray(im.convert("RGBA")).copy()
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float32)
    a = arr[:, :, 3]
    sat = rgb.max(2) - rgb.min(2)
    lum = rgb.mean(2)

    # Checkerboard / light plate / grey grid (not black clothing).
    cand = (a > 8) & (sat <= 24) & (lum >= 95)
    cand |= (a > 8) & (lum >= 220) & (sat <= 45)

    trans = a <= 8
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    ys, xs = np.where(cand)
    for y, x in zip(ys.tolist(), xs.tolist()):
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and trans[ny, nx]:
                bg[y, x] = True
                q.append((y, x))
                break
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))

    out = arr.copy()
    out[bg, 3] = 0
    clear = out[:, :, 3] == 0
    out[clear, 0] = 0
    out[clear, 1] = 0
    out[clear, 2] = 0
    return Image.fromarray(out, "RGBA")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force-all", action="store_true", help="Clean every yeyu png")
    args = ap.parse_args()
    if not YEYU.is_dir():
        print("missing", YEYU)
        return 1

    files = sorted(YEYU.glob("*.png"))
    cleaned = skipped = 0
    for src in files:
        with Image.open(src) as im:
            arr = np.asarray(im.convert("RGBA"))
            if not args.force_all and not _needs_clean(arr):
                skipped += 1
                continue
            out = clean_matte(im)
        if args.dry_run:
            print("would clean", src.name)
            cleaned += 1
            continue
        bak = BACKUP / src.name
        bak.parent.mkdir(parents=True, exist_ok=True)
        if not bak.is_file():
            shutil.copy2(src, bak)
        out.save(src, format="PNG", optimize=True, compress_level=6)
        print("cleaned", src.name)
        cleaned += 1
    print(f"done cleaned={cleaned} skipped_ok={skipped} dry={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
