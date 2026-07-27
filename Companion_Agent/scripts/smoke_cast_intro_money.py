"""Smoke: cast intro gate + presence cap + tier hard gates + money0."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.cast_weights import (  # noqa: E402
    cast_tier,
    intro_week_for,
    is_cast_introduced,
    load_cast_intro,
    pick_weekly_focus_ids,
    presence_cap_for_day,
    reload_cast_weights,
)
from app.economy import date_money_cost, gift_money_cost, meal_money_cost  # noqa: E402
from app.world_engine import period_presence_map, who_is_here  # noqa: E402
from app.world_store import create_world_save  # noqa: E402


def fail(msg: str) -> None:
    print(f"FAIL {msg}")
    raise SystemExit(1)


def main() -> None:
    reload_cast_weights()
    intro = load_cast_intro()
    core = set(intro.week1_core or [])
    if len(core) < 3:
        fail("week1_core too small")
    for cid in core:
        if intro_week_for(cid) != 1:
            fail(f"{cid} should be intro_week 1")
        if cast_tier(cid) != "T0":
            fail(f"week1_core {cid} must be T0, got {cast_tier(cid)}")
        if cast_tier(cid) == "T2":
            fail(f"week1_core must not include T2 ({cid})")

    # late characters
    for cid in ("aili", "miara", "aichen", "xingnai", "luna"):
        if intro_week_for(cid) < 5:
            fail(f"{cid} should unlock mid/late (>=5)")

    # band gaps: T2 weekly_focus / presence within 2–4
    for cid, w in reload_cast_weights().characters.items():
        if w.tier == "T2":
            if not (2 <= w.presence <= 4 and 2 <= w.weekly_focus <= 4):
                fail(f"T2 {cid} presence/focus out of band")
        if w.tier == "T0":
            if w.presence < 7 or w.weekly_focus < 8:
                fail(f"T0 {cid} presence/focus below band")

    if gift_money_cost(99) != 0 or date_money_cost(80) != 0 or meal_money_cost(20) != 0:
        fail("money costs should be 0")

    save = create_world_save(user_id="smoke-intro", protagonist_name="测")
    save.calendar.day_index = 1
    save.calendar.period = "afternoon"

    # Day1: only week1 pool introduced
    for cid in core:
        if not is_cast_introduced(save, cid):
            fail(f"day1 core {cid} should be introduced")
    if is_cast_introduced(save, "aili"):
        fail("day1 aili should NOT be introduced")
    if is_cast_introduced(save, "xingnai"):
        fail("day1 xingnai (T2) should NOT be introduced")

    present_all = period_presence_map(save)
    cap = presence_cap_for_day(1)
    if len(present_all) > cap:
        fail(f"presence {len(present_all)} > cap {cap}")
    for cid in present_all:
        if intro_week_for(cid) > 1:
            fail(f"day1 unexpected face {cid}")

    # Sample locations still subset of map
    for loc in ("home", "cafe", "office"):
        here = who_is_here(save, loc)
        for cid in here:
            if cid not in present_all:
                fail(f"{cid} at {loc} not in period map")

    # Weekly focus hard gate: never N or T2
    romance_ids = [
        cid for cid, b in save.bonds.items() if getattr(b, "cast_kind", "") == "romance"
    ]
    for week in (1, 5, 12):
        focus = pick_weekly_focus_ids(romance_ids, week_index=week, count=2)
        for cid in focus:
            t = cast_tier(cid)
            if t in ("N", "T2"):
                fail(f"week {week} focus must not include {t} ({cid})")
            if t not in ("T0", "T1"):
                fail(f"week {week} focus unexpected tier {t} ({cid})")

    # Week 5: late cast unlocked
    save.calendar.day_index = 35  # week 5
    if not is_cast_introduced(save, "aili"):
        fail("week5 aili should be introduced")
    present_late = period_presence_map(save)
    if len(present_late) > presence_cap_for_day(35):
        fail("week5 presence over cap")

    # pages in presentation
    from app.presentation import resolve_ending_presentation

    pages = resolve_ending_presentation(
        "ending_xiaoyou_frame_true", ending_type="secret", character_id="xiaoyou"
    ).get("pages") or []
    if len(pages) < 2:
        fail("xiaoyou true ending should have multi-page narration")

    print("OK cast_intro + tier_gates + money0 + ending_pages")
    print(f"  week1_core={sorted(core)} tiers={[cast_tier(c) for c in sorted(core)]}")
    print(f"  day1 present={sorted(present_all)} cap={cap}")
    print(f"  week5 present_n={len(present_late)}")
    print(f"  sample focus w5={pick_weekly_focus_ids(romance_ids, week_index=5, count=2)}")


if __name__ == "__main__":
    main()
