#!/usr/bin/env python3
"""Smoke: daily encounter 目录与 AP 刷新。"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.daily_encounter import (  # noqa: E402
    ap_max_from_catalog,
    list_encounters,
    public_encounter_catalog,
    refresh_daily_runtime,
)
from app.relationship import RelationshipState  # noqa: E402
from app.save_store import GameRuntime  # noqa: E402


def main() -> int:
    errors: list[str] = []
    encs = list_encounters()
    if len(encs) < 6:
        errors.append(f"daily_encounters 至少 6 项，实际 {len(encs)}")
    if ap_max_from_catalog() < 1:
        errors.append("ap_max 无效")

    runtime = refresh_daily_runtime(GameRuntime(action_points=0, last_play_date="2000-01-01"))
    if runtime.action_points != ap_max_from_catalog():
        errors.append("新日历日应重置 AP")
    if runtime.last_play_date != date.today().isoformat():
        errors.append("last_play_date 未更新为今天")

    catalog = public_encounter_catalog(
        character_id="qingcai",
        base_id="cheerful_sun",
        state=RelationshipState(stage_id="dating"),
    )
    if not catalog:
        errors.append("元气 dating 线应有可选日常")

    if errors:
        print("FAIL smoke-daily-encounters")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK smoke-daily-encounters: {len(encs)} encounters, ap_max={ap_max_from_catalog()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
