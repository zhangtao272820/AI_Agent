"""P10 smoke: girls night, decision echo, silence agenda, bedtime tip, festival/outfit."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.life_briefs import soft_choices_for_agenda, today_suggestions  # noqa: E402
from app.life_friction import (  # noqa: E402
    is_busy_tonight,
    is_structurally_cold_input,
    outfit_prompt_line,
)
from app.romance_policy import maybe_append_decision_echo  # noqa: E402
from app.scene_agenda import SceneAgenda, build_scene_agenda  # noqa: E402
from app.world_engine import absence_notes, advance_period, end_day, who_is_here  # noqa: E402
from app.world_store import create_world_save  # noqa: E402


def main() -> None:
    save = create_world_save(user_id="smoke_p10", protagonist_name="测试")

    # Force girls night on a romance bond
    romance = next(cid for cid, b in save.bonds.items() if b.cast_kind == "romance")
    bond = save.bonds[romance]
    bond.living.busy_tonight_day = save.calendar.day_index
    save.bonds[romance] = bond
    save.calendar.period = "evening"
    assert is_busy_tonight(bond, save.calendar.day_index, "evening")
    assert romance not in who_is_here(save)
    notes = absence_notes(save)
    assert any(n.get("character_id") == romance and "朋友" in (n.get("reason") or "") for n in notes), notes

    # Decision echo rumors (dedupe)
    maybe_append_decision_echo(save, about_id=romance, new_flags={"exclusive_accepted": True})
    maybe_append_decision_echo(save, about_id=romance, new_flags={"exclusive_accepted": True})
    exclusive_hits = [r for r in save.rumors if "认真起来了" in (r.text or "")]
    assert len(exclusive_hits) == 1, save.rumors
    maybe_append_decision_echo(save, about_id=romance, new_flags={"harem_accepted": True})
    assert any("不止一个人" in (r.text or "") for r in save.rumors)

    # Silence agenda
    assert is_structurally_cold_input("嗯")
    assert not is_structurally_cold_input("今天公司那边还顺利吗")
    silent = soft_choices_for_agenda(SceneAgenda(source="silence", goal="少话"))
    assert any("先走" in c or "聊吗" in c for c in silent), silent
    agenda = build_scene_agenda(
        save,
        character_id=romance,
        bond=save.bonds[romance],
        cold_input_streak=2,
    )
    # soft cold from busy? no — silence unless higher priority
    # clear soft cold / stingy / appointments
    save.bonds[romance].living.soft_cold_until_day = 0
    save.bonds[romance].relationship_state.flags = {}
    save.appointments = []
    agenda = build_scene_agenda(
        save,
        character_id=romance,
        bond=save.bonds[romance],
        cold_input_streak=2,
    )
    assert agenda.source == "silence", agenda

    fest = soft_choices_for_agenda(SceneAgenda(source="festival", goal="过节"))
    assert any("一起过" in c for c in fest) and any("各回各家" in c for c in fest), fest

    assert "雨" in outfit_prompt_line("rain") or "伞" in outfit_prompt_line("rain")
    assert outfit_prompt_line("casual") == ""

    # Bedtime suggestion
    save.calendar.period = "night"
    save.bonds[romance].living.pending_ping = "今晚还好吗"
    sug = today_suggestions(save)
    assert any(s.get("kind") == "bedtime" for s in sug), sug

    # end_day soft_tip when unread existed
    save2 = create_world_save(user_id="smoke_p10b", protagonist_name="测试")
    cid2 = next(c for c, b in save2.bonds.items() if b.cast_kind == "romance")
    save2.bonds[cid2].living.pending_ping = "还醒着吗"
    save2.bonds[cid2].living.pending_ping_kind = "soft"
    _, result = end_day(save2)
    assert result.get("soft_tip") and "回" in result["soft_tip"], result.get("soft_tip")

    # advance into evening rolls girls night without crash
    save3 = create_world_save(user_id="smoke_p10c", protagonist_name="测试")
    while save3.calendar.period != "afternoon":
        save3 = advance_period(save3, allow_day_roll=False)
    save3 = advance_period(save3, allow_day_roll=False)
    assert save3.calendar.period == "evening"

    print("smoke-p10-friction: OK")
    print(f"  girls_night blocked={romance}")
    print(f"  rumors={len(save.rumors)} silence={agenda.source}")
    print(f"  bedtime={[s['text'] for s in sug if s['kind']=='bedtime']}")
    print(f"  soft_tip={result.get('soft_tip')}")


if __name__ == "__main__":
    main()
