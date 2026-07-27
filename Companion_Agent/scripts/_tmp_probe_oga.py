"""Probe OGA pages for audio file URLs."""
from __future__ import annotations

import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 CompanionAgentBgm/1.1"}
PAGES = [
    ("yoiyami", "https://opengameart.org/content/yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano"),
    ("quaint", "https://opengameart.org/content/quaint-town"),
    ("bar", "https://opengameart.org/content/indoor-bar-piano"),
    ("lofi", "https://opengameart.org/content/lofi-compilation"),
    ("newtown", "https://opengameart.org/content/a-new-town-rpg-theme"),
    ("town1", "https://opengameart.org/content/town-theme-1"),
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
            for f in files[:8]:
                print(" ", f)
        except Exception as e:
            print(f"{name} FAIL {e}")


if __name__ == "__main__":
    main()
