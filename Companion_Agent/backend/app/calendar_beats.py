"""社群日历硬事件（模板）：每周一条，改出没/罗盘，不调 LLM。"""

from __future__ import annotations

import random
from typing import Any

from .china_calendar import day_info
from .world_store import WorldSave, upsert_world_save

# 轮转节拍：按周序号取模
_BEATS: list[dict[str, Any]] = [
    {
        "id": "exam_push",
        "kind": "festival",
        "label": "考试周",
        "text": "这周校园考试偏紧，图书馆与教室更挤，有人未必闲得下来。",
        "status": "exam_week",
        "status_days": 2,
        "cast_filter": "studentish",
    },
    {
        "id": "overtime_wave",
        "kind": "work",
        "label": "加班潮",
        "text": "公司这边加班的人变多了，傍晚办公室未必见得到她。",
        "status": None,
        "busy_work": True,
    },
    {
        "id": "rainy_lull",
        "kind": "rest",
        "label": "阴雨静周",
        "text": "这周天气黏糊，街上人少，适合找人慢慢聊。",
        "status": None,
    },
    {
        "id": "festival_prep",
        "kind": "festival",
        "label": "节庆筹备",
        "text": "镇上在张罗小活动，咖啡店与街道更热闹些。",
        "status": None,
    },
]


def _week_key(day_index: int) -> str:
    info = day_info(day_index)
    week = int(info.get("week_index") or max(1, (day_index - 1) // 7 + 1))
    return f"week_beat:{week}"


def current_week_beat(day_index: int) -> dict[str, Any]:
    info = day_info(day_index)
    week = int(info.get("week_index") or max(1, (day_index - 1) // 7 + 1))
    beat = dict(_BEATS[(week - 1) % len(_BEATS)])
    beat["week_index"] = week
    return beat


def ensure_week_beat(save: WorldSave) -> WorldSave:
    """每周首次进入（或翻日）时落一次状态；幂等。"""
    day = int(save.calendar.day_index or 1)
    key = _week_key(day)
    if save.world_flags.get(key):
        return save
    beat = current_week_beat(day)
    save.world_flags[key] = True
    save.world_flags["active_week_beat"] = True
    # 记当前 beat id，供罗盘读取
    save.world_flags[f"beat_id:{beat['id']}"] = True

    status = beat.get("status")
    if status:
        romance_ids = [cid for cid, b in save.bonds.items() if b.cast_kind == "romance"]
        rng = random.Random(f"{key}|status")
        picks = romance_ids[:]
        rng.shuffle(picks)
        until = day + int(beat.get("status_days") or 2) - 1
        for cid in picks[:2]:
            bond = save.bonds[cid]
            if not bond.living.long_status:
                bond.living.long_status = str(status)
                bond.living.long_status_until_day = until
                save.bonds[cid] = bond

    upsert_world_save(save)
    return save


def week_beat_suggestion(save: WorldSave) -> dict[str, str] | None:
    day = int(save.calendar.day_index or 1)
    if not save.world_flags.get(_week_key(day)) and not save.world_flags.get("active_week_beat"):
        # 尚未 ensure 时仍可预览文案
        pass
    beat = current_week_beat(day)
    return {
        "kind": str(beat.get("kind") or "guide"),
        "text": str(beat.get("text") or ""),
        "target_id": "",
        "label": str(beat.get("label") or ""),
    }


def public_week_beat(save: WorldSave) -> dict[str, Any]:
    beat = current_week_beat(int(save.calendar.day_index or 1))
    return {
        "id": beat.get("id"),
        "label": beat.get("label"),
        "text": beat.get("text"),
        "week_index": beat.get("week_index"),
    }
