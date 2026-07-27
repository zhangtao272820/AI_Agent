#!/usr/bin/env python3
"""Install generated Q avatars into romance/neutral sprite dirs.

Supports:
  avatar_{id}.png           → {kind}/{id}/avatar.png
  avatar_{id}_{emotion}.png → {kind}/{id}/avatar_{emotion}.png

Reads from Cursor assets dir (or --src-dir), keys light/dark matte
from borders, crops to square 512.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = Path(
    r"C:\Users\Administrator\.cursor\projects\e-Agent\assets"
)

EMOTION_RE = re.compile(r"^avatar_([a-z0-9]+)(?:_([a-z]+))?\.png$", re.I)


def cast_kind(cid: str, cat: dict) -> str:
    if cid in (cat.get("roster_neutral") or []):
        return "neutral"
    return "romance"


def key_and_square(src: Path, size: int = 512) -> Image.Image:
    arr = np.asarray(Image.open(src).convert("RGBA")).copy()
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float32)
    a = arr[:, :, 3]
    sat = rgb.max(2) - rgb.min(2)
    lum = rgb.mean(2)

    if int(a.min()) >= 250 or (a == 0).mean() < 0.02:
        cand = ((lum <= 40) & (sat <= 40)) | ((lum >= 220) & (sat <= 45))
        bg = np.zeros((h, w), dtype=bool)
        q: deque[tuple[int, int]] = deque()
        for x in range(w):
            for y in (0, h - 1):
                if cand[y, x]:
                    bg[y, x] = True
                    q.append((y, x))
        for y in range(h):
            for x in (0, w - 1):
                if cand[y, x] and not bg[y, x]:
                    bg[y, x] = True
                    q.append((y, x))
        while q:
            y, x = q.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not bg[ny, nx]:
                    bg[ny, nx] = True
                    q.append((ny, nx))
        arr[bg, 3] = 0
    clear = arr[:, :, 3] == 0
    arr[clear, 0] = 0
    arr[clear, 1] = 0
    arr[clear, 2] = 0

    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        return Image.fromarray(arr).resize((size, size), Image.Resampling.LANCZOS)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    pad = int(0.06 * max(y1 - y0, x1 - x0))
    y0 = max(0, y0 - pad)
    x0 = max(0, x0 - pad)
    y1 = min(h - 1, y1 + pad)
    x1 = min(w - 1, x1 + pad)
    crop = arr[y0 : y1 + 1, x0 : x1 + 1]
    ch, cw = crop.shape[:2]
    side = max(ch, cw)
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    oy = (side - ch) // 2
    ox = (side - cw) // 2
    canvas[oy : oy + ch, ox : ox + cw] = crop
    return Image.fromarray(canvas).resize((size, size), Image.Resampling.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src-dir", type=Path, default=DEFAULT_SRC)
    ap.add_argument(
        "--emotions-only",
        action="store_true",
        help="Only install avatar_{id}_{emotion}.png variants",
    )
    args = ap.parse_args()
    cat = json.loads((ROOT / "data" / "sprite_catalog.json").read_text(encoding="utf-8"))
    known = set(list(cat.get("romance_18") or []) + list(cat.get("roster_neutral") or []))
    ok = miss = skip = 0

    for src in sorted(args.src_dir.glob("avatar_*.png")):
        m = EMOTION_RE.match(src.name)
        if not m:
            continue
        cid, emotion = m.group(1).lower(), (m.group(2) or "").lower()
        if cid not in known:
            print(f"skip unknown id {src.name}")
            skip += 1
            continue
        if args.emotions_only and not emotion:
            continue
        if emotion in ("", "neutral"):
            dest_name = "avatar.png"
        else:
            dest_name = f"avatar_{emotion}.png"
        kind = cast_kind(cid, cat)
        dest = ROOT / "data" / "sprites" / kind / cid / dest_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        out = key_and_square(src)
        out.save(dest, format="PNG", optimize=True)
        a0 = (np.asarray(out)[:, :, 3] == 0).mean() * 100
        print(f"wrote {kind}/{cid}/{dest_name} a0%={a0:.1f}")
        ok += 1

    if ok == 0 and miss == 0:
        # legacy path: check listed ids for base avatars only
        for cid in known:
            src = args.src_dir / f"avatar_{cid}.png"
            if not src.is_file():
                continue
            if args.emotions_only:
                continue
            kind = cast_kind(cid, cat)
            dest = ROOT / "data" / "sprites" / kind / cid / "avatar.png"
            dest.parent.mkdir(parents=True, exist_ok=True)
            out = key_and_square(src)
            out.save(dest, format="PNG", optimize=True)
            print(f"wrote {kind}/{cid}/avatar.png")
            ok += 1

    print(f"done ok={ok} skip={skip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
