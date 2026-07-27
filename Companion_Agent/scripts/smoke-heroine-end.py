"""Smoke: 女主 end_scene、回合封顶 4、同日二次送礼拒、周拍罗盘。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.calendar_beats import current_week_beat, ensure_week_beat, public_week_beat  # noqa: E402
from app.game_judge import JudgeResult, judge_turn  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.gifts import buy_gift, load_gift_catalog  # noqa: E402
from app.scene_run import scene_turn_budget  # noqa: E402
from app.session_store import store  # noqa: E402
from app.world_engine import load_date_catalog  # noqa: E402
from app.world_store import create_world_save, upsert_world_save  # noqa: E402


def _romance_id(save) -> str:
    for cid, b in save.bonds.items():
        if b.cast_kind == "romance":
            return cid
    raise AssertionError("need romance")


def main() -> None:
    import app.session_store as ss

    ss.should_extract_memories_llm = lambda *a, **k: False  # type: ignore
    ss.SessionStore.maybe_summarize = lambda self, sid: False  # type: ignore

    cat = load_date_catalog()
    assert int(cat.scene_talk_turns) == 4, cat.scene_talk_turns
    assert scene_turn_budget("talk") == 4

    # --- 女主 end_scene 提前离场 ---
    save = create_world_save(user_id="smoke_heroine_end", protagonist_name="测试")
    cid = _romance_id(save)
    bond = save.bonds[cid]
    bond.living.fatigue = 80
    save.bonds[cid] = bond
    upsert_world_save(save)

    sess = store.create_world_talk(world_save_id=save.save_id, character_id=cid, scene_mode="talk")
    assert sess and sess.scene_run
    assert sess.scene_run["turns_max"] == 4

    out = store.after_turn(
        sess.id,
        user_text="你今天还好吗",
        assistant_text="还行……我有点事，先走了。",
        judge=JudgeResult(
            affinity_delta=2,
            trust_delta=1,
            on_agenda=True,
            end_scene=True,
            end_scene_reason="she_leaves",
        ),
    )
    assert out and out.get("scene_ended") is True, out
    assert out.get("end_reason") == "she_leaves"
    assert "走" in (out.get("closing_line") or "") or "告" in (out.get("closing_line") or "")

    # rules judge：turns_left 投影为 1 → 必结束
    settings = get_settings()
    v = judge_turn(
        settings,
        user_text="再聊一句",
        assistant_text="嗯。",
        state=sess.relationship_state,
        profile=sess.profile,
        mode="rules",
        agenda_goal="自然聊天",
        scene_ctx={"turns_left": 1, "fatigue": 0, "character_id": cid},
    )
    assert v.end_scene is True
    assert v.end_scene_reason in {"she_leaves", "busy", "awkward"}

    # --- 二次送礼拒 ---
    save2 = create_world_save(user_id="smoke_gift_daily", protagonist_name="测试")
    cid2 = _romance_id(save2)
    save2.location_id = "store"
    save2.action_points = 5
    save2.protagonist.money = 5000
    upsert_world_save(save2)
    gifts = load_gift_catalog().gifts
    assert gifts, "gift catalog empty"
    gid = gifts[0].id
    save2, r1 = buy_gift(save2, character_id=cid2, gift_id=gid)
    assert r1.get("ok") is True, r1
    save2, r2 = buy_gift(save2, character_id=cid2, gift_id=gid)
    assert r2.get("ok") is False, r2
    assert "今天已经送过" in str(r2.get("error") or "")

    # --- 周拍 ---
    save3 = create_world_save(user_id="smoke_week_beat", protagonist_name="测试")
    save3 = ensure_week_beat(save3)
    beat = public_week_beat(save3)
    assert beat.get("id") and beat.get("text")
    assert current_week_beat(save3.calendar.day_index)["id"] == beat["id"]
    # 幂等
    save3b = ensure_week_beat(save3)
    assert save3b.world_flags.get(
        f"week_beat:{(beat.get('week_index') or 1)}"
    ) or any(k.startswith("week_beat:") for k in save3b.world_flags)

    print(
        f"ok heroine_end talk_turns={cat.scene_talk_turns} "
        f"gift_block={r2.get('error')!r} week_beat={beat.get('id')}"
    )


if __name__ == "__main__":
    main()
