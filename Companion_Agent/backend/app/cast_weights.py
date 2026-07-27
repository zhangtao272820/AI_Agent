"""恋爱+中立引导/焦点/思念权重（SSOT：data/cast_weights.json）+ 出场周门（cast_intro.json）。

立绘梯度 T0/T1/N/T2 = 系统资源带：周焦点排除 N/T2；同场入池 T0 优先、T2 仅填空位。
"""

from __future__ import annotations

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .config import PROJECT_ROOT


class CastWeight(BaseModel):
    name: str = ""
    label: str = ""
    tier: str = "T1"  # T0|T1|T2|N（立绘/故事梯度 + 系统资源带）
    early_meet: int = Field(5, ge=1, le=10)
    weekly_focus: int = Field(5, ge=1, le=10)
    longing: int = Field(5, ge=1, le=10)
    presence: int = Field(5, ge=1, le=10)
    drama: int = Field(5, ge=1, le=10)
    why: str = ""


class CastWeightCatalog(BaseModel):
    version: int = 1
    notes: str = ""
    defaults: CastWeight = Field(default_factory=CastWeight)
    characters: dict[str, CastWeight] = Field(default_factory=dict)


class CastIntroCatalog(BaseModel):
    version: int = 1
    notes: str = ""
    presence_cap: int = 5
    presence_cap_weekend: int = 6
    week1_core: list[str] = Field(default_factory=list)
    characters: dict[str, dict[str, Any]] = Field(default_factory=dict)


def _path() -> Path:
    return PROJECT_ROOT / "data" / "cast_weights.json"


def _intro_path() -> Path:
    return PROJECT_ROOT / "data" / "cast_intro.json"


