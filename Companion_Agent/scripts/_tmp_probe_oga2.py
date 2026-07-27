"""Probe more OGA / freepd pages for GAL-suitable CC0 tracks."""
from __future__ import annotations

import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 CompanionAgentBgm/1.1"}
PAGES = [
    ("night", "https://opengameart.org/content/towns-night-time-piano"),
    ("blue_rain", "https://opengameart.org/content/blue-rain"),
    ("early_rain", "https://opengameart.org/content/early-rain"),
    ("town_theme0", "https://opengameart.org/content/town-theme-0"),
    ("mysterious", "https://opengameart.org/content/mysterious-ambience-song21"),
    ("oriental1", "https://opengameart.org/content/oriental-flute-0"),
    ("asia", "https://opengameart.org/content/asian-dungeon"),
    ("calm_piano", "https://opengameart.org/content/calm-piano"),
    ("dreamy", "https://opengameart.org/content/dreamy-flashback"),
    ("romance", "https://opengameart.org/content/romantic"),
    ("vn_piano", "https://opengameart.org/content/piano-theme"),
    ("soft", "https://opengameart.org/content/soft-background-music"),
]


def main() -> None:
    for name, url in PAGES:
        try:
            req = urllib.request.Request(url, headers=UA)
            html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
            files = re.findall(
                r'href="(https://opengameart\.org/sites/default/files/[^"]+\.(?:mp3|ogg))"',
                html,
            )
            files = list(dict.fromkeys(files))
            print(f"{name} OK {len(files)}")
            for f in files[:5]:
                print(" ", f)
        except Exception as e:
            print(f"{name} FAIL {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
