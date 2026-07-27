#!/usr/bin/env python3
"""Phase 3 冒烟：神经状态 + Demucs 可用性 + 乐理 catalog。"""
from __future__ import annotations

import json
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:13110").rstrip("/")


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    h = get("/api/health")
    assert h.get("ok") is True
    assert h.get("enable_demucs_stems") is not False
    print("health demucs_available", h.get("demucs_available"))

    ns = get("/api/music/neural-status")
    assert "engines" in ns or "neural_engine" in ns or ns.get("available") is not None
    print("neural", ns.get("active_engine") or ns.get("neural_engine"), ns.get("engines"))

    st = get("/api/music/stems/status")
    print("stems status", st)

    cat = get("/api/music/theory/catalog")
    ids = [t["id"] for t in cat.get("tools", [])]
    assert "music_stems" in ids
    print("catalog tools", len(ids))
    print("smoke_phase3 OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
