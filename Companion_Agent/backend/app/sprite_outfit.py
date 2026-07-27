"""根据日历/地点/心情/好感/关系阶段解析立绘前缀；只返回该角色磁盘上真实存在的 outfit。

缺图时沿候选链回退（如 season_winter→casual→home），避免直接掉成裸情绪图丢时段感。
前端拼文件名为 `{sprite_outfit}_{emotion}.png`。
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .config import PROJECT_ROOT

INTIMATE_AFFINITY_MIN = 70
INTIMATE_LINGERIE_AFFINITY_MIN = 85
INTIMATE_MAX_AFFINITY_MIN = 88
INTIMATE_IMPLIED_AFFINITY_MIN = 92
SLEEP_FATIGUE_MIN = 45
_MAX_APPEAL_OUTFITS = (
    "max_micro_slip",
    "max_wet_cling",
    "max_garter",
    "max_kneel_pillow",
    "max_strappy",
    "max_choker",
    "max_slit_gown",
    "max_over_shoulder",
    "max_sofa_lie",
    "max_ribbon_cover",
)
# §2.4 结局 CG：仅 presentation / 图鉴；永不进入 resolve 候选链
_ENDING_CG_OUTFITS = (
    "end_lingerie_set",
    "end_deep_v",
    "end_lace_bra",
    "end_sheer_cover",
    "end_robe_open",
    "end_strappy",
    "end_garter_bed",
    "end_kneel_pillow",
    "end_back_glance",
    "end_sofa_invite",
    "end_choker",
    "end_wet_home",
    "end_window_night",
    "end_morning_after",
    "end_close_embrace",
)
_ROMANCE_ADVANCE_OUTFITS = frozenset(
    {
        "intimate_lounge",
        "intimate_lingerie",
        "intimate_implied",
        "bridal",
        "maternity",
        # T0 擦边共享（扩展计划 §2.2）
        "silk_slip",
        "after_bath",
        "morning_shirt",
        "lace_night",
        "towel_wrap",
        "backless_home",
        "bedside_hug",
        "window_night",
        # romance T0–T2 魅力极限（§2.3）
        *_MAX_APPEAL_OUTFITS,
        # romance T0–T2 结局展示（§2.4；标签用，resolve 不 add）
        *_ENDING_CG_OUTFITS,
    }
)
_INTIMATE_NIGHT_EXTRAS = (
    "silk_slip",
    "lace_night",
    "towel_wrap",
    "backless_home",
    "bedside_hug",
    "window_night",
)
_INTIMATE_MORNING_EXTRAS = ("after_bath", "morning_shirt")
_EMOTIONS = frozenset(
    {"neutral", "happy", "shy", "sad", "angry", "love", "surprised", "sarcastic"}
)


@lru_cache(maxsize=1)
def _load_sprite_gen_manifest() -> dict[str, Any]:
    path = PROJECT_ROOT / "data" / "sprite_gen_manifest.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def reload_sprite_outfit_manifest() -> None:
    _load_sprite_gen_manifest.cache_clear()
    available_outfits.cache_clear()


def _character_pack(character_id: str) -> dict[str, Any]:
    chars = (_load_sprite_gen_manifest().get("characters") or {})
    return chars.get(character_id) or {}


def _cast_kind(character_id: str) -> str:
    kind = str(_character_pack(character_id).get("cast_kind") or "").strip()
    if kind in {"romance", "neutral", "npc"}:
        return kind
    return "romance"


def _allows_romance_advance(character_id: str) -> bool:
    return bool(character_id) and _cast_kind(character_id) == "romance"


def _signature_for_location(character_id: str, location_id: str) -> str:
    hooks = _character_pack(character_id).get("signature_hooks") or {}
    loc = (location_id or "").lower()
    sig = hooks.get(loc)
    return str(sig) if sig else ""


@lru_cache(maxsize=64)
def available_outfits(character_id: str) -> frozenset[str]:
    """该角磁盘上已有的 outfit / outfit_state 前缀集合。"""
    from .sprite_catalog import resolve_sprite_dir

    folder = resolve_sprite_dir(character_id)
    if not folder or not folder.is_dir():
        return frozenset()
    found: set[str] = set()
    for path in folder.glob("*.png"):
        stem = path.stem
        if stem in _EMOTIONS:
            continue
        matched = False
        for emo in _EMOTIONS:
            suf = "_" + emo
            if stem.endswith(suf):
                found.add(stem[: -len(suf)])
                matched = True
                break
        if not matched:
            found.add(stem)
    return frozenset(found)


def pick_available_outfit(character_id: str, candidates: list[str]) -> str:
    """按候选优先级取第一张该角确实有的图前缀；都没有则空串（前端用裸情绪）。"""
    have = available_outfits(character_id) if character_id else frozenset()
    if not have:
        # 无索引时仍返回首选，交给前端/API 回退
        for c in candidates:
            if c:
                return c
        return ""
    for c in candidates:
        key = (c or "").strip()
        if key and key in have:
            return key
    # 保底：全员应有的基础档
    for c in ("casual", "home", "work", "school"):
        if c in have:
            return c
    return ""


def resolve_outfit(
    *,
    day_index: int = 1,
    period: str = "afternoon",
    location_id: str = "",
    occupation: str = "",
    mood: int = 0,
    on_date: bool = False,
    character_id: str = "",
    affinity: int = 0,
    fatigue: int = 0,
    meal_context: bool = False,
    long_status: str = "",
    stage_id: str = "",
) -> str:
    from .china_calendar import day_info

    info = day_info(day_index)
    fest = str(info.get("festival") or "")
    is_workday = bool(info.get("is_workday"))
    season = str(info.get("season") or "summer").lower()
    loc = (location_id or "").lower()
    occ = occupation or ""
    per = (period or "afternoon").lower()
    cid = (character_id or "").strip()
    stage = (stage_id or "").strip().lower()
    romance_ok = _allows_romance_advance(cid)
    # 解析仅冬天请求季节装；春夏秋图留磁盘供图鉴，不抢日常
    winter_key = "season_winter" if season == "winter" else ""

    candidates: list[str] = []

    def add(*keys: str) -> None:
        for k in keys:
            if not k:
                continue
            if k in _ROMANCE_ADVANCE_OUTFITS and not romance_ok:
                continue
            if k not in candidates:
                candidates.append(k)

    if on_date:
        if romance_ok and stage == "married":
            add("bridal", "date", "casual", "home")
        else:
            add("date", "casual", "home")
        return pick_available_outfit(cid, candidates)

    from .life_friction import weather_kind

    raining = weather_kind(day_index) == "rain" or "雨" in (info.get("note") or "")
    if raining and loc in {"street", "campus", "park", "forest", ""}:
        add("rain", "casual")
    if loc == "street" and raining:
        add("rain", "casual")

    if "春" in fest or "元旦" in fest or "年" in fest:
        add("festival_spring", "casual", "date")
    if "中秋" in fest or "端午" in fest:
        add("festival_midautumn", "casual", "date")

    home_like = loc in {"home", "room"}

    # 关系进阶：暗示 > 魅力极限 > 擦边/内衣 > 软私密（仅 romance；缺图沿链回退）
    if romance_ok and home_like and per == "night" and stage == "married" and affinity >= INTIMATE_IMPLIED_AFFINITY_MIN:
        add(
            "intimate_implied",
            *_MAX_APPEAL_OUTFITS,
            "intimate_lingerie",
            *_INTIMATE_NIGHT_EXTRAS,
            "intimate_lounge",
            "home",
            "casual",
        )
    elif (
        romance_ok
        and home_like
        and per in {"evening", "night"}
        and stage in {"dating", "married"}
        and affinity >= INTIMATE_MAX_AFFINITY_MIN
    ):
        add(
            *_MAX_APPEAL_OUTFITS,
            "intimate_lingerie",
            *_INTIMATE_NIGHT_EXTRAS,
            "intimate_lounge",
            "home",
            "casual",
        )
    elif (
        romance_ok
        and home_like
        and per in {"evening", "night"}
        and stage in {"dating", "married"}
        and affinity >= INTIMATE_LINGERIE_AFFINITY_MIN
    ):
        add("intimate_lingerie", *_INTIMATE_NIGHT_EXTRAS, "intimate_lounge", "home", "casual")
    elif romance_ok and home_like and per in {"evening", "night"} and affinity >= INTIMATE_AFFINITY_MIN:
        add("intimate_lounge", "home", "casual")

    # 晨起擦边：dating|married + 居家早晨（与 maternity 日间分流）
    if (
        romance_ok
        and home_like
        and per == "morning"
        and stage in {"dating", "married"}
        and affinity >= INTIMATE_AFFINITY_MIN
    ):
        add(*_INTIMATE_MORNING_EXTRAS, "home", "casual")

    # 怀孕日常：married + 居家日间（不与 night 亲密档抢；morning 在擦边之后作候选）
    if romance_ok and stage == "married" and home_like and per in {"morning", "afternoon"}:
        add("maternity", "home", "casual")

    # 睡眠：居家夜间 + 疲劳或生病
    if home_like and per == "night" and (
        fatigue >= SLEEP_FATIGUE_MIN or long_status == "sick" or mood <= -30
    ):
        add("home_sleeping", "sleepy", "home", "casual")

    # 用餐：仅显式 meal_context（避免下午误切捧碗图）
    if meal_context:
        if home_like:
            add("home_eating", "home", "casual")
        elif loc == "cafe":
            add("work_eating", "work", "casual")
        else:
            add("casual_eating", "casual")

    # 工位专注
    if loc == "office" and per in {"morning", "afternoon"}:
        add("work_working_focus", "work", "casual")

    # 职业/关系签名（地点钩子）
    if cid:
        sig = _signature_for_location(cid, loc)
        if sig:
            add(sig)

    if mood <= -35 and per in {"night", "evening"}:
        add("home", "casual")
    if mood <= -20 and is_workday:
        if any(k in occ for k in ("工程", "顾问", "实习")):
            add("overtime", "work", "casual")
        else:
            add("work", "casual")

    if home_like:
        if per in {"morning", "afternoon"}:
            add(winter_key, "casual", "home")
        else:
            add("home", winter_key, "casual")
    elif any(k in occ for k in ("咖啡", "店员")) and (
        loc in {"cafe", "store"} or (is_workday and per in {"morning", "afternoon"})
    ):
        add("work", "casual")
    elif loc == "office" or (is_workday and any(k in occ for k in ("工程", "顾问", "讲师", "实习"))):
        add("work", "casual")
    elif loc == "campus" or (
        is_workday and any(k in occ for k in ("高中", "大学", "学生", "社团", "练习生"))
    ):
        add("school", "casual")
    elif loc in {"cafe", "park", "store", "library", "forest"}:
        add(winter_key, "casual", "work" if loc == "cafe" else "")
    elif not is_workday:
        add(winter_key, "casual", "home")
    elif any(k in occ for k in ("高中", "大学", "学生")):
        add("school", "casual")
    elif any(k in occ for k in ("工程", "顾问", "讲师")):
        add("work", "casual")
    else:
        add(winter_key, "casual", "home")

    return pick_available_outfit(cid, candidates)


def meal_context_from_save(save: Any) -> bool:
    """本时段刚吃过饭则为 True（与 WorldSave.meal_context_period 对齐）。"""
    if save is None:
        return False
    period = str(getattr(getattr(save, "calendar", None), "period", "") or "")
    flag = str(getattr(save, "meal_context_period", "") or "")
    return bool(flag) and flag == period


def resolve_outfit_for_world(
    *,
    day_index: int,
    period: str,
    location_id: str,
    character_id: str,
    mood: int = 0,
    on_date: bool = False,
    affinity: int = 0,
    fatigue: int = 0,
    meal_context: bool = False,
    long_status: str = "",
    stage_id: str = "",
) -> str:
    from .social_graph import load_social_graph

    social = load_social_graph().characters.get(character_id)
    occ = social.occupation if social else ""
    return resolve_outfit(
        day_index=day_index,
        period=period,
        location_id=location_id,
        occupation=occ,
        mood=mood,
        on_date=on_date,
        character_id=character_id,
        affinity=affinity,
        fatigue=fatigue,
        meal_context=meal_context,
        long_status=long_status,
        stage_id=stage_id,
    )


def resolve_outfit_for_bond(
    save: Any,
    bond: Any,
    *,
    on_date: bool = False,
    meal_context: bool | None = None,
) -> str:
    """Hub / 地点缩略图用：按当前世界时间地点解析该角立绘。"""
    from .social_life import active_long_status

    if meal_context is None:
        meal_context = meal_context_from_save(save)
    rel = getattr(bond, "relationship_state", None)
    return resolve_outfit_for_world(
        day_index=save.calendar.day_index,
        period=save.calendar.period,
        location_id=save.location_id,
        character_id=bond.character_id,
        mood=int(getattr(rel, "mood", 0) or 0),
        on_date=on_date,
        affinity=int(getattr(rel, "affinity", 0) or 0),
        fatigue=int(bond.living.fatigue or 0),
        meal_context=bool(meal_context),
        long_status=active_long_status(bond, save.calendar.day_index) or "",
        stage_id=str(getattr(rel, "stage_id", "") or ""),
    )


def public_outfit_payload(outfit_id: str) -> dict[str, Any]:
    return {"sprite_outfit": outfit_id or ""}
