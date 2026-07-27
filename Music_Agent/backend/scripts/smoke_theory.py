#!/usr/bin/env python3
"""Phase 2 乐理工具冒烟：compose 产物 → analyze → harmonize → export-score。"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:13110").rstrip("/")


def _post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    health = _get("/api/health")
    assert health.get("enable_music_theory") is not False, health
    cat = _get("/api/music/theory/catalog")
    tools = cat.get("tools") or []
    assert len(tools) >= 5, cat

    # 用 compose 生成一个短 MIDI（若 async 可用）
    try:
        job = _post("/api/music/compose/async", {"prompt": "smoke 8 bar calm piano C major 20 seconds"})
        job_id = job.get("job_id")
        if not job_id:
            print("skip compose: no job_id", job)
            return 0
        import time

        midi_name = None
        for _ in range(60):
            st = _get(f"/api/jobs/{job_id}")
            if st.get("status") == "done":
                res = st.get("result") or {}
                url = str(res.get("midi_url") or "")
                midi_name = Path(url).name if url else None
                break
            if st.get("status") == "failed":
                print("compose failed", st)
                return 1
            time.sleep(2)
        if not midi_name:
            print("timeout waiting compose")
            return 1
    except urllib.error.HTTPError as ex:
        print("compose async unavailable", ex)
        return 0

    analyze = _post("/api/music/analyze", {"saved_filename": midi_name})
    assert analyze.get("ok"), analyze
    assert analyze.get("summary_zh"), analyze
    print("analyze ok:", analyze.get("summary_zh")[:80])

    harm = _post("/api/music/harmonize", {"saved_filename": midi_name, "harmony_style": "pop"})
    assert harm.get("ok"), harm
    assert harm.get("midi_url"), harm
    harm_name = Path(str(harm["midi_url"])).name
    print("harmonize ok:", harm.get("summary_zh"))

    exp = _post("/api/music/export-score", {"saved_filename": harm_name})
    assert exp.get("ok"), exp
    assert exp.get("urls"), exp
    print("export ok:", exp.get("urls"))
    print("smoke_theory OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
