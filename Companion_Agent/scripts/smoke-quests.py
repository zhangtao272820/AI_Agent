#!/usr/bin/env python3
"""Smoke: quest 链加载与匹配。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.quest_engine import load_quest_chains, pick_quest_chain, public_quest_state  # noqa: E402
from app.relationship import RelationshipState  # noqa: E402
from app.save_store import GameRuntime  # noqa: E402


def main() -> int:
    errors: list[str] = []
    chains = load_quest_chains()
    if len(chains) < 3:
        errors.append(f"quests 至少 3 条链，实际 {len(chains)}")

    prog = pick_quest_chain(character_id="shizuku", base_id="gentle_lover", growth_mode="progressive")
    if not prog or prog.id != "quest_progressive_love":
        errors.append("shizuku 应匹配 quest_progressive_love")

    fixed = pick_quest_chain(character_id="qingcai", base_id="cheerful_sun", growth_mode="fixed")
    if not fixed or fixed.id != "quest_dating_fixed":
        errors.append("qingcai 应匹配 quest_dating_fixed")

    campus = pick_quest_chain(character_id="xiaoyang", base_id="cheerful_sun", growth_mode="progressive")
    if not campus or campus.id != "quest_cheerful_campus":
        errors.append("xiaoyang 应匹配 quest_cheerful_campus")

    wife = pick_quest_chain(character_id="xiaoyou", base_id="gentle_lover", growth_mode="fixed")
    if not wife or wife.id != "quest_wife_daily":
        errors.append("xiaoyou 应匹配 quest_wife_daily")

    state = public_quest_state(
        character_id="shizuku",
        base_id="gentle_lover",
        growth_mode="progressive",
        state=RelationshipState(stage_id="stranger", affinity=5),
        runtime=GameRuntime(),
    )
    if not state.get("active_step"):
        errors.append("progressive 线应有 active_step")

    if errors:
        print("FAIL smoke-quests")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK smoke-quests: {len(chains)} chains")
    return 0


if __name__ == "__main__":
    sys.exit(main())