@lru_cache(maxsize=1)
def load_cast_weights() -> CastWeightCatalog:
    path = _path()
    if not path.is_file():
        return CastWeightCatalog()
    return CastWeightCatalog.model_validate(json.loads(path.read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def load_cast_intro() -> CastIntroCatalog:
    path = _intro_path()
    if not path.is_file():
        return CastIntroCatalog()
    return CastIntroCatalog.model_validate(json.loads(path.read_text(encoding="utf-8")))


def reload_cast_weights() -> CastWeightCatalog:
    load_cast_weights.cache_clear()
    load_cast_intro.cache_clear()
    return load_cast_weights()


def get_cast_weight(character_id: str) -> CastWeight:
    cat = load_cast_weights()
    return cat.characters.get(character_id) or cat.defaults


def intro_week_for(character_id: str) -> int:
    """最早可在地图出现的周（1=开局）。缺省按 early_meet 推：10→1，≤3→5。"""
    intro = load_cast_intro()
    row = intro.characters.get(character_id) or {}
    if "intro_week" in row:
        return max(1, int(row["intro_week"] or 1))
    em = get_cast_weight(character_id).early_meet
    if em >= 9:
        return 1
    if em >= 7:
        return 2
    if em >= 5:
        return 3
    if em >= 4:
        return 4
    return 5


def is_cast_introduced(save: Any, character_id: str) -> bool:
    """已认识 / 事件提前解锁 / 达到 intro_week。"""
    from .china_calendar import week_index_for_day

    day = int(getattr(getattr(save, "calendar", None), "day_index", 1) or 1)
    week = week_index_for_day(day)
    if week >= intro_week_for(character_id):
        return True
    flags = getattr(save, "world_flags", None) or {}
    if flags.get(f"introduced:{character_id}") or flags.get(f"met:{character_id}"):
        return True
    bond = (getattr(save, "bonds", None) or {}).get(character_id)
    if bond and int(getattr(getattr(bond, "living", None), "first_met_day", 0) or 0) > 0:
        return True
    return False


def presence_cap_for_day(day_index: int) -> int:
    from .china_calendar import day_info

    intro = load_cast_intro()
    info = day_info(day_index)
    if info.get("is_workday"):
        return max(3, int(intro.presence_cap or 5))
    return max(4, int(intro.presence_cap_weekend or 6))


def cast_tier(character_id: str) -> str:
    return (get_cast_weight(character_id).tier or "T1").upper()


def pick_period_active_cast(save: Any, candidate_ids: list[str]) -> list[str]:
    """本时段全镇可出没池：已解锁 ∩ 加权抽至 presence_cap；焦点+T0 优先；T2 仅填空位。"""
    from .china_calendar import week_index_for_day

    day = int(getattr(getattr(save, "calendar", None), "day_index", 1) or 1)
    period = str(getattr(getattr(save, "calendar", None), "period", "afternoon") or "afternoon")
    week = week_index_for_day(day)
    pool = [cid for cid in candidate_ids if cid and is_cast_introduced(save, cid)]
    if not pool:
        return []
    cap = presence_cap_for_day(day)
    romance_ids = [
        cid
        for cid, b in (getattr(save, "bonds", None) or {}).items()
        if getattr(b, "cast_kind", "") == "romance"
    ]
    focus = set(pick_weekly_focus_ids(romance_ids or pool, week_index=week, count=2))
    # 可复现：同日同时段同池结果稳定
    rng = random.Random(f"presence-{day}-{period}-{'-'.join(sorted(pool))}")
    locked = [cid for cid in pool if cid in focus]
    remain = [cid for cid in pool if cid not in focus]
    need = max(0, cap - len(locked))
    # T2 轻副本：先填非 T2，仍有空位再抽 T2
    remain_main = [cid for cid in remain if cast_tier(cid) != "T2"]
    remain_t2 = [cid for cid in remain if cast_tier(cid) == "T2"]
    extra = pick_weighted_ids(remain_main, count=need, weight_attr="presence", rng=rng)
    if len(extra) < need:
        extra.extend(
            pick_weighted_ids(
                remain_t2, count=need - len(extra), weight_attr="presence", rng=rng
            )
        )
    # 戏份高者在并列时靠前（仅排序，不扩容）；T0 优于同权 T1/N
    tier_rank = {"T0": 0, "N": 1, "T1": 2, "T2": 3}
    picked = locked + extra
    picked.sort(
        key=lambda cid: (
            0 if cid in focus else 1,
            tier_rank.get(cast_tier(cid), 9),
            -drama_multiplier(cid),
            -presence_bonus(cid),
            cid,
        )
    )
    return picked[:cap]


def longing_multiplier(character_id: str) -> float:
    """思念 ping：1.0 为默认；权重 5→1.0，10→1.5，1→0.6。"""
    w = get_cast_weight(character_id).longing
    return 0.5 + (w / 10.0)


def presence_bonus(character_id: str) -> float:
    """同场加权倍率增量：presence 5→0，10→+0.4，1→-0.32；供 who_is_here / ping。"""
    w = get_cast_weight(character_id).presence
    return (w - 5) * 0.08


def pick_weighted_ids(
    candidate_ids: list[str],
    *,
    count: int,
    weight_attr: str = "weekly_focus",
    rng: random.Random | None = None,
) -> list[str]:
    """按 CastWeight 某字段加权无放回抽取（日终 offscreen 等）。"""
    pool = [cid for cid in candidate_ids if cid]
    if not pool or count <= 0:
        return []
    rng = rng or random.Random()
    remain = list(pool)
    picked: list[str] = []
    for _ in range(min(count, len(remain))):
        weights = [max(1, int(getattr(get_cast_weight(cid), weight_attr, 5))) for cid in remain]
        choice = rng.choices(remain, weights=weights, k=1)[0]
        picked.append(choice)
        remain.remove(choice)
    return picked


def drama_multiplier(character_id: str) -> float:
    """多线戏份：1.0 为默认；权重 5→1.0，10→1.5，1→0.6。"""
    w = get_cast_weight(character_id).drama
    return 0.5 + (w / 10.0)


def pick_weekly_focus_ids(
    candidate_ids: list[str],
    *,
    week_index: int = 1,
    count: int = 2,
) -> list[str]:
    """按 weekly_focus 加权抽本周焦点（可复现）。

    硬门：恋爱周焦点排除 N / T2；优先 T0，不足再补 T1。
    """
    pool = [cid for cid in candidate_ids if cid]
    if not pool or count <= 0:
        return []
    t0 = [cid for cid in pool if cast_tier(cid) == "T0"]
    t1 = [cid for cid in pool if cast_tier(cid) == "T1"]
    focus_pool = t0 if t0 else t1
    if not focus_pool:
        # 极端：池里只有 N/T2 时仍不抽 N/T2 进恋爱焦点
        return []
    rng = random.Random(f"weekly-focus-{week_index}-{'-'.join(sorted(focus_pool))}")
    weights = [max(1, get_cast_weight(cid).weekly_focus) for cid in focus_pool]
    picked: list[str] = []
    remain = list(focus_pool)
    remain_w = list(weights)
    for _ in range(min(count, len(remain))):
        choice = rng.choices(remain, weights=remain_w, k=1)[0]
        idx = remain.index(choice)
        picked.append(choice)
        remain.pop(idx)
        remain_w.pop(idx)
    # T0 不足 count 时用 T1 补足（仅当主池已是 T0 且仍缺）
    if len(picked) < count and t0 and t1:
        need = count - len(picked)
        rng2 = random.Random(f"weekly-focus-t1-{week_index}-{'-'.join(sorted(t1))}")
        picked.extend(
            pick_weighted_ids(t1, count=need, weight_attr="weekly_focus", rng=rng2)
        )
    return picked[:count]


def early_meet_ranked(candidate_ids: list[str], *, limit: int = 5) -> list[str]:
    ranked = sorted(
        candidate_ids,
        key=lambda cid: (-get_cast_weight(cid).early_meet, cid),
    )
    return ranked[:limit]


def public_cast_weights() -> dict[str, Any]:
    cat = load_cast_weights()
    intro = load_cast_intro()
    characters: dict[str, Any] = {}
    for cid, w in cat.characters.items():
        row = w.model_dump()
        row["intro_week"] = intro_week_for(cid)
        characters[cid] = row
    return {
        "version": cat.version,
        "intro": {
            "presence_cap": intro.presence_cap,
            "presence_cap_weekend": intro.presence_cap_weekend,
            "week1_core": list(intro.week1_core or []),
        },
        "characters": characters,
    }
