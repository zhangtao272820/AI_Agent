"""约会预约：约将来 / 赴约 / 爽约（P4）。"""

from __future__ import annotations

import uuid
from typing import Any

from .china_calendar import day_info
from .memory import MemoryFact, merge_memories
from .world_store import WorldAppointment, WorldSave, upsert_world_save


_PERIOD_ORDER = ["morning", "afternoon", "evening", "night"]


def prune_appointments(save: WorldSave, *, keep: int = 12) -> WorldSave:
    pending = [a for a in save.appointments if a.status == "pending"]
    done = [a for a in save.appointments if a.status != "pending"]
    # 保留全部 pending + 最近完成/错过
    done_sorted = sorted(done, key=lambda a: a.day_index, reverse=True)
    save.appointments = (pending + done_sorted)[:keep]
    return save


def public_appointments(save: WorldSave, *, limit: int = 6) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in sorted(
        [x for x in save.appointments if x.status == "pending"],
        key=lambda x: (x.day_index, _PERIOD_ORDER.index(x.period) if x.period in _PERIOD_ORDER else 9),
    ):
        bond = save.bonds.get(a.character_id)
        info = day_info(a.day_index)
        kind = (a.kind or ("talk" if not a.date_id else "date")).strip() or "date"
        out.append(
            {
                "id": a.id,
                "character_id": a.character_id,
                "character_name": (bond.profile.name if bond else a.character_id),
                "day_index": a.day_index,
                "period": a.period,
                "period_label": {"morning": "早晨", "afternoon": "下午", "evening": "傍晚", "night": "夜晚"}.get(
                    a.period, a.period
                ),
                "location_id": a.location_id,
                "label": a.label,
                "date_id": a.date_id,
                "kind": kind,
                "status": a.status,
                "date_label": info.get("label") or "",
                "weekday_label": info.get("weekday_label") or "",
                "due_today": a.day_index == save.calendar.day_index,
                "fulfillable": (
                    a.day_index == save.calendar.day_index
                    and a.period == save.calendar.period
                    and (not a.location_id or a.location_id == save.location_id)
                ),
            }
        )
        if len(out) >= limit:
            break
    return out


def resolve_when_slot(
    save: WorldSave,
    when: str,
    *,
    period_override: str | None = None,
) -> tuple[int, str] | None:
    """
    when: now | tonight | tomorrow | weekend | lunch
    返回 (target_day_index, period)；now 返回 None（调用方走即时约会）。
    period_override：合法时段时覆盖默认 period（主要用于 tomorrow）。
    """
    w = (when or "now").strip().lower()
    if w in {"", "now"}:
        return None
    cur = save.calendar.day_index
    period = save.calendar.period
    info = day_info(cur)
    weekday = int(info["weekday"])
    ov = (period_override or "").strip().lower()
    if ov not in _PERIOD_ORDER:
        ov = ""

    if w == "lunch":
        # 午饭槽：仅 afternoon；若已过下午则约明天中午
        if period in {"morning"}:
            return cur, "afternoon"
        if period == "afternoon":
            return cur, "afternoon"
        return cur + 1, "afternoon"

    if w == "tonight":
        if period in {"evening", "night"}:
            return cur, "night" if period == "evening" else "night"
        return cur, "evening"

    if w == "tomorrow":
        return cur + 1, ov or "evening"

    if w == "weekend":
        # 下一个周六 evening（若今天已是周六且还早，用今天；已过周六晚则下周六）
        if weekday == 6 and period in {"morning", "afternoon", "evening"}:
            return cur, ov or "evening"
        if weekday == 7:
            # 周日 → 下周六
            return cur + 6, ov or "evening"
        # Mon=1 … Fri=5 → 本周六
        days_until_sat = 6 - weekday
        return cur + days_until_sat, ov or "evening"

    return None


