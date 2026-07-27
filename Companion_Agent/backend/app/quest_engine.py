"""养成任务链：YAML 加载、步骤推进、prompt 注入。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from .config import PROJECT_ROOT
from .relationship import RelationshipState, stage_order
from .save_store import GameRuntime


class QuestCompleteWhen(BaseModel):
    affinity_min: int | None = None
    trust_min: int | None = None
    stage_min: str = ""
    stage_id: str = ""
    flags_any: list[str] = Field(default_factory=list)
    flags_all: list[str] = Field(default_factory=list)
    turns_min: int | None = None


class QuestStep(BaseModel):
    id: str
    label: str
    description: str = ""
    complete_when: QuestCompleteWhen = Field(default_factory=QuestCompleteWhen)
    prompt_snippet: str = ""
    rewards: dict[str, Any] = Field(default_factory=dict)


class QuestChain(BaseModel):
    id: str
    label: str = ""
    growth_mode: str = ""
    base_ids: list[str] = Field(default_factory=list)
    character_ids: list[str] = Field(default_factory=list)
    steps: list[QuestStep] = Field(default_factory=list)


def _quests_dir() -> Path:
    return PROJECT_ROOT / "data" / "quests"


def _stage_rank(stage_id: str) -> int:
    order = stage_order()
    try:
        return order.index(stage_id)
    except ValueError:
        return -1


def load_quest_chains() -> list[QuestChain]:
    directory = _quests_dir()
    if not directory.is_dir():
        return []
    chains: list[QuestChain] = []
    for path in sorted(directory.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            chains.append(QuestChain.model_validate(raw))
    return chains


def _matches_chain(chain: QuestChain, *, character_id: str, base_id: str, growth_mode: str) -> bool:
    if chain.character_ids and character_id not in chain.character_ids:
        return False
    if chain.base_ids and base_id not in chain.base_ids:
        return False
    if chain.growth_mode and chain.growth_mode != growth_mode:
        return False
    return True


def _chain_specificity(
    chain: QuestChain,
    *,
    character_id: str,
    base_id: str,
    growth_mode: str,
) -> int:
    if not _matches_chain(chain, character_id=character_id, base_id=base_id, growth_mode=growth_mode):
        return -1
    score = 0
    if chain.character_ids:
        score += 100
    if chain.base_ids:
        score += 10
    if chain.growth_mode:
        score += 1
    return score


def pick_quest_chain(
    *,
    character_id: str,
    base_id: str,
    growth_mode: str,
) -> QuestChain | None:
    best: QuestChain | None = None
    best_score = -1
    for chain in load_quest_chains():
        score = _chain_specificity(
            chain, character_id=character_id, base_id=base_id, growth_mode=growth_mode
        )
        if score > best_score:
            best_score = score
            best = chain
    return best


def _step_complete(step: QuestStep, state: RelationshipState, runtime: GameRuntime) -> bool:
    cond = step.complete_when
    has_cond = any(
        [
            cond.affinity_min is not None,
            cond.trust_min is not None,
            bool(cond.stage_id),
            bool(cond.stage_min),
            bool(cond.flags_all),
            bool(cond.flags_any),
            cond.turns_min is not None,
        ]
    )
    if not has_cond:
        return False
    if cond.affinity_min is not None and state.affinity < cond.affinity_min:
        return False
    if cond.trust_min is not None and state.trust < cond.trust_min:
        return False
    if cond.stage_id and state.stage_id != cond.stage_id:
        return False
    if cond.stage_min and _stage_rank(state.stage_id) < _stage_rank(cond.stage_min):
        return False
    flags = state.flags or {}
    if cond.flags_all and not all(flags.get(f) for f in cond.flags_all):
        return False
    if cond.flags_any and not any(flags.get(f) for f in cond.flags_any):
        return False
    if cond.turns_min is not None and state.turns < cond.turns_min:
        return False
    return True


def active_quest_step(
    chain: QuestChain | None,
    runtime: GameRuntime,
    state: RelationshipState,
) -> QuestStep | None:
    if not chain or not chain.steps:
        return None
    done = set(runtime.quest_steps_done or [])
    for step in chain.steps:
        if step.id in done:
            continue
        return step
    return None


def evaluate_quest_progress(
    *,
    character_id: str,
    base_id: str,
    growth_mode: str,
    state: RelationshipState,
    runtime: GameRuntime,
) -> dict[str, Any]:
    chain = pick_quest_chain(character_id=character_id, base_id=base_id, growth_mode=growth_mode)
    if not chain:
        return {"chain": None, "active": None, "completed": [], "just_completed": None}

    done = list(runtime.quest_steps_done or [])
    just_completed: QuestStep | None = None
    changed = False

    for step in chain.steps:
        if step.id in done:
            continue
        if _step_complete(step, state, runtime):
            done.append(step.id)
            just_completed = step
            changed = True
            continue
        break

    active = active_quest_step(chain, runtime.model_copy(update={"quest_steps_done": done}), state)
    return {
        "chain": {"id": chain.id, "label": chain.label},
        "active": _public_step(active) if active else None,
        "completed": done,
        "just_completed": _public_step(just_completed) if just_completed else None,
        "quest_steps_done": done if changed else None,
        "active_quest_id": chain.id,
    }


def quest_prompt_snippet(
    *,
    character_id: str,
    base_id: str,
    growth_mode: str,
    state: RelationshipState,
    runtime: GameRuntime,
) -> str:
    chain = pick_quest_chain(character_id=character_id, base_id=base_id, growth_mode=growth_mode)
    step = active_quest_step(chain, runtime, state)
    if not step or not step.prompt_snippet.strip():
        return ""
    desc = step.description or step.label
    return f"{step.prompt_snippet.strip()}\n（当前养成目标：{desc}）"


def public_quest_state(
    *,
    character_id: str,
    base_id: str,
    growth_mode: str,
    state: RelationshipState,
    runtime: GameRuntime,
) -> dict[str, Any]:
    chain = pick_quest_chain(character_id=character_id, base_id=base_id, growth_mode=growth_mode)
    active = active_quest_step(chain, runtime, state)
    done = list(runtime.quest_steps_done or [])
    done_set = set(done)
    total = len(chain.steps) if chain else 0
    active_id = active.id if active else ""
    steps: list[dict[str, Any]] = []
    if chain:
        for step in chain.steps:
            if step.id in done_set:
                status = "done"
            elif step.id == active_id:
                status = "active"
            else:
                status = "locked"
            pub = _public_step(step) or {}
            steps.append({**pub, "status": status})
    return {
        "chain_id": chain.id if chain else None,
        "chain_label": chain.label if chain else "",
        "active_step": _public_step(active),
        "completed_count": len(done),
        "total_steps": total,
        "steps_done": done,
        "steps": steps,
    }


def _public_step(step: QuestStep | None) -> dict[str, Any] | None:
    if not step:
        return None
    return {
        "id": step.id,
        "label": step.label,
        "description": step.description or step.label,
    }


def public_quest_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for chain in load_quest_chains():
        out.append(
            {
                "id": chain.id,
                "label": chain.label,
                "growth_mode": chain.growth_mode,
                "base_ids": chain.base_ids,
                "character_ids": chain.character_ids,
                "steps": [{"id": s.id, "label": s.label, "description": s.description} for s in chain.steps],
            }
        )
    return out
