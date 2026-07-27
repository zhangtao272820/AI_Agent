#!/usr/bin/env python3
"""P13 smoke: story chance=1, secret filter, witness, late_night brief."""

from __future__ import annotations

import random
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.event_engine import load_events, pick_active_event  # noqa: E402
from app.life_briefs import (  # noqa: E402
    note_night_chat,
    protagonist_day_brief_line,
    reset_day_brief_on_end_day,
    soft_choices_for_agenda,
    today_suggestions,
)
from app.memory import MemoryFact, memory_prompt_block, select_memories_for_prompt  # noqa: E402
from app.relationship import RelationshipState  # noqa: E402
from app.scene_agenda import SceneAgenda, build_scene_agenda  # noqa: E402
from app.social_life import apply_witness_memories  # noqa: E402
from app.life_friction import story_soft_hints  # noqa: E402
from app.world_engine import hub_public  # noqa: E402
from app.world_store import create_world_save  # noqa: E402


def main() -> int:
    errors: list[str] = []

    # --- story_ 事件 chance 强制 1 ---
    story_ev = [e for e in load_events() if (e.id or "").startswith("story_")]
    if not story_ev:
        errors.append("无 story_ 事件")
    else:
        bad = [e.id for e in story_ev if float(e.chance) < 1.0]
        if bad[:3]:
            errors.append(f"YAML chance 未重生为 1.0: {bad[:3]}")

    save = create_world_save(user_id="smoke_p13", protagonist_name="测试")
    if "shuli" in save.bonds:
        bond = save.bonds["shuli"]
        bond.relationship_state.affinity = 55
        bond.relationship_state.stage_id = "friend"
        bond.relationship_state.trust = 60
        fl = dict(bond.relationship_state.flags or {})
        fl.pop("sibling_talk_done", None)
        # 清 once 完成旗
        fl = {k: v for k, v in fl.items() if not str(k).startswith("event_done:")}
        bond.relationship_state = bond.relationship_state.model_copy(update={"flags": fl})
        save.bonds["shuli"] = bond
        # 即使 random 全 miss，story_ 也应命中
        with patch("app.event_engine.random.random", return_value=0.99):
            ev = pick_active_event(
                state=bond.relationship_state,
                character_id="shuli",
                day_index=save.calendar.day_index,
            )
        if not ev or not (ev.id or "").startswith("story_shuli"):
            errors.append(f"书璃条件满足应必出 story 事件，得 {ev.id if ev else None}")

    # --- hub / story_hints ---
    if "shuli" in save.bonds:
        hub = hub_public(save)
        if "story_hints" not in hub:
            errors.append("hub 缺 story_hints")
        hints_all = story_soft_hints(save, limit=30)
        sh = [h for h in hints_all if h.get("character_id") == "shuli"]
        if not sh:
            errors.append(f"书璃应有 story_hints，得 {hints_all[:3]}")
        elif "sibling_talk_done" in sh[0].get("text", ""):
            errors.append("故事线索泄了 flag 名")
        elif "晚饭" not in sh[0]["text"] and "家里" not in sh[0]["text"]:
            errors.append(f"书璃线索应提晚饭/家人: {sh[0]['text']}")

    # --- secret 过滤 ---
    mems = [
        MemoryFact(text="普通记忆：喜欢咖啡", source="user", tags=["preference"]),
        MemoryFact(text="秘密：他其实有别的约会", source="system", tags=["secret"]),
    ]
    low = select_memories_for_prompt(mems, trust=40, flags={})
    if any("secret" in (m.tags or []) for m in low):
        errors.append("低信任不应带出 secret 记忆")
    if not any("普通" in m.text for m in low):
        errors.append("低信任应保留非 secret 记忆")
    high = select_memories_for_prompt(mems, trust=75, flags={})
    if not any("secret" in (m.tags or []) for m in high):
        errors.append("高信任应允许 secret")
    disclosed = select_memories_for_prompt(mems, trust=40, flags={"secret_disclosed": True})
    if not any("secret" in (m.tags or []) for m in disclosed):
        errors.append("secret_disclosed 应允许 secret")
    block = memory_prompt_block(mems, trust=30, flags={})
    if "别的约会" in block:
        errors.append("memory_prompt_block 低信任泄密")

    # --- witness ---
    save2 = create_world_save(user_id="smoke_p13_w", protagonist_name="测试")
    romance = [cid for cid, b in save2.bonds.items() if b.cast_kind == "romance"]
    # 找一对有边的
    from app.social_graph import load_social_graph

    graph = load_social_graph()
    pair = None
    for e in graph.edges:
        if e.a in save2.bonds and e.b in save2.bonds:
            pair = (e.a, e.b)
            break
    if not pair:
        errors.append("无社交边可测 witness")
    else:
        a, b = pair
        save2.location_id = "cafe"
        save2 = apply_witness_memories(save2, talking_id=a, present_ids=[a, b])
        wb = save2.bonds[b]
        wit = [m for m in wb.memories if "witness" in (m.tags or [])]
        if not wit:
            errors.append("旁观者应有 witness 记忆")
        # 同日第二次不重复
        save2 = apply_witness_memories(save2, talking_id=a, present_ids=[a, b])
        wit2 = [m for m in save2.bonds[b].memories if "witness" in (m.tags or [])]
        if len(wit2) > 1:
            errors.append("同日 witness 应最多 1 条")

    # --- ensemble 软选项 ---
    soft = soft_choices_for_agenda(SceneAgenda(source="ensemble", goal="同场", hook="旁边有人"))
    if len(soft) < 2:
        errors.append(f"ensemble 软选项不足: {soft}")

    # --- late_night ---
    save3 = create_world_save(user_id="smoke_p13_n", protagonist_name="测试")
    save3.calendar.period = "night"
    for _ in range(3):
        note_night_chat(save3)
    if save3.protagonist.night_chat_turns < 3:
        errors.append("夜聊计数未累加")
    # 翻日
    save3.calendar.day_index += 1
    save3.calendar.period = "morning"
    reset_day_brief_on_end_day(save3)
    if save3.protagonist.late_night_brief_day != save3.calendar.day_index:
        errors.append(
            f"日终应标记 late_night_brief_day={save3.calendar.day_index}，"
            f"得 {save3.protagonist.late_night_brief_day}"
        )
    brief = protagonist_day_brief_line(save3)
    if "聊到很晚" not in brief and "昨晚" not in brief:
        errors.append(f"次日简报应提昨晚夜聊: {brief}")
    sug = today_suggestions(save3)
    if not any(s.get("kind") == "rest" or "聊太晚" in (s.get("text") or "") for s in sug):
        errors.append(f"今日建议应含夜聊提示: {sug}")

    # ensemble agenda（有 present + edge）
    if pair:
        save4 = create_world_save(user_id="smoke_p13_e", protagonist_name="测试")
        a, b = pair
        bond_a = save4.bonds[a]
        ag = build_scene_agenda(
            save4,
            character_id=a,
            bond=bond_a,
            present_ids=[a, b],
        )
        # 可能被更高优议程压过；至少 soft_choices 对 ensemble 有条目
        if ag.source == "ensemble" and not soft_choices_for_agenda(ag):
            errors.append("ensemble 议程缺软选项")

    if errors:
        print("smoke-p13-advancement FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("smoke-p13-advancement OK")
    print(f"  story_events={len(story_ev)}")
    print(f"  brief={brief[:40]}...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
