#!/usr/bin/env python3
"""Smoke：软选项 C 不因 index 单独掉好感（只走 Judge 文本语义）。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.character import CharacterProfile  # noqa: E402
from app.event_engine import ChoiceEffect, GameEvent, choice_effect_for_index  # noqa: E402
from app.game_judge import JudgeResult  # noqa: E402
from app.relationship import init_relationship_state  # noqa: E402
from app.session_store import Session, SessionStore  # noqa: E402


def _mk_session(*, kind: str, event: GameEvent | None = None) -> Session:
    profile = CharacterProfile(
        name="测测",
        character_id="xiaoyou",
        personality="测试",
        initial_affinity=40,
    )
    rel = init_relationship_state(profile, character_id="xiaoyou", base_id="gentle_lover")
    return Session(
        id="smoke_soft_choice",
        profile=profile,
        system_prompt="test",
        relationship_state=rel,
        pending_choices=["开场A", "开场B", "开场C"],
        pending_choice_kind=kind,
        pending_choice_event_id=event.id if event and kind == "branch" else None,
        active_event=event,
    )


def main() -> int:
    errors: list[str] = []

    # 1) 无事件 effects → 空效果（不再 index=2 扣信任）
    empty = choice_effect_for_index(None, 2)
    if empty.trust_delta != 0 or empty.affinity_delta != 0:
        errors.append(
            f"无事件时 index=2 应为空效果，实际 trust={empty.trust_delta} aff={empty.affinity_delta}"
        )

    store = SessionStore()

    # 2) soft + choice_index=2：不应叠加假支线扣分
    soft_sess = _mk_session(kind="soft")
    store._sessions[soft_sess.id] = soft_sess
    before_aff = soft_sess.relationship_state.affinity
    before_trust = soft_sess.relationship_state.trust
    # 固定 Judge 为 0，隔离 index 副作用
    zero = JudgeResult(affinity_delta=0, trust_delta=0, reason="smoke-zero")
    out = store.after_turn(
        soft_sess.id,
        user_text="开场C",
        assistant_text="嗯。",
        judge=zero,
        choice_index=2,
        parsed_choices=None,
    )
    if not out:
        errors.append("soft after_turn 返回空")
    else:
        after = store.get(soft_sess.id)
        assert after
        if after.relationship_state.affinity != before_aff:
            errors.append(
                f"soft 选项C 不应因 index 改好感：{before_aff}→{after.relationship_state.affinity}"
            )
        if after.relationship_state.trust != before_trust:
            errors.append(
                f"soft 选项C 不应因 index 改信任：{before_trust}→{after.relationship_state.trust}"
            )
        if after.pending_choice_kind != "soft":
            errors.append("回合后 pending_choice_kind 应为 soft")
        if not after.pending_choices or len(after.pending_choices) < 2:
            errors.append("回合后无 LLM【选项】时应系统补 soft choices（≥2）")

    # 3) branch + 有 effects：index=2 应吃到事件数值
    ev = GameEvent(
        id="evt_smoke_branch",
        label="测分支",
        choice_effects=[
            ChoiceEffect(affinity_delta=1, trust_delta=1),
            ChoiceEffect(),
            ChoiceEffect(affinity_delta=-1, trust_delta=-3),
        ],
    )
    branch_sess = _mk_session(kind="branch", event=ev)
    store._sessions[branch_sess.id] = branch_sess
    b_aff = branch_sess.relationship_state.affinity
    b_trust = branch_sess.relationship_state.trust
    out_b = store.after_turn(
        branch_sess.id,
        user_text="开场C",
        assistant_text="……",
        judge=JudgeResult(affinity_delta=0, trust_delta=0, reason="smoke-zero"),
        choice_index=2,
        parsed_choices=None,
    )
    if not out_b:
        errors.append("branch after_turn 返回空")
    else:
        after_b = store.get(branch_sess.id)
        assert after_b
        if after_b.relationship_state.affinity != b_aff - 1:
            errors.append(
                f"branch 选项C 应 affinity-1：期望 {b_aff - 1} 实际 {after_b.relationship_state.affinity}"
            )
        if after_b.relationship_state.trust != b_trust - 3:
            errors.append(
                f"branch 选项C 应 trust-3：期望 {b_trust - 3} 实际 {after_b.relationship_state.trust}"
            )

    # 4) 公开字段带 kind
    soft2 = _mk_session(kind="soft")
    pub = soft2.to_public()
    if pub.get("pending_choice_kind") != "soft":
        errors.append("to_public 应带 pending_choice_kind=soft")

    if errors:
        print("FAIL smoke-soft-choice-kind")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("OK smoke-soft-choice-kind: soft index 不扣分；branch 吃 choice_effects")
    return 0


if __name__ == "__main__":
    sys.exit(main())