def schedule_appointment(
    save: WorldSave,
    *,
    character_id: str,
    date_id: str,
    label: str,
    location_id: str,
    when: str = "weekend",
    target_day: int | None = None,
    target_period: str | None = None,
) -> tuple[WorldSave, dict[str, Any]]:
    bond = save.bonds.get(character_id)
    if not bond:
        return save, {"ok": False, "error": "还不认识她"}

    if target_day is not None and target_period:
        day_i = int(target_day)
        period = target_period
    else:
        slot = resolve_when_slot(save, when)
        if not slot:
            return save, {"ok": False, "error": "请用即时约会，或指定 tonight/tomorrow/weekend"}
        day_i, period = slot

    if day_i < save.calendar.day_index:
        return save, {"ok": False, "error": "不能约已经过去的日子"}
    if day_i == save.calendar.day_index:
        cur_i = _PERIOD_ORDER.index(save.calendar.period) if save.calendar.period in _PERIOD_ORDER else 0
        tgt_i = _PERIOD_ORDER.index(period) if period in _PERIOD_ORDER else 2
        if tgt_i < cur_i:
            return save, {"ok": False, "error": "这个时段已经过了"}

    # 同角色同时段不重复 pending
    for a in save.appointments:
        if (
            a.status == "pending"
            and a.character_id == character_id
            and a.day_index == day_i
            and a.period == period
        ):
            return save, {"ok": False, "error": "已经约过这个时间了"}

    # 长期状态冲突
    if bond.living.long_status in {"trip", "exam_week", "sick"}:
        until = int(bond.living.long_status_until_day or 0)
        if until >= day_i:
            return save, {"ok": False, "error": "她这阵子不太方便赴约"}

    period_label = {
        "evening": "傍晚",
        "night": "夜里",
        "afternoon": "下午",
        "morning": "早上",
    }.get(period, period)
    info = day_info(day_i)
    day_label = info.get("label") or f"第{day_i}天"

    # 跨角色同时段：允许预约，但记冲突摩擦（时间冲突=剧情）
    conflict: dict[str, Any] | None = None
    other_pending = [
        a
        for a in save.appointments
        if a.status == "pending"
        and a.character_id != character_id
        and a.day_index == day_i
        and a.period == period
    ]
    if other_pending:
        other = other_pending[0]
        other_bond = save.bonds.get(other.character_id)
        other_name = other_bond.profile.name if other_bond else other.character_id
        conflict = {
            "other_id": other.character_id,
            "other_name": other_name,
            "label": other.label,
            "day_index": day_i,
            "period": period,
        }
        save.world_flags[f"schedule_clash:{day_i}:{period}"] = True
        # 双方记忆 + 冲突标记
        clash_fact_new = MemoryFact(
            text=(
                f"他好像在{day_label}{period_label}还约了{other_name}。"
                "你心里有点不是滋味，但先看他怎么选。"
            ),
            source="system",
            tags=["appointment", "schedule_clash", "daily_life"],
        )
        bond.memories = merge_memories(bond.memories, [clash_fact_new])
        flags_new = dict(bond.relationship_state.flags or {})
        flags_new["schedule_clash_pending"] = True
        bond.relationship_state = bond.relationship_state.model_copy(update={"flags": flags_new})
        if other_bond:
            clash_fact_other = MemoryFact(
                text=(
                    f"听说他{day_label}{period_label}又约了别人——"
                    f"和你们的「{other.label}」撞档了。"
                ),
                source="system",
                tags=["appointment", "schedule_clash", "daily_life"],
            )
            other_bond.memories = merge_memories(other_bond.memories, [clash_fact_other])
            flags_o = dict(other_bond.relationship_state.flags or {})
            flags_o["schedule_clash_pending"] = True
            other_bond.relationship_state = other_bond.relationship_state.model_copy(
                update={"flags": flags_o}
            )
            save.bonds[other.character_id] = other_bond

    ap_kind = "talk" if not date_id else "date"
    ap = WorldAppointment(
        id=uuid.uuid4().hex[:12],
        character_id=character_id,
        day_index=day_i,
        period=period,
        location_id=location_id,
        label=label or ("谈话" if ap_kind == "talk" else "约会"),
        date_id=date_id or "",
        kind=ap_kind,
        status="pending",
    )
    save.appointments.append(ap)
    save = prune_appointments(save)
    fact = MemoryFact(
        text=f"你们约了{day_label}{period_label}见面（{ap.label}）。",
        source="system",
        tags=["appointment", "daily_life"],
    )
    bond.memories = merge_memories(bond.memories, [fact])
    save.bonds[character_id] = bond
    upsert_world_save(save)
    impression = f"约好了：{day_label}再见面。"
    if conflict:
        impression = (
            f"约好了——可你{period_label}好像还约了{conflict['other_name']}。"
            "到时候只能选一边。"
        )
    out: dict[str, Any] = {
        "ok": True,
        "appointment": public_appointments(save, limit=20),
        "scheduled": {
            "id": ap.id,
            "day_index": ap.day_index,
            "period": ap.period,
            "label": ap.label,
            "date_label": info.get("label") or "",
            "impression": impression,
        },
    }
    if conflict:
        out["conflict"] = conflict
    return save, out


def mark_missed_appointments(save: WorldSave) -> WorldSave:
    """日终：凡 day_index < 新当天 的 pending → missed，轻伤关系 + 一周 soft cold。"""
    from .life_friction import apply_missed_soft_cold

    cur = save.calendar.day_index
    for a in save.appointments:
        if a.status != "pending":
            continue
        if a.day_index < cur:
            a.status = "missed"
            bond = save.bonds.get(a.character_id)
            if bond:
                rel = bond.relationship_state
                bond.relationship_state = rel.model_copy(
                    update={
                        "affinity": max(0, rel.affinity - 2),
                        "trust": max(0, rel.trust - 1),
                        "mood": max(-100, rel.mood - 8),
                    }
                )
                fact = MemoryFact(
                    text=f"你们约好的「{a.label}」你没去，她有些失落。这周她可能不太想见你。",
                    source="system",
                    tags=["appointment", "missed", "soft_cold"],
                )
                bond.memories = merge_memories(bond.memories, [fact])
                bond = apply_missed_soft_cold(bond, until_day=cur + 6)
                save.bonds[a.character_id] = bond
    save = prune_appointments(save)
    return save


