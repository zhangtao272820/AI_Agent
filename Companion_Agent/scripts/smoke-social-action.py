"""Smoke: 对话→世界动作（mock social_action，不调 LLM）。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.appointments import public_appointments, resolve_when_slot  # noqa: E402
from app.life_friction import is_soft_cold  # noqa: E402
from app.social_actions import SocialAction, apply_social_action, parse_social_action  # noqa: E402
from app.world_store import create_world_save  # noqa: E402


def _romance_id(save) -> str:
    for cid, b in save.bonds.items():
        if b.cast_kind == "romance":
            return cid
    raise AssertionError("need a romance bond")


def main() -> None:
    save = create_world_save(user_id="smoke_social", protagonist_name="测试")
    cid = _romance_id(save)
    bond = save.bonds[cid]
    # 放宽约会门槛，便于 schedule_date 挑到可用行程
    bond.relationship_state.affinity = 70
    bond.relationship_state.stage_id = "friend"
    save.bonds[cid] = bond

    tomorrow = resolve_when_slot(save, "tomorrow")
    assert tomorrow is not None, "tomorrow slot missing"
    assert tomorrow[0] == save.calendar.day_index + 1
    assert tomorrow[1] == "evening"

    tomorrow_morn = resolve_when_slot(save, "tomorrow", period_override="morning")
    assert tomorrow_morn == (save.calendar.day_index + 1, "morning")

    slots_ids = {s["id"] for s in __import__("app.appointments", fromlist=["date_slots_public"]).date_slots_public(save)}
    assert "tomorrow" in slots_ids, slots_ids

    # 非法 kind → parse None
    assert parse_social_action({"kind": "fly_to_moon"}) is None

    before_n = len([a for a in save.appointments if a.status == "pending"])
    save, bad = apply_social_action(
        save,
        character_id=cid,
        action=SocialAction(kind="schedule_date", when="next_year"),
    )
    # when 非法被剥掉后默认 tomorrow，仍可能成功；用明确失败路径：未知角色
    save2, bad2 = apply_social_action(
        save,
        character_id="__nobody__",
        action={"kind": "schedule_date", "when": "tomorrow"},
    )
    assert bad2.get("ok") is False and "认识" in str(bad2.get("error") or ""), bad2
    assert len([a for a in save2.appointments if a.status == "pending"]) == before_n

    save, r_date = apply_social_action(
        save,
        character_id=cid,
        action={
            "kind": "schedule_date",
            "when": "tomorrow",
            "period": "evening",
            "note": "明天傍晚见",
        },
    )
    assert r_date.get("ok") is True, r_date
    assert r_date.get("kind") == "schedule_date"
    pending = [a for a in save.appointments if a.status == "pending" and a.character_id == cid]
    assert pending, public_appointments(save)
    ap = pending[-1]
    assert ap.day_index == save.calendar.day_index + 1
    assert ap.period == "evening"
    assert ap.date_id, "date appointment needs date_id"
    assert (ap.kind or "date") == "date"

    save, r_talk = apply_social_action(
        save,
        character_id=cid,
        action={"kind": "schedule_talk", "when": "weekend", "location_id": "cafe", "note": "周末谈谈"},
    )
    assert r_talk.get("ok") is True, r_talk
    talks = [
        a
        for a in save.appointments
        if a.status == "pending" and a.character_id == cid and (a.kind == "talk" or not a.date_id)
    ]
    assert talks, "talk appointment missing"
    assert talks[-1].label == "谈话"

    save, r_q = apply_social_action(
        save,
        character_id=cid,
        action={"kind": "quarrel", "note": "吵起来了"},
    )
    assert r_q.get("ok") is True, r_q
    bond = save.bonds[cid]
    assert bond.relationship_state.flags.get("recent_quarrel")
    assert is_soft_cold(bond, save.calendar.day_index)
    assert r_q.get("agenda", {}).get("source") == "quarrel"

    save, r_cold = apply_social_action(
        save,
        character_id=cid,
        action={"kind": "start_cold", "note": "冷战开始"},
    )
    assert r_cold.get("ok") is True, r_cold
    bond = save.bonds[cid]
    assert bond.relationship_state.flags.get("cold_war_active")

    # 无正向 delta → 和解失败
    save, r_end_fail = apply_social_action(
        save,
        character_id=cid,
        action={"kind": "end_cold"},
        affinity_delta=0,
        trust_delta=0,
    )
    assert r_end_fail.get("ok") is False, r_end_fail

    save, r_end = apply_social_action(
        save,
        character_id=cid,
        action={"kind": "end_cold", "note": "和解了"},
        affinity_delta=2,
        trust_delta=1,
    )
    assert r_end.get("ok") is True, r_end
    bond = save.bonds[cid]
    assert not bond.relationship_state.flags.get("cold_war_active")
    assert int(bond.living.soft_cold_until_day or 0) == 0

    # now → deferred
    save, r_now = apply_social_action(
        save,
        character_id=cid,
        action={"kind": "schedule_date", "when": "now"},
    )
    assert r_now.get("ok") is True and r_now.get("deferred_now") is True, r_now
    assert r_now.get("ask_date", {}).get("character_id") == cid

    print("smoke-social-action: OK")


if __name__ == "__main__":
    main()
