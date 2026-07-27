"""Daily encounter / 行动力：日历日刷新 AP，可选日常活动。"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .config import PROJECT_ROOT
from .relationship import RelationshipState, stage_order
from .save_store import GameRuntime


class DailyEncounter(BaseModel):
    id: str
    label: str
    description: str = ""
    scene_id: str = ""
    cost: int = Field(1, ge=1, le=3)
    prompt_snippet: str = ""
    base_ids: list[str] = Field(default_factory=list)
    character_ids: list[str] = Field(default_factory=list)
    stage_min: str = ""
    stage_max: str = ""


def _catalog_path() -> Path:
    return PROJECT_ROOT / "data" / "daily_encounters.json"


def load_daily_catalog() -> dict[str, Any]:
    path = _catalog_path()
    if not path.is_file():
        return {"ap_max": 3, "encounters": []}
    return json.loads(path.read_text(encoding="utf-8"))


def ap_max_from_catalog() -> int:
    return int(load_daily_catalog().get("ap_max") or 3)


def list_encounters() -> list[DailyEncounter]:
    rows = load_daily_catalog().get("encounters") or []
    return [DailyEncounter.model_validate(row) for row in rows]


def encounter_index() -> dict[str, DailyEncounter]:
    return {e.id: e for e in list_encounters()}


def _today_key() -> str:
    return date.today().isoformat()


def refresh_daily_runtime(runtime: GameRuntime, *, ap_max: int | None = None) -> GameRuntime:
    """新日历日重置行动力。"""
    today = _today_key()
    max_ap = ap_max if ap_max is not None else runtime.action_points_max or ap_max_from_catalog()
    if runtime.last_play_date == today:
        return runtime.model_copy(update={"action_points_max": max_ap})
    return runtime.model_copy(
        update={
            "last_play_date": today,
            "action_points": max_ap,
            "action_points_max": max_ap,
            "daily_encounters_done": [],
            "daily_encounter_id": None,
        }
    )


def public_daily_state(runtime: GameRuntime) -> dict[str, Any]:
    runtime = refresh_daily_runtime(runtime)
    return {
        "date": runtime.last_play_date or _today_key(),
        "action_points": runtime.action_points,
        "action_points_max": runtime.action_points_max,
        "encounters_done": list(runtime.daily_encounters_done),
        "active_encounter_id": runtime.daily_encounter_id,
    }


def _stage_rank(stage_id: str) -> int:
    order = stage_order()
    try:
        return order.index(stage_id)
    except ValueError:
        return -1


def filter_encounters_for_session(
    *,
    character_id: str,
    base_id: str,
    state: RelationshipState,
) -> list[DailyEncounter]:
    rank = _stage_rank(state.stage_id)
    out: list[DailyEncounter] = []
    for enc in list_encounters():
        if enc.character_ids and character_id not in enc.character_ids:
            continue
        if enc.base_ids and base_id not in enc.base_ids:
            continue
        if enc.stage_min and _stage_rank(enc.stage_min) > rank:
            continue
        if enc.stage_max and _stage_rank(enc.stage_max) < rank:
            continue
        out.append(enc)
    return out


def public_encounter_catalog(
    *,
    character_id: str = "",
    base_id: str = "",
    state: RelationshipState | None = None,
) -> list[dict[str, Any]]:
    if state is None:
        state = RelationshipState()
    rows = filter_encounters_for_session(character_id=character_id, base_id=base_id, state=state)
    return [
        {
            "id": e.id,
            "label": e.label,
            "description": e.description,
            "scene_id": e.scene_id,
            "cost": e.cost,
        }
        for e in rows
    ]


def can_spend_ap(runtime: GameRuntime, cost: int = 1) -> bool:
    runtime = refresh_daily_runtime(runtime)
    return runtime.action_points >= cost


def spend_ap(runtime: GameRuntime, cost: int = 1) -> GameRuntime:
    runtime = refresh_daily_runtime(runtime)
    if runtime.action_points < cost:
        raise ValueError("行动力不足")
    done = list(runtime.daily_encounters_done)
    return runtime.model_copy(update={"action_points": runtime.action_points - cost, "daily_encounters_done": done})


def start_encounter(runtime: GameRuntime, encounter: DailyEncounter) -> GameRuntime:
    runtime = spend_ap(runtime, encounter.cost)
    done = list(runtime.daily_encounters_done)
    if encounter.id not in done:
        done.append(encounter.id)
    return runtime.model_copy(update={"daily_encounter_id": encounter.id, "daily_encounters_done": done})


def get_encounter(encounter_id: str) -> DailyEncounter | None:
    return encounter_index().get((encounter_id or "").strip())
