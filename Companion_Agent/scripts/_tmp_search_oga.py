"""Search OGA for oriental / chinese / visual-novel music and list mp3 links."""
from __future__ import annotations

import re
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 CompanionAgentBgm/1.1"}
QUERIES = [
    "oriental",
    "chinese",
    "asia piano",
    "visual novel",
    "cafe piano",
    "romantic piano",
    "guzheng",
    "erhu",
]


def search(q: str) -> list[str]:
    url = (
        "https://opengameart.org/art-search-advanced?"
        + urllib.parse.urlencode(
            {
                "keys": q,
                "field_art_type_tid[]": "12",
                "sort_by": "count",
                "sort_order": "DESC",
            }
        )
    )
    req = urllib.request.Request(url, headers=UA)
    html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
    hrefs = re.findall(r'href="(/content/[^"]+)"', html)
    out = []
    for h in hrefs:
        if h.startswith("/content/"):
            full = "https://opengameart.org" + h
            if full not in out:
                out.append(full)
    return out[:8]


def files_for(page: str) -> list[str]:
    req = urllib.request.Request(page, headers=UA)
    html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
    return list(
        dict.fromkeys(
            re.findall(
                r'href="(https://opengameart\.org/sites/default/files/[^"]+\.(?:mp3|ogg))"',
                html,
            )
        )
    )


def main() -> None:
    seen_pages: set[str] = set()
    for q in QUERIES:
        print(f"\n=== {q} ===")
        try:
            pages = search(q)
        except Exception as e:
            print("search FAIL", e)
            continue
        for p in pages:
            if p in seen_pages:
                continue
            seen_pages.add(p)
            try:
                files = files_for(p)
            except Exception as e:
                print(p, "FAIL", e)
                continue
            if not files:
                continue
            print(p)
            for f in files[:3]:
                print(" ", f)


if __name__ == "__main__":
    main()
