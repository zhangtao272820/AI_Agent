"""Fetch / refresh Companion BGM: VN-leaning CC0 instrumentals from OpenGameArt.

Replaces weak slots and adds variation tracks (hub/talk/date/rain).
Usage:
  python scripts/fetch_bgm_vn_pack.py           # all
  python scripts/fetch_bgm_vn_pack.py title_theme hub_day
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "bgm"
UA = {"User-Agent": "Mozilla/5.0 CompanionAgentBgm/2.0"}
BASE = "https://opengameart.org/sites/default/files/"

# slot -> ordered candidate filenames under sites/default/files/
TARGETS: dict[str, list[str]] = {
    # Title / opening — piano, hopeful
    "title_theme": ["PianoTheme_0.mp3", "PianoTheme.mp3", "HerVioletEyes.mp3"],
    "opening_prologue": ["daisy.mp3", "Daisy.mp3", "Oceanside_0.mp3"],
    # Hub day/night + period variants
    "hub_day": ["Quaint%20Town%20-%20LOOPABLE.mp3", "Quaint%20Town.mp3", "TownTheme.mp3"],
    "hub_morning": ["TOWN%202.mp3", "TownTheme.mp3", "Quaint%20Town%20-%20LOOPABLE.mp3"],
    "hub_evening": ["Soliloquy_1.mp3", "Soliloquy.mp3", "Countryside_0.mp3"],
    "hub_night": ["Soliloquy_1.mp3", "blue_rain_0.mp3", "Early%20Rain_0.mp3"],
    # Locations
    "loc_cafe": ["coffee_0.mp3", "Cat%20caffe_0.mp3", "A%20cup%20of%20tea_0.mp3"],
    "loc_office": ["Oriented_0.ogg", "Oriented.ogg", "Oriented_0.mp3"],
    "loc_campus": ["TownTheme.mp3", "TOWN%202.mp3", "Quaint%20Town%20-%20LOOPABLE.mp3"],
    "loc_home": ["Florist_0.mp3", "Oceanside_0.mp3", "Countryside_0.mp3"],
    "loc_rain": ["blue_rain_0.mp3", "Early%20Rain_0.mp3", "Rainy%20Forest_0.mp3"],
    "loc_store": ["Bartender_0.mp3", "Fingersnap%20bar_0.mp3", "Cat%20caffe_0.mp3"],
    "loc_library": ["song21_0.mp3", "song21.mp3", "Mysterious%20Ambience.mp3"],
    "loc_festival": ["liyan.mp3", "Market%20theme%201_0.mp3", "Market%20theme%201.mp3"],
    "loc_forest": [
        "Views%20From%20Atop%20the%20Jade%20Kings%20Throne.mp3",
        "RPG%20-%20Misty%20Mountains.mp3",
        "Rainy%20Forest_0.mp3",
    ],
    "loc_park": ["Countryside_0.mp3", "Oceanside_0.mp3", "Florist_0.mp3"],
    # Dialogue / date moods
    "talk_soft": ["A%20cup%20of%20tea_0.mp3", "Cue.mp3", "Florist_0.mp3"],
    "talk_warm": ["Oceanside_0.mp3", "HerVioletEyes.mp3", "daisy.mp3"],
    "talk_tense": ["Oriented_0.ogg", "Early%20Rain_0.mp3", "blue_rain_0.mp3"],
    "date_soft": ["HerVioletEyes.mp3", "Oceanside_0.mp3", "PianoTheme_0.mp3"],
    "date_night": ["Soliloquy_1.mp3", "blue_rain_0.mp3", "Bartender_0.mp3"],
    "rain_night": ["Early%20Rain_0.mp3", "blue_rain_0.mp3", "Rainy%20Forest_0.mp3"],
    # Endings
    "ending_true": ["HerVioletEyes.mp3", "PianoTheme_0.mp3", "Oceanside_0.mp3"],
    "ending_good": ["Oceanside_0.mp3", "daisy.mp3", "TOWN%202.mp3"],
    "ending_soft": ["Countryside_0.mp3", "Florist_0.mp3", "A%20cup%20of%20tea_0.mp3"],
    "ending_bad": ["Early%20Rain_0.mp3", "Early%20Rain.mp3", "blue_rain_0.mp3"],
}


def fetch_one(slot: str, fname: str) -> Path:
    ext = ".ogg" if fname.lower().endswith(".ogg") else ".mp3"
    dest = OUT / f"{slot}{ext}"
    for old in OUT.glob(f"{slot}.*"):
        if old.suffix.lower() in {".mp3", ".ogg", ".wav"} and old != dest:
            old.unlink(missing_ok=True)
    url = BASE + fname
    print(f"GET {slot} <- {fname}", flush=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as resp:
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
        last_err: Exception | None = None
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
