"""美德式世界事实 → 女主 prompt 只读注入（系统写事实、模型演反应）。"""

from __future__ import annotations

from typing import Any


def build_world_facts_block(
    *,
    day_index: int,
    period_label: str,
    season_label: str,
    location_label: str,
    weather_line: str = "",
    stage_label: str = "",
    is_weekly_focus: bool = False,
    cast_kind: str = "",
) -> str:
    """组装【世界事实｜只读】；禁止模型编造未写入的行踪/日历。"""
    season = (season_label or "").strip() or "—"
    period = (period_label or "").strip() or "—"
    place = (location_label or "").strip() or "—"
    stage = (stage_label or "").strip() or "相识不久"
    weather = (weather_line or "").strip()
    weather_bit = f"；天气印象：{weather}" if weather else ""
    focus_bit = (
        "本周她是恋爱线焦点之一，可稍积极些。"
        if is_weekly_focus and (cast_kind or "") == "romance"
        else "本周她不是恋爱线焦点；勿自己加戏成全镇中心。"
    )
    cast_bit = ""
    if (cast_kind or "") == "neutral":
        cast_bit = "阵营：中立羁绊（可亲可闹，禁止恋爱走向）。"
    elif (cast_kind or "") == "romance":
        cast_bit = "阵营：可恋爱线（节奏仍由关系与立场决定）。"

    return (
        f"\n【世界事实｜只读】开档第 {max(1, int(day_index))} 天；"
        f"时段：{period}；季节：{season}季；此刻地点：{place}{weather_bit}。"
        f"关系印象：{stage}。{cast_bit}{focus_bit}"
        "同场他人、闲话、昨日行踪：仅以本提示中系统已写条目为准；"
        "**禁止编造**未写入的他人行踪、未到的季节/节日、或改写今日是否上班。"
        "独立思考只限在这些事实内用性格回应；禁止念系统字段与精确数值。"
    )


def weekly_focus_for_character(save: Any, character_id: str) -> bool:
    """她是否在本周恋爱焦点（系统算定，供事实块）。"""
    if not save or not character_id:
        return False
    from .cast_weights import pick_weekly_focus_ids
    from .china_calendar import week_index_for_day

    day = int(getattr(getattr(save, "calendar", None), "day_index", 1) or 1)
    week = week_index_for_day(day)
    romance_ids = [
        cid
        for cid, b in (getattr(save, "bonds", None) or {}).items()
        if getattr(b, "cast_kind", "") == "romance"
    ]
    if not romance_ids:
        return False
    return character_id in set(pick_weekly_focus_ids(romance_ids, week_index=week, count=2))
