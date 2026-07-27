"""P11 smoke: errands + smart memory LLM gate."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import get_settings  # noqa: E402
from app.errands import (  # noqa: E402
    complete_errand,
    maybe_assign_errand,
    public_active_errand,
)
from app.life_briefs import soft_choices_for_agenda, today_suggestions  # noqa: E402
from app.memory_llm import should_extract_memories_llm  # noqa: E402
from app.scene_agenda import SceneAgenda, build_scene_agenda  # noqa: E402
from app.world_engine import end_day, hub_public  # noqa: E402
from app.world_store import WorldErrand, create_world_save  # noqa: E402


def main() -> None:
    settings = get_settings()
    assert settings.companion_memory_llm_enabled is True
    assert not should_extract_memories_llm(settings, user_text="嗯", turn_n=5)
    assert should_extract_memories_llm(settings, user_text="今天公司那边还顺利吗", turn_n=1)
    assert should_extract_memories_llm(settings, user_text="其实我有点想和你多走走", turn_n=3)
    assert not should_extract_memories_llm(settings, user_text="其实我有点想和你多走走", turn_n=4)

    save = create_world_save(user_id="smoke_p11", protagonist_name="测试")
    # Force assign by injecting pending errand
    romance = next(cid for cid, b in save.bonds.items() if b.cast_kind == "romance")
    save.bonds[romance].relationship_state.affinity = 50
    save.errands = [
        WorldErrand(
            id="t1",
            errand_id="pickup_parcel",
            character_id=romance,
            label="帮她取个快递",
            location_id="store",
            day_assigned=save.calendar.day_index,
            status="pending",
            ask_line="拜托你取快递",
        )
    ]
    pub = public_active_errand(save)
    assert pub and pub["label"]
    sug = today_suggestions(save)
    assert any(s.get("kind") == "errand" for s in sug), sug

    agenda = build_scene_agenda(save, character_id=romance, bond=save.bonds[romance])
    assert agenda.source == "errand", agenda
    soft = soft_choices_for_agenda(agenda)
    assert soft and any("办" in c or "帮" in c or "记着" in c for c in soft), soft

    # complete at wrong place
    save.location_id = "home"
    save2, bad = complete_errand(save)
    assert not bad.get("ok")

    save2.location_id = "store"
    save2.action_points = 5
    save3, ok = complete_errand(save2)
    assert ok.get("ok"), ok
    assert public_active_errand(save3) is None

    # end_day assign path does not crash
    save4 = create_world_save(user_id="smoke_p11b", protagonist_name="测试")
    for b in save4.bonds.values():
        if b.cast_kind == "romance":
            b.relationship_state.affinity = 55
    save4, _ = end_day(save4)
    hub = hub_public(save4)
    assert "life_actions" in hub

    # maybe_assign may or may not hit; force call
    save5 = create_world_save(user_id="smoke_p11c", protagonist_name="测试")
    for b in save5.bonds.values():
        if b.cast_kind == "romance":
            b.relationship_state.affinity = 60
    # try several days until assigned or give up
    assigned = False
    for _ in range(8):
        save5 = maybe_assign_errand(save5)
        if public_active_errand(save5):
            assigned = True
            break
        save5.calendar.day_index += 1
    # deterministic seed may assign; either way function must be stable
    _ = assigned

    print("smoke-p11-errands: OK")
    print(f"  memory_llm_smart=on soft={soft}")
    print(f"  complete={ok.get('impression')}")


if __name__ == "__main__":
    main()
