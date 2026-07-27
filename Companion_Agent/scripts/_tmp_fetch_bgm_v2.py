"""Replace Companion BGM with louder, more GAL/oriental CC0 tracks from OpenGameArt."""
from __future__ import annotations

import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "bgm"
UA = {"User-Agent": "Mozilla/5.0 CompanionAgentBgm/1.2"}

# slot -> (url filename under sites/default/files/, source page note)
TARGETS: dict[str, tuple[str, str]] = {
    # 标题 / 序章：钢琴 · 情感 · 略东方氛围
    "title_theme": ("PianoTheme_0.mp3", "https://opengameart.org/content/piano-theme"),
    "opening_prologue": ("daisy.mp3", "https://opengameart.org/content/daisy"),
    # Hub
    "hub_day": ("Quaint%20Town%20-%20LOOPABLE.mp3", "https://opengameart.org/content/quaint-town"),
    "hub_night": ("Soliloquy_1.mp3", "https://opengameart.org/content/soliloquy"),
    # 地点
    "loc_cafe": ("coffee_0.mp3", "https://opengameart.org/content/caf%C3%A9"),
    "loc_office": ("Oriented_0.ogg", "https://opengameart.org/content/oriented"),
    "loc_campus": ("TownTheme.mp3", "https://opengameart.org/content/town-theme-rpg"),
    "loc_home": ("Florist_0.mp3", "https://opengameart.org/content/lofi-compilation"),
    "loc_rain": ("blue_rain_0.mp3", "https://opengameart.org/content/blue-rain"),
    "loc_store": ("Fingersnap%20bar_0.mp3", "https://opengameart.org/content/bar-jazz-piano-song-fingersnap"),
    "loc_library": ("song21_0.mp3", "https://opengameart.org/content/mysterious-ambience-song21"),
    "loc_festival": ("liyan.mp3", "https://opengameart.org/content/liyan"),
    "loc_forest": (
        "Views%20From%20Atop%20the%20Jade%20Kings%20Throne.mp3",
        "https://opengameart.org/content/views-from-atop-the-jade-kings-throne",
    ),
    # 对话压低 / 结局
    "talk_soft": ("A%20cup%20of%20tea_0.mp3", "https://opengameart.org/content/lofi-compilation"),
    "ending_true": ("HerVioletEyes.mp3", "https://opengameart.org/content/her-violet-eyes"),
    "ending_good": ("Oceanside_0.mp3", "https://opengameart.org/content/lofi-compilation"),
    "ending_soft": ("Countryside_0.mp3", "https://opengameart.org/content/lofi-compilation"),
    "ending_bad": ("Early%20Rain_0.mp3", "https://opengameart.org/content/early-rain"),
}

BASE = "https://opengameart.org/sites/default/files/"


def fetch(slot: str, fname: str) -> Path:
    ext = ".ogg" if fname.lower().endswith(".ogg") else ".mp3"
    dest = OUT / f"{slot}{ext}"
    # 清掉同槽旧扩展名，避免双文件抢解析
    for old in OUT.glob(f"{slot}.*"):
        if old != dest:
            old.unlink(missing_ok=True)
    url = BASE + fname
    print(f"GET {slot} <- {fname}", flush=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = resp.read()
    if len(data) < 50_000:
        raise RuntimeError(f"too small: {len(data)}")
    dest.write_bytes(data)
    print(f"OK {slot} {len(data)} -> {dest.name}", flush=True)
    return dest


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    only = __import__("sys").argv[1:]
    slots = only or list(TARGETS)
    ok = 0
    for slot in slots:
        fname, _page = TARGETS[slot]
        try:
            fetch(slot, fname)
            ok += 1
        except Exception as e:
            print(f"FAIL {slot}: {e}", flush=True)
    print(f"done {ok}/{len(slots)}", flush=True)


if __name__ == "__main__":
    main()
