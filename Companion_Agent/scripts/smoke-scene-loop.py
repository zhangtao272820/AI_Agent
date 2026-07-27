"""Smoke: SceneRun 场次边界 — 回合耗尽、告辞结算、日接触上限、end_day。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.game_judge import JudgeResult  # noqa: E402
from app.scene_run import (  # noqa: E402
    can_start_scene,
    compute_settlement,
    daily_scene_limit,
    new_scene_run,
    note_scene_started,
    pool_turn_deltas,
    scene_turn_budget,
    tick_scene_turn,
)
from app.session_store import store  # noqa: E402
from app.world_engine import end_day, load_date_catalog  # noqa: E402
from app.world_store import create_world_save, get_world_save, upsert_world_save  # noqa: E402


def _romance_id(save) -> str:
    for cid, b in save.bonds.items():
        if b.cast_kind == "romance":
            return cid
    raise AssertionError("need a romance bond")


def main() -> None:
    # 冒烟不烧 aux / 记忆模型（patch session_store 内已绑定的符号）
    import app.session_store as ss

    ss.should_extract_memories_llm = lambda *a, **k: False  # type: ignore
    ss.SessionStore.maybe_summarize = lambda self, sid: False  # type: ignore

    cat = load_date_catalog()
    assert cat.scene_talk_turns >= 2, cat.scene_talk_turns
    assert daily_scene_limit() >= 1
    talk_budget = scene_turn_budget("talk")
    assert talk_budget == int(cat.scene_talk_turns)

    save = create_world_save(user_id="smoke_scene_loop", protagonist_name="测试")
    cid = _romance_id(save)
    day = int(save.calendar.day_index)
    bond = save.bonds[cid]

    # --- 日上限：连续 note 直至拒绝 ---
    limit = daily_scene_limit()
    for i in range(limit):
        ok, err = can_start_scene(bond, day, counts_toward_limit=True)
        assert ok, f"slot {i}: {err}"
        bond = note_scene_started(bond, day, counts_toward_limit=True)
    ok, err = can_start_scene(bond, day, counts_toward_limit=True)
    assert not ok and err, "daily limit should block"
    save.bonds[cid] = bond
    upsert_world_save(save)

    # ping 不计入上限
    ok_ping, _ = can_start_scene(bond, day, counts_toward_limit=False)
    assert ok_ping

    # 新档用于场次结算（重置计数）
    save2 = create_world_save(user_id="smoke_scene_loop2", protagonist_name="测试")
    cid2 = _romance_id(save2)
    aff0 = int(save2.bonds[cid2].relationship_state.affinity)
    bond2 = save2.bonds[cid2]
    bond2 = note_scene_started(bond2, save2.calendar.day_index, counts_toward_limit=True)
    save2.bonds[cid2] = bond2
    upsert_world_save(save2)

    session = store.create_world_talk(
        world_save_id=save2.save_id, character_id=cid2, scene_mode="talk"
    )
    assert session and session.scene_run, "scene_run missing on create"
    assert session.scene_run["turns_left"] == talk_budget
    assert session.scene_run["mode"] == "talk"

    # 场内 Judge 进池，不立刻改 affinity
    for i in range(talk_budget - 1):
        out = store.after_turn(
            session.id,
            user_text=f"你好呀第{i+1}句",
            assistant_text="嗯，我也在。",
            judge=JudgeResult(affinity_delta=3, trust_delta=1, on_agenda=True),
        )
        assert out is not None
        assert not out.get("scene_ended"), f"ended too early at turn {i+1}"
        assert out.get("affinity_delta", 0) == 0
        assert int(session.relationship_state.affinity) == aff0
        left = (out.get("scene_run") or {}).get("turns_left")
        assert left == talk_budget - (i + 1), (left, i)

    # 最后一轮 → 自动结算
    out_end = store.after_turn(
        session.id,
        user_text="最后一句，再见啦",
        assistant_text="好，下次再聊。",
        judge=JudgeResult(affinity_delta=4, trust_delta=2, on_agenda=True),
    )
    assert out_end and out_end.get("scene_ended") is True, out_end
    assert out_end.get("end_reason") == "turns_exhausted"
    assert out_end.get("closing_line")
    world_after = get_world_save(save2.save_id)
    assert world_after
    aff1 = int(world_after.bonds[cid2].relationship_state.affinity)
    assert aff1 > aff0, (aff0, aff1, out_end.get("affinity_delta"))
    assert session.scene_run.get("ended") is True

    # 已结束后 prepare 应拒绝
    prep = store.prepare_turn(session.id, "再聊一句")
    assert prep and prep.get("error"), prep

    # --- 告辞路径 ---
    save3 = create_world_save(user_id="smoke_scene_farewell", protagonist_name="测试")
    cid3 = _romance_id(save3)
    bond3 = note_scene_started(save3.bonds[cid3], save3.calendar.day_index, counts_toward_limit=True)
    save3.bonds[cid3] = bond3
    upsert_world_save(save3)
    sess3 = store.create_world_talk(
        world_save_id=save3.save_id, character_id=cid3, scene_mode="talk"
    )
    assert sess3
    store.after_turn(
        sess3.id,
        user_text="今天天气不错",
        assistant_text="是啊。",
        judge=JudgeResult(affinity_delta=5, trust_delta=2, on_agenda=True),
    )
    left = store.leave_scene(sess3.id, reason="farewell")
    assert left and left.get("ok") is not False, left
    assert left.get("end_reason") == "farewell"
    assert left.get("closing_line")
    assert (left.get("scene_run") or {}).get("ended") is True
    w3 = get_world_save(save3.save_id)
    assert w3
    assert int(w3.bonds[cid3].relationship_state.affinity) >= int(
        bond3.relationship_state.affinity
    )

    # --- compute_settlement 单元 ---
    run = new_scene_run(mode="talk", character_id="x", day_index=1)
    run = pool_turn_deltas(run, affinity_delta=20, trust_delta=10, mood_delta=4, on_agenda=True)
    run = pool_turn_deltas(run, affinity_delta=20, trust_delta=10, mood_delta=4, on_agenda=False)
    aff, trust, mood, note = compute_settlement(run)
    assert abs(aff) <= cat.scene_settle_affinity_cap
    assert abs(trust) <= cat.scene_settle_trust_cap
    assert note

    # tick 到零
    run2 = new_scene_run(mode="talk", character_id="y", day_index=1)
    run2.turns_max = 2
    run2.turns_left = 2
    run2 = tick_scene_turn(run2)
    assert run2.turns_left == 1
    run2 = tick_scene_turn(run2)
    assert run2.turns_left == 0

    # --- end_day 仍可用 ---
    save4 = create_world_save(user_id="smoke_scene_endday", protagonist_name="测试")
    d0 = save4.calendar.day_index
    save4, day_res = end_day(save4)
    assert day_res.get("ok")
    assert save4.calendar.day_index == d0 + 1
    assert save4.calendar.period == "morning"

    print(
        f"ok scene_loop talk_budget={talk_budget} daily_limit={limit} "
        f"settle_aff={aff} farewell+end_day ok"
    )
    assert talk_budget == 4, talk_budget


if __name__ == "__main__":
    main()
