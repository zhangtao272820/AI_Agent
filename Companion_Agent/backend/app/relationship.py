"""关系阶段、好感度、信任与养成逻辑。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .character import CharacterProfile
from .config import PROJECT_ROOT
from .route_catalog import effective_max_stage_id, effective_target_stage_id, get_route, route_prompt_block


class RelationshipState(BaseModel):
    stage_id: str = "dating"
    stage_label: str = "女朋友"
    affinity: int = Field(50, ge=0, le=100)
    trust: int = Field(70, ge=0, le=100)
    mood: int = Field(0, ge=-100, le=100)
    user_title: str = "亲爱的"
    growth_mode: str = Field("fixed", pattern="^(fixed|progressive)$")
    target_stage_id: str = "dating"
    max_stage_id: str = "dating"
    route_label: str = ""
    turns: int = 0
    flags: dict[str, bool] = Field(default_factory=dict)
    low_streak: int = 0
    active_ending_id: str | None = None


class StageDef(BaseModel):
    id: str
    label: str
    affinity_min: int
    user_title: str
    tone: str
    tts_hint: str


def _catalog_path() -> Path:
    return PROJECT_ROOT / "data" / "relationship_stages.json"


def load_relationship_catalog() -> dict[str, Any]:
    path = _catalog_path()
    if not path.is_file():
        return {"stages": [], "target_stage_map": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def list_stages() -> list[StageDef]:
    raw = load_relationship_catalog().get("stages") or []
    return [StageDef.model_validate(row) for row in raw]


def stage_index() -> dict[str, StageDef]:
    return {s.id: s for s in list_stages()}


def stage_order() -> list[str]:
    return [s.id for s in sorted(list_stages(), key=lambda s: s.affinity_min)]


def resolve_target_stage_id(profile: CharacterProfile, character_id: str = "") -> str:
    cid = (character_id or profile.character_id or "").strip()
    route = get_route(cid)
    if route:
        return route.target_stage_id
    catalog = load_relationship_catalog()
    mapping = catalog.get("target_stage_map") or {}
    if profile.target_stage_id.strip():
        return profile.target_stage_id.strip()
    rel = profile.target_relationship.strip() or profile.relationship.strip()
    if rel in mapping:
        return str(mapping[rel])
    if profile.relationship_stage.strip():
        return profile.relationship_stage.strip()
    return effective_target_stage_id(cid, "dating")


def resolve_max_stage_id(profile: CharacterProfile, character_id: str = "", base_id: str = "") -> str:
    cid = (character_id or profile.character_id or "").strip()
    route = get_route(cid)
    if route:
        return route.max_stage_id
    return effective_max_stage_id(cid, base_id)


def stage_for_affinity(affinity: int) -> StageDef:
    stages = sorted(list_stages(), key=lambda s: s.affinity_min)
    if not stages:
        return StageDef(
            id="dating",
            label="女朋友",
            affinity_min=0,
            user_title="亲爱的",
            tone="恋人模式",
            tts_hint="语气甜软",
        )
    picked = stages[0]
    for stage in stages:
        if affinity >= stage.affinity_min:
            picked = stage
    return picked


def cap_stage_id(stage_id: str, max_stage_id: str) -> str:
    order = stage_order()
    if not order:
        return stage_id
    if stage_id not in order:
        return max_stage_id if max_stage_id in order else order[0]
    if max_stage_id not in order:
        return stage_id
    return stage_id if order.index(stage_id) <= order.index(max_stage_id) else max_stage_id


def init_relationship_state(
    profile: CharacterProfile,
    *,
    character_id: str = "",
    base_id: str = "",
) -> RelationshipState:
    stages = stage_index()
    cid = (character_id or profile.character_id or "").strip()
    route = get_route(cid)
    target_id = resolve_target_stage_id(profile, cid)
    max_id = resolve_max_stage_id(profile, cid, base_id)
    growth = route.growth_mode if route else (profile.growth_mode or "fixed")
    affinity = int(profile.initial_affinity)
    stage_id = (route.start_stage_id if route else (profile.relationship_stage or "")).strip()

    if growth == "progressive":
        if not stage_id:
            stage_id = "stranger"
        stage_id = cap_stage_id(stage_id, max_id)
        if affinity <= 0:
            stage = stages.get(stage_id) or stage_for_affinity(0)
            affinity = max(stage.affinity_min, affinity)
    else:
        if stage_id and stage_id in stages:
            stage = stages[stage_id]
        else:
            stage = stage_for_affinity(affinity)
            stage_id = stage.id
        stage_id = cap_stage_id(stage_id, max_id)
        affinity = max(affinity, (stages.get(stage_id) or stage_for_affinity(affinity)).affinity_min)

    stage = stages.get(stage_id) or stage_for_affinity(affinity)
    user_title = (profile.user_title or "").strip() or stage.user_title
    return RelationshipState(
        stage_id=stage.id,
        stage_label=stage.label,
        affinity=min(100, max(0, affinity)),
        trust=70 if growth == "progressive" else 85,
        mood=0,
        user_title=user_title,
        growth_mode=growth,
        target_stage_id=cap_stage_id(target_id, max_id),
        max_stage_id=max_id,
        route_label=route.route_label if route else "",
        turns=0,
    )


def apply_judge_to_state(
    state: RelationshipState,
    *,
    affinity_delta: int,
    trust_delta: int,
    mood_delta: int = 0,
    new_flags: dict[str, bool] | None = None,
) -> tuple[RelationshipState, int, bool]:
    if state.active_ending_id:
        return state, 0, False

    prev_stage = state.stage_id
    flags = dict(state.flags)
    if new_flags:
        flags.update(new_flags)

    next_affinity = min(100, max(0, state.affinity + affinity_delta))
    next_trust = min(100, max(0, state.trust + trust_delta))
    next_mood = min(100, max(-100, state.mood + mood_delta))

    low_streak = state.low_streak
    if next_affinity <= 5 or next_trust <= 15:
        low_streak += 1
    else:
        low_streak = 0

    if state.growth_mode == "progressive" and affinity_delta != 0:
        stage = stage_for_affinity(next_affinity)
        stage_id = cap_stage_id(stage.id, state.max_stage_id)
        stage_id = cap_stage_id(stage_id, state.target_stage_id)
        stage = stage_index().get(stage_id) or stage
        updated = state.model_copy(
            update={
                "affinity": next_affinity,
                "trust": next_trust,
                "mood": next_mood,
                "flags": flags,
                "low_streak": low_streak,
                "stage_id": stage.id,
                "stage_label": stage.label,
                "user_title": stage.user_title,
                "turns": state.turns + 1,
            }
        )
        return updated, affinity_delta, updated.stage_id != prev_stage

    updated = state.model_copy(
        update={
            "affinity": next_affinity,
            "trust": next_trust,
            "mood": next_mood,
            "flags": flags,
            "low_streak": low_streak,
            "turns": state.turns + 1,
        }
    )
    return updated, affinity_delta, False


def mood_natural_phrase(mood: int) -> str:
    """把心情数值译成自然语言；禁止模型在对白中念数字。"""
    if mood <= -40:
        return "情绪很低落，话很少，容易烦，不太想延长见面"
    if mood <= -15:
        return "心情有点闷，回应偏短，可能想早点结束或换话题"
    if mood >= 40:
        return "心情很好，更愿意多聊几句，语气更轻快"
    if mood >= 15:
        return "情绪平稳偏开心，愿意正常交谈"
    return "情绪平常，没有特别兴奋也没有明显烦躁"


def relationship_prompt_block(profile: CharacterProfile, state: RelationshipState) -> str:
    stage = stage_index().get(state.stage_id) or stage_for_affinity(state.affinity)
    rel_label = state.stage_label or profile.relationship
    max_stage = stage_index().get(state.max_stage_id)
    max_label = max_stage.label if max_stage else state.max_stage_id
    mood_line = mood_natural_phrase(int(state.mood or 0))

    growth_hint = ""
    if state.growth_mode == "progressive":
        target = stage_index().get(state.target_stage_id)
        target_label = target.label if target else profile.target_relationship or "恋人"
        if (profile.cast_role or "").lower() in {"neutral", "npc"}:
            growth_hint = (
                f"\n- 关系可以更熟、更默契，但上限是「{max_label}」，"
                "不会走到恋爱；对方告白时应明确拒绝或岔开。"
            )
        else:
            growth_hint = (
                f"\n- 情感可随日常慢慢升温，方向大致朝「{target_label}」"
                f"（长期上限可到「{max_label}」）。真诚会拉近，冷漠会疏远；"
                "称呼与语气渐变，不要突然跳变成恋人腔。"
            )
    elif state.max_stage_id != "married":
        growth_hint = f"\n- 关系上限是「{max_label}」，不要写结婚/夫妻日常。"

    route_block = route_prompt_block(profile.character_id)
    route_section = f"\n\n{route_block}" if route_block else ""

    cast = (profile.cast_role or "").strip().lower()
    cast_rule = ""
    if cast == "neutral":
        cast_rule = (
            "\n- 定位：与对方有关（家人/挚友/熟人），可以亲密与拌嘴，"
            "**禁止恋爱、亲吻升级、接受告白、称对方为恋人/老公**。"
        )
    elif cast == "npc":
        cast_rule = (
            "\n- 定位：生活里的配角人脉，推动剧情/传闻即可；"
            "**禁止恋爱主线、接受告白、称对方为恋人**。"
        )
    elif cast == "romance":
        cast_rule = (
            "\n- 定位：开局并不是现成恋人；情感可慢慢升温，允许日后走到恋爱甚至结婚（多结局不互斥）。"
            "不要一上来就情侣腔。"
        )

    return f"""【关系与称呼】
- 开局身份：{profile.relationship or rel_label}；当前相处感觉：{rel_label}
- 对用户的称呼：{state.user_title}
- 互动语气：{stage.tone}
- 今日心境（只体现于措辞，禁止念数值/字段）：{mood_line}
- 语音语气参考：{stage.tts_hint}{growth_hint}{cast_rule}
{route_section}
- 禁止自行宣布关系升级或结婚；阶段变化由系统判定。"""

def public_relationship_state(state: RelationshipState) -> dict[str, Any]:
    return state.model_dump()