def fulfill_appointment(
    save: WorldSave,
    *,
    appointment_id: str,
) -> tuple[WorldSave, dict[str, Any]]:
    """赴约：标记 done，返回 date_id 供上层开约会会话。"""
    ap = next((a for a in save.appointments if a.id == appointment_id), None)
    if not ap or ap.status != "pending":
        return save, {"ok": False, "error": "没有这笔预约"}
    if ap.day_index != save.calendar.day_index:
        return save, {"ok": False, "error": "还没到约定那天"}
    if ap.period != save.calendar.period:
        return save, {"ok": False, "error": "还没到约定时段"}
    if ap.location_id and save.location_id != ap.location_id:
        return save, {"ok": False, "error": "要先到约定地点"}

    ap.status = "done"
    # 同日同时段另有 pending：对方会感到被放鸽子倾向（日终 mark_missed）；赴约方清自己的冲突旗
    bond = save.bonds.get(ap.character_id)
    if bond:
        flags = dict(bond.relationship_state.flags or {})
        flags.pop("schedule_clash_pending", None)
        bond.relationship_state = bond.relationship_state.model_copy(update={"flags": flags})
        save.bonds[ap.character_id] = bond
    rivals = [
        a
        for a in save.appointments
        if a.status == "pending"
        and a.id != ap.id
        and a.day_index == ap.day_index
        and a.period == ap.period
        and a.character_id != ap.character_id
    ]
    for rival in rivals:
        rb = save.bonds.get(rival.character_id)
        if not rb:
            continue
        name = bond.profile.name if bond else "别人"
        fact = MemoryFact(
            text=f"他在你们约定的时段去见了{name}，没来赴你们的约。心里有点堵。",
            source="system",
            tags=["appointment", "schedule_clash", "stood_aside"],
        )
        rb.memories = merge_memories(rb.memories, [fact])
        rf = dict(rb.relationship_state.flags or {})
        rf["schedule_clash_stood_aside"] = True
        rb.relationship_state = rb.relationship_state.model_copy(update={"flags": rf})
        save.bonds[rival.character_id] = rb

    kind = (ap.kind or ("talk" if not ap.date_id else "date")).strip() or "date"
    upsert_world_save(save)
    return save, {
        "ok": True,
        "appointment_id": ap.id,
        "character_id": ap.character_id,
        "date_id": ap.date_id,
        "kind": kind,
        "label": ap.label,
        "location_id": ap.location_id,
        "left_pending": [
            {"character_id": r.character_id, "label": r.label} for r in rivals
        ],
    }


def date_slots_public(save: WorldSave) -> list[dict[str, Any]]:
    """地点页可选的预约时机。"""
    tonight = resolve_when_slot(save, "tonight")
    tomorrow = resolve_when_slot(save, "tomorrow")
    weekend = resolve_when_slot(save, "weekend")
    lunch = resolve_when_slot(save, "lunch")
    slots = [
        {"id": "now", "label": "现在就约", "when": "now"},
    ]
    if lunch:
        same = lunch[0] == save.calendar.day_index
        slots.append(
            {
                "id": "lunch",
                "label": f"{'午饭' if same else '明天午饭'}（短约）",
                "when": "lunch",
                "day_index": lunch[0],
                "period": lunch[1],
                "note": "短时长、低花费，适合教时段",
            }
        )
    if tonight:
        info = day_info(tonight[0])
        slots.append(
            {
                "id": "tonight",
                "label": f"今晚（{info.get('weekday_label') and '周'+info['weekday_label'] or ''}傍晚）",
                "when": "tonight",
                "day_index": tonight[0],
                "period": tonight[1],
            }
        )
    if tomorrow:
        info = day_info(tomorrow[0])
        slots.append(
            {
                "id": "tomorrow",
                "label": f"明天（{info.get('month')}月{info.get('day')}日晚）",
                "when": "tomorrow",
                "day_index": tomorrow[0],
                "period": tomorrow[1],
            }
        )
    if weekend:
        info = day_info(weekend[0])
        slots.append(
            {
                "id": "weekend",
                "label": f"本周末（{info.get('month')}月{info.get('day')}日晚）",
                "when": "weekend",
                "day_index": weekend[0],
                "period": weekend[1],
            }
        )
    return slots
