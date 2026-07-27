"""Inject bust_visual into every body_catalog character from bust_cm."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from body_catalog_lib import BODY_CATALOG_PATH, derive_bust_visual  # noqa: E402


def main() -> None:
    data = json.loads(BODY_CATALOG_PATH.read_text(encoding="utf-8"))
    chars = data.get("characters") or {}
    for cid, row in chars.items():
        if not isinstance(row, dict):
            continue
        row["bust_visual"] = derive_bust_visual(row)
    # aili：与基图中等偏丰一致，显式钉死
    if "aili" in chars:
        chars["aili"]["bust_visual"] = "medium"
        chars["aili"]["bust_cm"] = 86
    data["characters"] = chars
    BODY_CATALOG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"updated bust_visual for {len(chars)} characters")


if __name__ == "__main__":
    main()
