"""Fetch remaining BGM slots with fallbacks + short timeout."""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "bgm"
UA = {"User-Agent": "Mozilla/5.0 CompanionAgentBgm/1.3"}
BASE = "https://opengameart.org/sites/default/files/"

# slot -> list of candidate filenames (try in order)
TARGETS: dict[str, list[str]] = {
    "loc_store": ["Bartender_0.mp3", "Cat%20caffe_0.mp3", "Fingersnap%20bar_0.mp3"],
    "loc_library": ["song21_0.mp3", "song21.mp3"],
    "loc_festival": ["liyan.mp3", "Market%20theme%201_0.mp3", "Market%20theme%201.mp3"],
    "loc_forest": [
        "Views%20From%20Atop%20the%20Jade%20Kings%20Throne.mp3",
        "RPG%20-%20Misty%20Mountains.mp3",
        "Rainy%20Forest_0.mp3",
    ],
    "talk_soft": ["A%20cup%20of%20tea_0.mp3", "A%20cup%20of%20tea.mp3"],
    "ending_true": ["HerVioletEyes.mp3", "Oceanside_0.mp3"],
    "ending_good": ["Oceanside_0.mp3", "TOWN%202.mp3"],
    "ending_soft": ["Countryside_0.mp3", "blue_rain_0.mp3"],
    "ending_bad": ["Early%20Rain_0.mp3", "Early%20Rain.mp3"],
}


def fetch_one(slot: str, fname: str) -> Path:
    ext = ".ogg" if fname.lower().endswith(".ogg") else ".mp3"
    dest = OUT / f"{slot}{ext}"
    for old in OUT.glob(f"{slot}.*"):
        if old != dest:
            old.unlink(missing_ok=True)
    url = BASE + fname
    print(f"GET {slot} <- {fname}", flush=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) < 40_000:
        raise RuntimeError(f"too small {len(data)}")
    dest.write_bytes(data)
    print(f"OK {slot} {len(data)} -> {dest.name}", flush=True)
    return dest


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    slots = sys.argv[1:] or list(TARGETS)
    ok = 0
    for slot in slots:
        cands = TARGETS.get(slot)
        if not cands:
            print(f"SKIP unknown {slot}", flush=True)
            continue
        last_err = None
        for fname in cands:
            try:
                fetch_one(slot, fname)
                ok += 1
                last_err = None
                break
            except Exception as e:
                last_err = e
                print(f"  retry {slot}: {e}", flush=True)
        if last_err:
            print(f"FAIL {slot}: {last_err}", flush=True)
    print(f"done {ok}/{len(slots)}", flush=True)


if __name__ == "__main__":
    main()
