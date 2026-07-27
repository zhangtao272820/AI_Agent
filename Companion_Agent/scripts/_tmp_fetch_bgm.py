"""Fetch remaining unique CC0 BGM slots (flush + timeout)."""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "bgm"
BASE = "https://opengameart.org/sites/default/files/"

# Expected sizes from HEAD probes (approx) — skip if already matching
TARGETS = {
    "title_theme": ("025_A_New_Town.mp3", 766291),
    "opening_prologue": ("Countryside.mp3", 2216563),
    "hub_day": ("TOWN%201.mp3", 3200521),
    "hub_night": ("night_time.mp3", 4784030),
    "loc_cafe": ("Cat%20caffe.mp3", 2748984),
    "loc_office": ("Cue.mp3", 3020681),
    "loc_home": ("Florist.mp3", 2716234),
    "loc_rain": ("Morning%20rain.mp3", 1541350),
    "loc_store": ("Bartender.mp3", 5924279),
    "loc_library": ("song21.mp3", 466283),
    "loc_festival": ("Market%20theme%201.mp3", 1600782),
    "loc_forest": ("Rainy%20Forest.mp3", 2393360),
    "talk_soft": ("A%20cup%20of%20tea.mp3", 3377068),
    "ending_true": ("Oceanside.mp3", 2466712),
    "ending_good": ("TOWN%202.mp3", 2987362),
    "ending_soft": ("blue_rain.mp3", 2159079),
    "ending_bad": ("Early%20Rain.mp3", 5152436),
}


def fetch(slot: str, fname: str, expected: int) -> None:
    dest = OUT / f"{slot}.mp3"
    if dest.exists() and abs(dest.stat().st_size - expected) < 2000:
        print(f"SKIP {slot} already {dest.stat().st_size}", flush=True)
        return
    url = BASE + fname
    print(f"GET {slot} ...", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "CompanionAgentBgm/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    dest.write_bytes(data)
    print(f"OK {slot} {len(data)}", flush=True)


def main() -> None:
    only = sys.argv[1:] if len(sys.argv) > 1 else list(TARGETS)
    for slot in only:
        fname, expected = TARGETS[slot]
        try:
            fetch(slot, fname, expected)
        except Exception as e:
            print(f"FAIL {slot}: {e}", flush=True)


if __name__ == "__main__":
    main()
