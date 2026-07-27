#!/usr/bin/env python3
"""Smoke: archetype max_stage 与 route_catalog 一致（romance 最高可妻子）。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load_json(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


STAGE_RANK = {
    "stranger": 0,
    "acquaintance": 1,
    "friend": 2,
    "close_friend": 3,
    "crush": 4,
    "dating": 5,
    "married": 6,
}


def stage_rank(stage_id: str) -> int:
    return STAGE_RANK.get(stage_id, -1)


def main() -> int:
    caps = load_json("archetype_caps.json").get("caps") or {}
    routes = load_json("route_catalog.json").get("routes") or []
    endings = {e["id"]: e for e in load_json("endings.json").get("endings") or []}
    social = load_json("social_graph.json").get("characters") or {}

    errors: list[str] = []

    if len(caps) != 6:
        errors.append(f"archetype_caps 应有 6 项，实际 {len(caps)}")

    # SSOT：恋爱线 archetype 最高 married；中立/NPC 由 cast_role 封顶 close_friend
    expected = {
        "gentle_lover": "married",
        "tsundere": "married",
        "cheerful_sun": "married",
        "sarcastic_lover": "married",
        "mature_sister": "married",
        "fantasy_spirit": "married",
    }
    for base_id, want in expected.items():
        got = caps.get(base_id)
        if got != want:
            errors.append(f"archetype {base_id}: max_stage 期望 {want}，实际 {got}")

    by_base: dict[str, list[dict]] = {}
    for row in routes:
        bid = row.get("base_id") or ""
        by_base.setdefault(bid, []).append(row)

    for base_id in expected:
        if base_id not in by_base:
            errors.append(f"route_catalog 缺少 archetype {base_id} 的角色")
            continue
        cap = caps.get(base_id)
        cap_rank = stage_rank(cap or "")
        for route in by_base[base_id]:
            cid = route.get("character_id", "?")
            max_stage = route.get("max_stage_id")
            growth = route.get("growth_mode", "fixed")
            cast_role = route.get("cast_role") or "romance"
            max_rank = stage_rank(max_stage or "")

            if cast_role in {"neutral", "npc"}:
                if max_stage != "close_friend":
                    errors.append(f"{cid} {cast_role} max_stage 应为 close_friend，实际 {max_stage}")
                continue

            if growth == "progressive" and max_rank > cap_rank:
                errors.append(
                    f"{cid} progressive max_stage={max_stage} 超过 archetype {base_id} 封顶 {cap}"
                )
            if cast_role == "romance" and max_stage != "married":
                errors.append(f"{cid} romance max_stage 应为 married，实际 {max_stage}")

            for eid in route.get("allowed_endings") or []:
                if eid not in endings:
                    errors.append(f"{cid} 引用未知结局 {eid}")

            # social_graph cast_kind vs route cast_role
            sk = (social.get(cid) or {}).get("cast_kind")
            if sk and sk != cast_role:
                errors.append(f"{cid} cast_kind={sk} vs route.cast_role={cast_role}")

    if errors:
        print("FAIL smoke-max-stage-caps")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("OK smoke-max-stage-caps: romance→married, neutral/npc→close_friend")
    return 0


if __name__ == "__main__":
    sys.exit(main())
