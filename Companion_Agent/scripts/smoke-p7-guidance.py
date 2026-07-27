"""P7 smoke: hub compass, day briefs, soft choices, invite/cold/weather/ending."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.appointments import date_slots_public, resolve_when_slot  # noqa: E402
from app.life_briefs import (  # noqa: E402
    note_spend,
    note_travel,
    protagonist_day_brief_line,
    soft_choices_for_agenda,
    today_suggestions,
)
from app.life_friction import (  # noqa: E402
    apply_missed_soft_cold,
    ending_soft_hints,
    is_soft_cold,
    note_date_spend_friction,
    public_weather,
    weather_kind,
)
from app.living_sim import craft_pending_ping  # noqa: E402
from app.romance_policy import get_romance_policy  # noqa: E402
from app.scene_agenda import SceneAgenda, build_scene_agenda  # noqa: E402
from app.world_engine import hub_public, list_available_dates  # noqa: E402
from app.world_store import create_world_save  # noqa: E402


def main() -> None:
    save = create_world_save(user_id="smoke_p7", protagonist_name="测试")
    hub = hub_public(save)
    assert "weekly_focus" in hub, "hub missing weekly_focus"
    assert "today_suggestions" in hub, "hub missing today_suggestions"
    assert "weather" in hub and hub["weather"].get("kind"), hub.get("weather")
    assert "ending_hints" in hub
    assert isinstance(hub["today_suggestions"], list)
    assert len(hub["today_suggestions"]) <= 3
    sug = today_suggestions(save)
    assert len(sug) <= 3
    assert weather_kind(save.calendar.day_index) in {"rain", "fair", "hot", "cold"}
    assert public_weather(save)["label"]

    note_travel(save)
    note_travel(save)
    note_spend(save, 100)
    save.protagonist.worked_day_index = save.calendar.day_index
    brief = protagonist_day_brief_line(save)
    assert "跑了好几个地方" in brief or "花得有点猛" in brief or "上过班" in brief, brief

    soft = soft_choices_for_agenda(
        SceneAgenda(goal="确认约定", hook="有约", source="appointment")
    )
    assert 2 <= len(soft) <= 3, soft
    assert soft_choices_for_agenda(SceneAgenda(source="chat", goal="闲聊")) == []
    cold_soft = soft_choices_for_agenda(SceneAgenda(source="cold", goal="缓和", hook="冷淡"))
    assert any("抱歉" in c or "还好吗" in c for c in cold_soft), cold_soft

    lunch = resolve_when_slot(save, "lunch")
    assert lunch and lunch[1] == "afternoon", lunch
    slots = date_slots_public(save)
    assert any(s.get("id") == "lunch" for s in slots), slots

    # invite path: pick a pursues + confess_init romance
    invite_cid = None
    for cid, b in save.bonds.items():
        if b.cast_kind != "romance":
            continue
        pol = get_romance_policy(cid)
        if pol.confess_init and pol.pursuit == "pursues":
            invite_cid = cid
            break
    assert invite_cid, "need at least one pursues romance for invite smoke"
    bond = save.bonds[invite_cid]
    bond.relationship_state.affinity = 80
    kinds = set()
    for _ in range(60):
        _, kind = craft_pending_ping(bond)
        kinds.add(kind)
    assert "invite" in kinds or "soft" in kinds, kinds

    drama_cid = None
    for cid, b in save.bonds.items():
        if b.cast_kind != "romance":
            continue
        if get_romance_policy(cid).rivalry == "interfere":
            drama_cid = cid
            break
    if drama_cid:
        db = save.bonds[drama_cid]
        db.relationship_state.affinity = 80
        for _ in range(60):
            _, kind = craft_pending_ping(db)
            kinds.add(kind)

    # soft cold after miss → date list soft-reject + agenda
    bond = apply_missed_soft_cold(bond, until_day=save.calendar.day_index + 6)
    save.bonds[invite_cid] = bond
    assert is_soft_cold(bond, save.calendar.day_index)
    dates = list_available_dates(save, invite_cid)
    assert dates and any("不太想见你" in (d.get("reject_reason") or "") for d in dates), dates
    agenda = build_scene_agenda(save, character_id=invite_cid, bond=save.bonds[invite_cid])
    assert agenda and agenda.source == "cold", agenda

    # stingy date streak → spend agenda after 2 cheap dates
    save.protagonist.stingy_date_streak = 0
    # clear cold so spend can surface (cold takes precedence)
    bond.living.soft_cold_until_day = 0
    save.bonds[invite_cid] = bond
    save = note_date_spend_friction(save, invite_cid, money_spent=10)
    save = note_date_spend_friction(save, invite_cid, money_spent=10)
    assert save.protagonist.stingy_date_streak >= 2
    assert (save.bonds[invite_cid].relationship_state.flags or {}).get("feel_stingy_dates")
    spend_agenda = build_scene_agenda(save, character_id=invite_cid, bond=save.bonds[invite_cid])
    assert spend_agenda and spend_agenda.source == "spend", spend_agenda

    # ending soft hints (no ending name leak)
    romance = next(cid for cid, b in save.bonds.items() if b.cast_kind == "romance")
    rb = save.bonds[romance]
    rb.relationship_state.affinity = 75
    rb.relationship_state.stage_id = "crush"
    save.bonds[romance] = rb
    hints = ending_soft_hints(save)
    assert hints, hints
    assert "气氛" in hints[0]["text"] or "越来越熟" in hints[0]["text"] or "更近了" in hints[0]["text"]
    assert not any(x in hints[0]["text"] for x in ("ending_", "flag")), hints[0]
    # partner near-ending path
    rb.relationship_state.affinity = 80
    rb.relationship_state.stage_id = "dating"
    flags = dict(rb.relationship_state.flags or {})
    flags["partner_confirmed"] = True
    rb.relationship_state = rb.relationship_state.model_copy(update={"flags": flags})
    save.bonds[romance] = rb
    near = ending_soft_hints(save)
    assert near and "更近了" in near[0]["text"], near
    hub2 = hub_public(save)
    assert isinstance(hub2.get("ending_hints"), list)

    print("smoke-p7-guidance: OK")
    print(f"  weekly_focus={len(hub['weekly_focus'])} suggestions={len(hub['today_suggestions'])}")
    print(f"  weather={hub['weather']} lunch={lunch}")
    print(f"  brief={brief.strip()[:60]}")
    print(f"  soft={soft}")
    print(f"  ping_kinds_seen={sorted(kinds)}")
    print(f"  ending_hints={hub2.get('ending_hints')}")


if __name__ == "__main__":
    main()
