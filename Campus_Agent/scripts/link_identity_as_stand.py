#!/usr/bin/env python3
"""Copy `_identity_neutral.png` → `summer_stand_neutral.png` when stand is missing.

Engineering convenience for resource strategy Z — does not generate art.
  python scripts/link_identity_as_stand.py
  python scripts/link_identity_as_stand.py --dry-run
  python scripts/link_identity_as_stand.py --student f01
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites" / "students"


def main() -> int:
    parser = argparse.ArgumentParser(description="Link identity as summer_stand_neutral when missing")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--student", default="", help="Limit to one student id")
    args = parser.parse_args()

    if not SPRITES.is_dir():
        print(f"missing sprites root: {SPRITES}", file=sys.stderr)
        return 1

    dirs = sorted(p for p in SPRITES.iterdir() if p.is_dir())
    if args.student:
        dirs = [SPRITES / args.student]
        if not dirs[0].is_dir():
            print(f"student not found: {args.student}", file=sys.stderr)
            return 1

    copied = 0
    skipped = 0
    for d in dirs:
        stand = d / "summer_stand_neutral.png"
        identity = d / "_identity_neutral.png"
        if stand.is_file():
            skipped += 1
            continue
        if not identity.is_file():
            print(f"  [skip] {d.name}: no identity")
            skipped += 1
            continue
        if args.dry_run:
            print(f"  [dry] {d.name}: would copy identity → summer_stand_neutral.png")
            copied += 1
            continue
        shutil.copy2(identity, stand)
        print(f"  [ok] {d.name}: summer_stand_neutral.png")
        copied += 1

    print(f"done: linked={copied} skipped={skipped} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
