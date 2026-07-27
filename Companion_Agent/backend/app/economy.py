"""男主经济与职业 SSOT。"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field

from .config import PROJECT_ROOT


class JobDef(BaseModel):
    id: str
    title: str
    workplace_id: str = "office"
    workday_pay: int = 200
    ap_cost: int = 2
    energy_cost: int = 25
    rest_day_note: str = ""


class MealDef(BaseModel):
    id: str
    label: str
    location_ids: list[str] = Field(default_factory=list)
    money_cost: int = 20
    ap_cost: int = 0
    energy_gain: int = 15


class EconomyCatalog(BaseModel):
    version: int = 1
    starting_money: int = 2800
    starting_energy: int = 80
    meals_per_day_max: int = 3
    end_day_energy_gain: int = 15
    default_gift_money: int = 25
    default_date_money: int = 80
    default_job_id: str = "office_junior"
    jobs: list[JobDef] = Field(default_factory=list)
    meals: list[MealDef] = Field(default_factory=list)
    money_vibe_thresholds: dict[str, int] = Field(
        default_factory=lambda: {"tight": 800, "ok": 2500}
    )


@lru_cache(maxsize=1)
def load_economy_catalog() -> EconomyCatalog:
    path = PROJECT_ROOT / "data" / "economy_catalog.json"
    if not path.is_file():
        return EconomyCatalog()
    return EconomyCatalog.model_validate(json.loads(path.read_text(encoding="utf-8")))


def reload_economy_catalog() -> EconomyCatalog:
    load_economy_catalog.cache_clear()
    return load_economy_catalog()


def get_job(job_id: str | None = None) -> JobDef:
    cat = load_economy_catalog()
    jid = (job_id or cat.default_job_id).strip()
    for job in cat.jobs:
        if job.id == jid:
            return job
    if cat.jobs:
        return cat.jobs[0]
    return JobDef(id="office_junior", title="普通公司职员")


def default_protagonist_fields() -> dict[str, Any]:
    cat = load_economy_catalog()
    job = get_job(cat.default_job_id)
    return {
        "job_id": job.id,
        "job_title": job.title,
        "workplace_id": job.workplace_id,
        "money": int(cat.starting_money),
        "energy": int(cat.starting_energy),
        "worked_day_index": 0,
        "meals_today": 0,
    }


def money_vibe(money: int) -> str:
    """返回软口吻档位：拮据 / 还行 / 宽裕。"""
    cat = load_economy_catalog()
    th = cat.money_vibe_thresholds or {}
    tight = int(th.get("tight") or 800)
    ok = int(th.get("ok") or 2500)
    if money < tight:
        return "拮据"
    if money < ok:
        return "还行"
    return "宽裕"


def gift_money_cost(gift_money: int | None = None) -> int:
    """故事优先：礼物不再扣金钱（保留 AP）。"""
    return 0


def date_money_cost(date_money: int | None = None) -> int:
    """故事优先：约会不再扣金钱（保留 AP）。"""
    return 0


def meal_money_cost(meal_money: int | None = None) -> int:
    """故事优先：吃饭不再扣金钱。"""
    return 0


def meals_at_location(location_id: str) -> list[MealDef]:
    return [
        m
        for m in load_economy_catalog().meals
        if location_id in (m.location_ids or [])
    ]


def public_economy_actions(location_id: str, *, is_workday: bool, protagonist: Any) -> dict[str, Any]:
    """Hub/地点页可用的上班与吃饭选项。"""
    job = get_job(getattr(protagonist, "job_id", None))
    work = {
        "available": location_id == job.workplace_id,
        "is_workday": bool(is_workday),
        "already_worked": int(getattr(protagonist, "worked_day_index", 0) or 0)
        == int(getattr(protagonist, "_day_index", 0) or 0),
        "job_title": job.title,
        "workplace_id": job.workplace_id,
        "pay": job.workday_pay,
        "ap_cost": job.ap_cost,
        "energy_cost": job.energy_cost,
        "rest_day_note": job.rest_day_note,
    }
    # already_worked 由调用方用 day_index 校正
    meals = [
        {
            "id": m.id,
            "label": m.label,
            "money_cost": 0,
            "ap_cost": m.ap_cost,
            "energy_gain": m.energy_gain,
        }
        for m in meals_at_location(location_id)
    ]
    return {"work": work, "meals": meals}
