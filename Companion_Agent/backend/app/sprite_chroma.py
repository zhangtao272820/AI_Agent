"""Near-black keying for VN sprites generated on solid black backgrounds.

Stock PNGs stay on disk unchanged; API serves keyed RGBA with disk+memory cache.

Only edge-connected near-black is keyed (flood from borders). Interior black
clothing (e.g. all-black outfits) is preserved. Images that already have alpha
are left untouched.
"""

from __future__ import annotations

import hashlib
import io
import threading
from collections import OrderedDict, deque
from pathlib import Path

import numpy as np
from PIL import Image

# Conservative: only near-pure black becomes transparent.
_BLACK_THRESHOLD = 12
_SOFT_BAND = 8  # pixels just above threshold get partial alpha
_CACHE_VERSION = "v2edge"  # bump when keying algorithm changes
_MEM_MAX = 64
_mem_lock = threading.Lock()
_mem: OrderedDict[str, bytes] = OrderedDict()


def _cache_dir() -> Path:
    root = Path(__file__).resolve().parents[2] / "data" / "sprites" / "_chroma_cache"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _cache_key(src: Path) -> str:
    st = src.stat()
    raw = f"{_CACHE_VERSION}|{src.resolve()}|{st.st_mtime_ns}|{st.st_size}|{_BLACK_THRESHOLD}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def _key_black_rgba(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.asarray(rgba).copy()
    # Authored transparency (new GenerateImage RGBA) — do not re-key.
    if int(arr[:, :, 3].min()) < 250:
        return Image.fromarray(arr, "RGBA")

    mx = arr[:, :, :3].max(axis=2)
    thr = _BLACK_THRESHOLD
    soft = thr + _SOFT_BAND
    candidate = mx <= soft
    h, w = candidate.shape

    # Flood-fill near-black from image borders only → background matte.
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


def keyed_png_bytes(src: Path) -> bytes | None:
    """Return PNG bytes with near-black keyed out, or None if src missing."""
    if not src or not src.is_file():
        return None
    key = _cache_key(src)
    with _mem_lock:
        hit = _mem.get(key)
        if hit is not None:
            _mem.move_to_end(key)
            return hit

    disk = _cache_dir() / f"{key}.png"
    if disk.is_file():
        data = disk.read_bytes()
        with _mem_lock:
            _mem[key] = data
            while len(_mem) > _MEM_MAX:
                _mem.popitem(last=False)
        return data

    with Image.open(src) as im:
        out = _key_black_rgba(im)
        buf = io.BytesIO()
        out.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()

    try:
        disk.write_bytes(data)
    except OSError:
        pass

    with _mem_lock:
        _mem[key] = data
        while len(_mem) > _MEM_MAX:
            _mem.popitem(last=False)
    return data
