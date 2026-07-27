#!/usr/bin/env python3
"""P12 smoke: 跨角色预约冲突、故事幕软线索、同场氛围、Judge hybrid 默认。"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.appointments import fulfill_appointment, schedule_appointment  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.game_judge import JudgeResult, judge_turn  # noqa: E402
from app.life_friction import story_soft_hints  # noqa: E402
from app.living_sim import apply_end_day_living  # noqa: E402
from app.scene_agenda import build_scene_agenda  # noqa: E402
from app.social_life import apply_end_day_copresence_notes, public_copresence_note  # noqa: E402
from app.world_engine import hub_public  # noqa: E402
from app.world_store import create_world_save  # noqa: E402
from app.character import CharacterProfile  # noqa: E402
from app.relationship import RelationshipState  # noqa: E402


def main() -> int:
    errors: list[str] = []

    # --- Judge 默认 hybrid ---
    get_settings.cache_clear()
    settings = get_settings()
    if settings.companion_judge_mode != "hybrid":
        errors.append(f"companion_judge_mode 应为 hybrid，实际 {settings.companion_judge_mode!r}")

    # hybrid：LLM 失败应回退 rules
    profile = CharacterProfile(
        character_id="linxi",
        name="林汐",
        cast_role="romance",
    )
    state = RelationshipState(stage_id="dating", stage_label="交往中", affinity=70, trust=70)
    with patch("app.game_judge._llm_judge", return_value=None):
        result = judge_turn(
            settings,
            user_text="我喜欢你，想和你在一起",
            assistant_text="……真的吗？",
            state=state,
            profile=profile,
            mode="hybrid",
        )
    if not isinstance(result, JudgeResult):
        errors.append("hybrid 回退未返回 JudgeResult")
    elif result.relation_move != "confess":
        errors.append(f"hybrid 回退应判 confess，得到 {result.relation_move!r}")

    # --- 跨角色同时段冲突 ---
    save = create_world_save(user_id="smoke_p12", protagonist_name="测试")
    romance = [cid for cid, b in save.bonds.items() if b.cast_kind == "romance"]
    if len(romance) < 2:
        errors.append("需要至少 2 个 romance 角色")
        _fail(errors)
        return 1
    a, b = romance[0], romance[1]
    day = save.calendar.day_index
    save, r1 = schedule_appointment(
        save,
        character_id=a,
        date_id="date_cafe",
        label="咖啡小坐",
        location_id="cafe",
        target_day=day,
        target_period="evening",
    )
    if not r1.get("ok"):
        errors.append(f"第一次预约失败: {r1}")
    save, r2 = schedule_appointment(
        save,
        character_id=b,
        date_id="date_cafe",
        label="傍晚散步",
        location_id="cafe",
        target_day=day,
        target_period="evening",
    )
    if not r2.get("ok"):
        errors.append(f"冲突预约应允许: {r2}")
    elif not r2.get("conflict"):
        errors.append("第二次同晚预约应带 conflict")
    else:
        conf = r2["conflict"]
        if conf.get("other_id") != a:
            errors.append(f"conflict.other_id 应为 {a}，得 {conf}")
    flags_a = save.bonds[a].relationship_state.flags or {}
    flags_b = save.bonds[b].relationship_state.flags or {}
    if not flags_a.get("schedule_clash_pending") or not flags_b.get("schedule_clash_pending"):
        errors.append("双方应有 schedule_clash_pending")

    # 赴约一方 → 另一方 stood_aside
    save.calendar.period = "evening"
    save.location_id = "cafe"
    ap_b = next(
        x
        for x in save.appointments
        if x.character_id == b and x.status == "pending" and x.period == "evening"
    )
    save, fr = fulfill_appointment(save, appointment_id=ap_b.id)
    if not fr.get("ok"):
        errors.append(f"赴约失败: {fr}")
    else:
        flags_a2 = save.bonds[a].relationship_state.flags or {}
        if not flags_a2.get("schedule_clash_stood_aside"):
            errors.append("未赴约方应有 schedule_clash_stood_aside")
        agenda = build_scene_agenda(save, character_id=a, bond=save.bonds[a])
        if agenda.source != "rivalry":
            errors.append(f"被晾方议程应为 rivalry，得 {agenda.source}")

    # --- 故事幕软线索（书璃） ---
    shuli_hints: list[dict] = []
    save2 = create_world_save(user_id="smoke_p12_story", protagonist_name="测试")
    if "shuli" not in save2.bonds:
        errors.append("缺 shuli")
    else:
        bond = save2.bonds["shuli"]
        bond.relationship_state.affinity = 55
        bond.relationship_state.stage_id = "friend"
        bond.relationship_state.stage_label = "朋友"
        fl = dict(bond.relationship_state.flags or {})
        fl.pop("sibling_talk_done", None)
        bond.relationship_state = bond.relationship_state.model_copy(update={"flags": fl})
        save2.bonds["shuli"] = bond
        hints = story_soft_hints(save2, limit=5)
        shuli_hints = [h for h in hints if h.get("character_id") == "shuli"]
        if not shuli_hints:
            errors.append(f"书璃应有故事软线索，得 {hints}")
        else:
            text = shuli_hints[0]["text"]
            if "sibling_talk_done" in text:
                errors.append("故事线索泄了 flag 名")
            if "晚饭" not in text and "家里" not in text:
                errors.append(f"书璃线索应提到晚饭/家人: {text}")
        hub = hub_public(save2)
        if "story_hints" not in hub:
            errors.append("hub 缺 story_hints")
        elif not isinstance(hub["story_hints"], list):
            errors.append("story_hints 应为 list")

    # --- 同场氛围 ---
    note = ""
    save3 = create_world_save(user_id="smoke_p12_co", protagonist_name="测试")
    save3.location_id = "cafe"
    romance3 = [cid for cid, b in save3.bonds.items() if b.cast_kind == "romance"][:2]
    note = public_copresence_note(save3, present_ids=romance3)
    if len(romance3) >= 2 and not note:
        errors.append("两人同场应有 copresence_note")
    hub3 = hub_public(save3)
    if "copresence_note" not in hub3:
        errors.append("hub 缺 copresence_note 字段")

    save3.calendar.day_index = 2
    save3 = apply_end_day_copresence_notes(save3)
    save3.calendar.day_index = 3
    try:
        apply_end_day_living(save3)
    except Exception as e:  # noqa: BLE001
        errors.append(f"end_day living 失败: {e}")

    # Settings() 裸默认
    bare = Settings()
    if bare.companion_judge_mode != "hybrid":
        errors.append(f"Settings() 默认应为 hybrid，得 {bare.companion_judge_mode!r}")

    if errors:
        _fail(errors)
        return 1
    print("smoke-p12-vision-gaps OK")
    print(f"  judge_mode={settings.companion_judge_mode}")
    print(f"  conflict={r2.get('conflict')}")
    print(f"  story_hint={shuli_hints[0]['text'] if shuli_hints else ''}")
    print(f"  copresence={note}")
    return 0


def _fail(errors: list[str]) -> None:
    print("smoke-p12-vision-gaps FAILED:")
    for e in errors:
        print(f"  - {e}")


if __name__ == "__main__":
    raise SystemExit(main())
