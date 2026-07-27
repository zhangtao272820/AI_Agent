#!/usr/bin/env python3
"""Generate solid-color placeholder BGs for key campus locations (stdlib only).

Real art should replace these files under data/bgs/. Placeholders unblock UI layering.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "bgs"

# location_id -> RGB
COLORS: dict[str, tuple[int, int, int]] = {
    "default": (42, 72, 68),
    "classroom": (88, 110, 98),
    "cafeteria": (120, 98, 72),
    "library": (72, 86, 108),
    "hallway": (96, 100, 92),
    "playground": (70, 118, 86),
    "rooftop": (110, 130, 150),
    "club_room": (108, 92, 110),
    "shop": (128, 108, 78),
    "dorm_gate": (86, 92, 98),
    "dorm_m1": (78, 88, 102),
    "dorm_m2": (74, 84, 98),
    "dorm_f1": (102, 88, 98),
    "dorm_f2": (98, 84, 96),
    "dorm_f3": (94, 80, 94),
    "dorm_f4": (90, 76, 92),
}

W, H = 1280, 720


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, rgb: tuple[int, int, int]) -> None:
    r, g, b = rgb
    raw = b"".join(b"\x00" + bytes([r, g, b]) * W for _ in range(H))
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw, 9)) + _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    written = 0
    skipped = 0
    for name, color in COLORS.items():
        path = OUT / f"{name}.png"
        if path.is_file() and path.stat().st_size > 200_000:
            # Likely a real asset — do not overwrite
            skipped += 1
            continue
        write_png(path, color)
        written += 1
        print("wrote", path.relative_to(ROOT))
    print(f"done: wrote={written} skipped_large={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
