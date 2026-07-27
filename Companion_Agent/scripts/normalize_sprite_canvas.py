#!/usr/bin/env python3
"""Unify VN sprite PNGs to RGBA 1024x1536 bottom-aligned canvas.

Pipeline:
  edge-flood near-black key (keeps interior black clothes) OR keep authored alpha
  → optional baked-checkerboard key
  → trim transparent bbox
  → scale so character height ≈ 92% of canvas
  → bottom-center pad on transparent 1024x1536

Default writes data/sprites/_normalized/{cast}/{id}/.
With --write-formal: backup to _archive/pre_unify/ then overwrite romance|neutral.
Resume: if backup already exists for a file, skip (already unified this batch).
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from collections import deque
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
OUT_NORMALIZED = SPRITES / "_normalized"
BACKUP_ROOT = SPRITES / "_archive" / "pre_unify"

_BLACK_THRESHOLD = 12
_SOFT_BAND = 8
CANVAS = (1024, 1536)  # W, H
FILL_RATIO = 0.92


def _edge_key_black(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.asarray(rgba).copy()
    if int(arr[:, :, 3].min()) < 250:
        return Image.fromarray(arr, "RGBA")

    mx = arr[:, :, :3].max(axis=2)
    thr = _BLACK_THRESHOLD
    soft = thr + _SOFT_BAND
    candidate = mx <= soft
    h, w = candidate.shape
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if candidate[y, x] and not bg[y, x]:
            bg[y, x] = True
            q.append((y, x))

    for x in range(w):
        seed(0, x)
        seed(h - 1, x)
    for y in range(h):
        seed(y, 0)
        seed(y, w - 1)

    while q:
        y, x = q.popleft()
        if y > 0 and candidate[y - 1, x] and not bg[y - 1, x]:
            bg[y - 1, x] = True
            q.append((y - 1, x))
        if y + 1 < h and candidate[y + 1, x] and not bg[y + 1, x]:
            bg[y + 1, x] = True
            q.append((y + 1, x))
        if x > 0 and candidate[y, x - 1] and not bg[y, x - 1]:
            bg[y, x - 1] = True
            q.append((y, x - 1))
        if x + 1 < w and candidate[y, x + 1] and not bg[y, x + 1]:
            bg[y, x + 1] = True
            q.append((y, x + 1))

    alpha = arr[:, :, 3].astype(np.float32)
    hard = bg & (mx <= thr)
    alpha[hard] = 0.0
    band = bg & (mx > thr) & (mx < soft)
    if np.any(band):
        t = (mx[band].astype(np.float32) - thr) / float(_SOFT_BAND)
        alpha[band] = alpha[band] * t
    arr[:, :, 3] = np.clip(alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def _key_baked_checkerboard(im: Image.Image, cell: int = 8) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.asarray(rgba).copy()
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int16)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    flat_grey = (sat <= 18) & (rgb.mean(axis=2) >= 165) & (rgb.mean(axis=2) <= 250)
    border = np.zeros((h, w), dtype=bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    border_grey_ratio = float(flat_grey[border].mean()) if np.any(border) else 0.0
    if border_grey_ratio < 0.35:
        return rgba

    candidate = flat_grey
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if candidate[y, x] and not bg[y, x]:
            bg[y, x] = True
            q.append((y, x))

    for x in range(w):
        seed(0, x)
        seed(h - 1, x)
    for y in range(h):
        seed(y, 0)
        seed(y, w - 1)
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))
    arr[bg, 3] = 0
    return Image.fromarray(arr, "RGBA")


def _trim_transparent(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return rgba
    return rgba.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def normalize_image(im: Image.Image, size: tuple[int, int] = CANVAS) -> Image.Image:
    keyed = _edge_key_black(im)
    keyed = _key_baked_checkerboard(keyed)
    trimmed = _trim_transparent(keyed)
    tw, th = trimmed.size
    cw, ch = size
    if tw <= 0 or th <= 0:
        return Image.new("RGBA", size, (0, 0, 0, 0))
    target_h = max(1, int(round(ch * FILL_RATIO)))
    scale = min(cw / tw, target_h / th)
    nw = max(1, int(round(tw * scale)))
    nh = max(1, int(round(th * scale)))
    resized = trimmed.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (cw - nw) // 2
    y = ch - nh
    canvas.paste(resized, (x, y), resized)
    return canvas


def _is_unified(path: Path) -> bool:
    """True if already 1024x1536 with real transparency."""
    try:
        with Image.open(path) as im:
            if im.size != CANVAS:
                return False
            a = np.asarray(im.convert("RGBA"))[:, :, 3]
            return int(a.min()) < 250
    except OSError:
        return False


def _process_one(job: tuple[str, str, str, bool]) -> str:
    """Worker: (cast, char_id, src_path, write_formal) -> status tag."""
    cast, char_id, src_s, write_formal = job
    src = Path(src_s)
    bak = BACKUP_ROOT / cast / char_id / src.name
    if write_formal and bak.is_file() and _is_unified(src):
        return "skip"

    # Prefer processing from pre-unify backup if present (avoids double-normalize artifacts).
    read_path = bak if bak.is_file() else src

    with Image.open(read_path) as im:
        out = normalize_image(im)
    if out.mode != "RGBA":
        out = out.convert("RGBA")

    if write_formal:
        bak.parent.mkdir(parents=True, exist_ok=True)
        if not bak.is_file():
            shutil.copy2(src, bak)
        dest = src
    else:
        dest = OUT_NORMALIZED / cast / char_id / src.name
        dest.parent.mkdir(parents=True, exist_ok=True)

    out.save(dest, format="PNG", optimize=True, compress_level=6)
    return "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--character")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--write-formal", action="store_true")
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4) // 2))
    args = ap.parse_args()

    casts = ("romance", "neutral")
    dirs: list[tuple[str, Path]] = []
    if args.character:
        for cast in casts:
            d = SPRITES / cast / args.character
            if d.is_dir():
                dirs.append((cast, d))
        if not dirs:
            raise SystemExit(f"character not found: {args.character}")
    else:
        if not args.all:
            raise SystemExit("pass --character <id> or --all")
        for cast in casts:
            base = SPRITES / cast
            if not base.is_dir():
                continue
            for d in sorted(base.iterdir()):
                if d.is_dir() and not d.name.startswith("_"):
                    dirs.append((cast, d))

    jobs: list[tuple[str, str, str, bool]] = []
    for cast, src_dir in dirs:
        files = sorted(src_dir.glob("*.png"))
        if args.limit > 0:
            files = files[: args.limit]
        for src in files:
            jobs.append((cast, src_dir.name, str(src), bool(args.write_formal)))

    print(f"jobs={len(jobs)} workers={args.workers} formal={args.write_formal}", flush=True)
    if args.dry_run:
        print("dry-run only", flush=True)
        return 0

    ok = skip = err = 0
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(_process_one, j): j for j in jobs}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                tag = fut.result()
                if tag == "skip":
                    skip += 1
                else:
                    ok += 1
            except Exception as e:  # noqa: BLE001
                err += 1
                j = futs[fut]
                print(f"ERR {j[0]}/{j[1]}/{Path(j[2]).name}: {e}", flush=True)
            if i % 40 == 0 or i == len(jobs):
                print(f"  progress {i}/{len(jobs)} ok={ok} skip={skip} err={err}", flush=True)

    print(f"done ok={ok} skip={skip} err={err}", flush=True)
    if args.write_formal:
        print(f"backups: {BACKUP_ROOT}", flush=True)
    return 1 if err else 0


if __name__ == "__main__":
    # Windows spawn-safe
    sys.exit(main())
