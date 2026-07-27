"""Smoke: WorldFacts 注入 + 中立禁恋约束仍在 system prompt。"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.character import CharacterProfile, build_system_prompt  # noqa: E402
from app.prompt_budget import PromptBlock, trim_blocks, WORLD_EXTRA_BUDGET  # noqa: E402
from app.relationship import RelationshipState  # noqa: E402
from app.session_store import Session  # noqa: E402
from app.world_facts import build_world_facts_block  # noqa: E402
from app.world_store import create_world_save, upsert_world_save  # noqa: E402


def fail(msg: str) -> None:
    print(f"FAIL {msg}")
    raise SystemExit(1)


def main() -> None:
    block = build_world_facts_block(
        day_index=1,
        period_label="下午",
        season_label="夏",
        location_label="咖啡店",
        weather_line="偏热",
        stage_label="认识中",
        is_weekly_focus=True,
        cast_kind="romance",
    )
    if "【世界事实｜只读】" not in block:
        fail("missing world facts header")
    if "季节：夏季" not in block:
        fail(f"season not in facts: {block}")
    if "禁止编造" not in block:
        fail("missing hard ban")
    if "咖啡店" not in block:
        fail("location missing")

    # trim must keep world_facts
    kept = trim_blocks(
        [
            PromptBlock("agenda", "【议程】x"),
            PromptBlock("world_facts", block),
            PromptBlock("rumors", "【传闻】" + ("瓜" * 2000)),
        ],
        budget=WORLD_EXTRA_BUDGET,
    )
    if "【世界事实｜只读】" not in kept:
        fail("world_facts dropped by trim")

    save = create_world_save(user_id="smoke-worldfacts", protagonist_name="测")
    upsert_world_save(save)

    romance_id = next(c for c, b in save.bonds.items() if b.cast_kind == "romance")
    rb = save.bonds[romance_id]
    r_session = Session(
        id="wf-r",
        profile=CharacterProfile.model_validate(rb.profile),
        system_prompt="base",
        relationship_state=RelationshipState.model_validate(rb.relationship_state),
        world_save_id=save.save_id,
        active_character_id=romance_id,
    )
    r_session.rebuild_prompt(user_text="今天天气怎么样")
    if "【世界事实｜只读】" not in r_session.system_prompt:
        fail("romance prompt missing world facts")
    if "季节：" not in r_session.system_prompt:
        fail("romance prompt missing season fact")

    neutral_id = next(c for c, b in save.bonds.items() if b.cast_kind == "neutral")
    nb = save.bonds[neutral_id]
    n_profile = CharacterProfile.model_validate(nb.profile)
    n_session = Session(
        id="wf-n",
        profile=n_profile,
        system_prompt="base",
        relationship_state=RelationshipState.model_validate(nb.relationship_state),
        world_save_id=save.save_id,
        active_character_id=neutral_id,
    )
    n_session.rebuild_prompt(user_text="我们在一起好不好")
    if "【世界事实｜只读】" not in n_session.system_prompt:
        fail("neutral prompt missing world facts")
    # 中立禁恋：identity 块或人设 human rules
    neutral_ban = (
        "禁止恋爱" in n_session.system_prompt
        or "绝不发展恋爱" in n_session.system_prompt
        or "中立线" in n_session.system_prompt
    )
    if not neutral_ban:
        # build_system_prompt 本体也应带禁恋
        base = build_system_prompt(
            n_profile,
            relationship_state=RelationshipState.model_validate(nb.relationship_state),
        )
        if "绝不发展恋爱" not in base and "禁止暧昧" not in base:
            fail("neutral romance ban missing")
    else:
        pass

    print("OK world_facts inject + neutral ban")
    print(f"  romance_id={romance_id} facts_ok")
    print(f"  neutral_id={neutral_id} ban_ok")


if __name__ == "__main__":
    main()
