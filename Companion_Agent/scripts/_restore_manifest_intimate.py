"""Thin wrapper: intimate/max restore is now part of build_sprite_gen_manifest.

Prefer: python scripts/build_sprite_gen_manifest.py
"""
from __future__ import annotations

from build_sprite_gen_manifest import main

if __name__ == "__main__":
    main()
