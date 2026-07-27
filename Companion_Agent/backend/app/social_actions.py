"""对话 Judge → 世界动作：预约约会/谈话、吵架、冷战、和解。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from .appointments import resolve_when_slot, schedule_appointment
from .life_friction import apply_missed_soft_cold
from .memory import MemoryFact, merge_memories
from .world_store import WorldSave, upsert_world_save


_PERIODS = {"morning", "afternoon", "evening", "night"}
_WHENS = {"now", "tonight", "tomorrow", "weekend", "lunch"}
_KINDS = {
    "schedule_date",
    "schedule_talk",
    "quarrel",
    "start_cold",
    "end_cold",
}


class SocialAction(BaseModel):
    kind: str = ""
    when: str | None = None
    period: str | None = None
    location_id: str | None = None
    date_id: str | None = None
    note: str = ""


def parse_social_action(raw: Any) -> SocialAction | None:
    if raw is None:
        return None
    if isinstance(raw, SocialAction):
        return raw if raw.kind in _KINDS else None
    if not isinstance(raw, dict):
        return None
    try:
        action = SocialAction.model_validate(raw)
    except Exception:
        return None
    kind = (action.kind or "").strip().lower()
    if kind not in _KINDS:
        return None
    when = (action.when or "").strip().lower() or None
    if when and when not in _WHENS:
        when = None
    period = (action.period or "").strip().lower() or None
    if period and period not in _PERIODS:
        period = None
    return action.model_copy(
        update={
            "kind": kind,
            "when": when,
            "period": period,
            "location_id": (action.location_id or "").strip() or None,
            "date_id": (action.date_id or "").strip() or None,
            "note": (action.note or "").strip()[:28],
        }
    )


def _pick_date(
    save: WorldSave,
    character_id: str,
    *,
    date_id: str | None,
    location_id: str | None,
) -> tuple[str, str, str] | None:
    """返回 (date_id, label, location_id)；无可约会时 None。"""
    from .world_engine import get_date_def, list_available_dates

    available = [
        d
        for d in list_available_dates(save, character_id)
        if not d.get("soft_reject")
    ]
    if not available:
        return None
    if date_id:
        hit = next((d for d in available if d["id"] == date_id), None)
        if hit:
            ddef = get_date_def(date_id)
            return (
                date_id,
                str(hit.get("label") or (ddef.label if ddef else "约会")),
                str(hit.get("location_id") or (ddef.location_id if ddef else "") or location_id or save.location_id),
            )
    if location_id:
        here = [d for d in available if d.get("location_id") == location_id]
        if here:
            available = here
    pick = available[0]
    ddef = get_date_def(str(pick["id"]))
    return (
        str(pick["id"]),
        str(pick.get("label") or (ddef.label if ddef else "约会")),
        str(pick.get("location_id") or (ddef.location_id if ddef else "") or save.location_id),
    )


def _schedule_slot(
    save: WorldSave,
    *,
    character_id: str,
    date_id: str,
    label: str,
    location_id: str,
    when: str | None,
    period: str | None,
) -> tuple[WorldSave, dict[str, Any]]:
    w = (when or "tomorrow").strip().lower()
    if w == "now":
        return save, {
            "ok": True,
            "deferred_now": True,
            "ask_date": {
                "character_id": character_id,
                "date_id": date_id,
                "when": "now",
            },
            "note": "想现在就约——结束对话后可以从地点页立刻出发。",
            "kind": "schedule_date",
        }
    ov = period if period in _PERIODS else None
    if ov and w in {"tomorrow", "weekend", "tonight"}:
        slot = resolve_when_slot(save, w, period_override=ov)
        if not slot:
            return save, {"ok": False, "error": "无法解析预约时段", "kind": "schedule_date"}
        day_i, per = slot
        return schedule_appointment(
            save,
            character_id=character_id,
            date_id=date_id,
            label=label,
            location_id=location_id,
            when=w,
            target_day=day_i,
            target_period=per,
        )
    return schedule_appointment(
        save,
        character_id=character_id,
        date_id=date_id,
        label=label,
        location_id=location_id,
        when=w,
    )


def apply_social_action(
    save: WorldSave,
    *,
    character_id: str,
    action: SocialAction | dict[str, Any] | None,
    affinity_delta: int = 0,
    trust_delta: int = 0,
) -> tuple[WorldSave, dict[str, Any]]:
    """
    将 Judge 的 social_action 落到世界存档。
    返回 result 含 ok / note / error / kind / appointment 摘要等，供 WS UI。
    """
    parsed = parse_social_action(action)
    if not parsed:
        return save, {"ok": False, "skipped": True, "error": "无有效社会动作"}

    bond = save.bonds.get(character_id)
    if not bond:
        return save, {"ok": False, "error": "还不认识她", "kind": parsed.kind}

    kind = parsed.kind
    note = parsed.note

    if kind == "schedule_date":
        picked = _pick_date(
            save,
            character_id,
            date_id=parsed.date_id,
            location_id=parsed.location_id,
        )
        if not picked:
            return save, {
                "ok": False,
                "error": "现在还约不到合适的行程",
                "kind": kind,
            }
        date_id, label, loc = picked
        save, result = _schedule_slot(
            save,
            character_id=character_id,
            date_id=date_id,
            label=label,
            location_id=loc,
            when=parsed.when,
            period=parsed.period,
        )
        if not result.get("ok"):
            return save, {**result, "kind": kind}
        scheduled = result.get("scheduled") or {}
        impression = str(scheduled.get("impression") or note or f"约好了：{label}")
        out = {
            **result,
            "kind": kind,
            "note": impression,
            "ui_tone": "warm",
        }
        return save, out

    if kind == "schedule_talk":
        loc = (parsed.location_id or save.location_id or "cafe").strip()
        label = "谈话"
        w = (parsed.when or "tomorrow").strip().lower()
        if w == "now":
            return save, {
                "ok": True,
                "deferred_now": True,
                "kind": kind,
                "note": note or "想现在谈谈——结束对话后可以再找她聊聊。",
                "ui_tone": "warm",
            }
        ov = parsed.period if parsed.period in _PERIODS else None
        if ov and w in {"tomorrow", "weekend", "tonight"}:
            slot = resolve_when_slot(save, w, period_override=ov)
            if not slot:
                return save, {"ok": False, "error": "无法解析谈话时段", "kind": kind}
            day_i, per = slot
            save, result = schedule_appointment(
                save,
                character_id=character_id,
                date_id="",
                label=label,
                location_id=loc,
                when=w,
                target_day=day_i,
                target_period=per,
            )
        else:
            save, result = schedule_appointment(
                save,
                character_id=character_id,
                date_id="",
                label=label,
                location_id=loc,
                when=w,
            )
        if not result.get("ok"):
            return save, {**result, "kind": kind}
        scheduled = result.get("scheduled") or {}
        impression = str(scheduled.get("impression") or note or "约好了再谈一次。")
        return save, {**result, "kind": kind, "note": impression, "ui_tone": "warm"}

    if kind == "quarrel":
        rel = bond.relationship_state
        flags = dict(rel.flags or {})
        flags["recent_quarrel"] = True
        bond.relationship_state = rel.model_copy(
            update={
                "affinity": max(0, rel.affinity - 4),
                "trust": max(0, rel.trust - 5),
                "mood": max(-100, rel.mood - 18),
                "flags": flags,
            }
        )
        until = save.calendar.day_index + 2
        bond = apply_missed_soft_cold(bond, until_day=until)
        fact = MemoryFact(
            text=note or "你们吵了一架，气氛一下子冷下来。",
            source="system",
            tags=["quarrel", "daily_life", "soft_cold"],
        )
        bond.memories = merge_memories(bond.memories, [fact])
        save.bonds[character_id] = bond
        upsert_world_save(save)
        return save, {
            "ok": True,
            "kind": kind,
            "note": note or "气氛降下来了。",
            "ui_tone": "cold",
            "agenda": {
                "goal": "别装作没事；话可以硬一点，若他真诚道歉再稍稍松口",
                "hook": "刚才吵过",
                "source": "quarrel",
            },
            "relationship_patch": True,
        }

    if kind == "start_cold":
        rel = bond.relationship_state
        flags = dict(rel.flags or {})
        flags["cold_war_active"] = True
        bond.relationship_state = rel.model_copy(
            update={
                "mood": max(-100, rel.mood - 12),
                "trust": max(0, rel.trust - 3),
                "flags": flags,
            }
        )
        until = save.calendar.day_index + 7
        bond = apply_missed_soft_cold(bond, until_day=until)
        fact = MemoryFact(
            text=note or "你们进入了冷战，话变少了。",
            source="system",
            tags=["cold_war", "daily_life"],
        )
        bond.memories = merge_memories(bond.memories, [fact])
        save.bonds[character_id] = bond
        upsert_world_save(save)
        return save, {
            "ok": True,
            "kind": kind,
            "note": note or "气氛降到冰点。",
            "ui_tone": "cold",
            "agenda": {
                "goal": "保持疏离与礼貌距离；勿主动热情，除非他认真和解",
                "hook": "冷战中",
                "source": "cold",
            },
            "relationship_patch": True,
        }

    if kind == "end_cold":
        flags = dict(bond.relationship_state.flags or {})
        if not flags.get("cold_war_active") and not (
            int(bond.living.soft_cold_until_day or 0) >= save.calendar.day_index
        ):
            return save, {
                "ok": False,
                "error": "现在并没有在冷战",
                "kind": kind,
            }
        # 空话和解：本轮需有正向数值意图（由调用方传入）
        if affinity_delta <= 0 and trust_delta <= 0:
            return save, {
                "ok": False,
                "error": "她还不相信这算和解",
                "kind": kind,
            }
        flags.pop("cold_war_active", None)
        flags.pop("recent_quarrel", None)
        flags.pop("recently_stood_up", None)
        rel = bond.relationship_state
        bond.relationship_state = rel.model_copy(
            update={
                "trust": min(100, rel.trust + 3),
                "mood": min(100, rel.mood + 8),
                "flags": flags,
            }
        )
        bond.living.soft_cold_until_day = 0
        fact = MemoryFact(
            text=note or "冷战松动了，气氛缓和了一些。",
            source="system",
            tags=["cold_war", "reconcile", "daily_life"],
        )
        bond.memories = merge_memories(bond.memories, [fact])
        save.bonds[character_id] = bond
        upsert_world_save(save)
        return save, {
            "ok": True,
            "kind": kind,
            "note": note or "冷战松动了。",
            "ui_tone": "warm",
            "agenda": {
                "goal": "气氛刚缓和，可以慢慢聊开，别立刻逼问",
                "hook": "和解之后",
                "source": "chat",
            },
            "relationship_patch": True,
        }

    return save, {"ok": False, "error": "未知社会动作", "kind": kind}
