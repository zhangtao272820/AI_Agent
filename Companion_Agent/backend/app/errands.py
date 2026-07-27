"""P11 共同待办：轻量帮她办事（模板，零批量 LLM）。"""

from __future__ import annotations

import json
import random
import uuid
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field

from .config import PROJECT_ROOT
from .memory import MemoryFact, merge_memories
from .world_store import WorldErrand, WorldSave


class ErrandDef(BaseModel):
    id: str
    label: str
    location_id: str = "store"
    ap_cost: int = 1
    money_cost: int = 0
    affinity_delta: int = 2
    trust_delta: int = 1
    tags: list[str] = Field(default_factory=list)
    ask_line: str = ""
    thanks_line: str = ""


class ErrandCatalog(BaseModel):
    version: int = 1
    errands: list[ErrandDef] = Field(default_factory=list)


@lru_cache(maxsize=1)
def load_errand_catalog() -> ErrandCatalog:
    path = PROJECT_ROOT / "data" / "errand_catalog.json"
    if not path.is_file():
        return ErrandCatalog()
    return ErrandCatalog.model_validate(json.loads(path.read_text(encoding="utf-8")))


def get_errand_def(errand_id: str) -> ErrandDef | None:
    for e in load_errand_catalog().errands:
        if e.id == errand_id:
            return e
    return None


def active_errand(save: WorldSave) -> WorldErrand | None:
    for row in save.errands:
        if row.status == "pending":
            return row
    return None


def expire_stale_errands(save: WorldSave) -> WorldSave:
    day = save.calendar.day_index
    changed = False
    for row in save.errands:
        if row.status == "pending" and int(row.day_assigned or 0) + 2 < day:
            row.status = "expired"
            changed = True
    if changed:
        save.errands = list(save.errands)
    return save


def maybe_assign_errand(save: WorldSave) -> WorldSave:
    """日终/早晨：若无进行中待办，对本周焦点掷骰派一件。"""
    save = expire_stale_errands(save)
    if active_errand(save):
        return save
    cat = load_errand_catalog()
    if not cat.errands:
        return save
    from .cast_weights import pick_weekly_focus_ids
    from .china_calendar import day_info

    info = day_info(save.calendar.day_index)
    romance = [
        cid
        for cid, b in save.bonds.items()
        if b.cast_kind == "romance" and int(b.relationship_state.affinity or 0) >= 38
    ]
    focus = pick_weekly_focus_ids(
        romance,
        week_index=int(info.get("week_index") or 1),
        count=2,
    )
    if not focus:
        return save
    rng = random.Random(f"errand-{save.calendar.day_index}-{focus[0]}")
    if rng.random() > 0.42:
        return save
    cid = focus[0]
    bond = save.bonds.get(cid)
    if not bond:
        return save
    edef = rng.choice(cat.errands)
    ask = (edef.ask_line or "").replace("{name}", bond.profile.name or "她")
    if not ask:
        ask = f"{bond.profile.name}拜托你：{edef.label}"
    row = WorldErrand(
        id=uuid.uuid4().hex[:10],
        errand_id=edef.id,
        character_id=cid,
        label=edef.label,
        location_id=edef.location_id,
        day_assigned=save.calendar.day_index,
        status="pending",
        ask_line=ask,
    )
    save.errands = (list(save.errands) + [row])[-6:]
    # 她侧记忆 + 可选 ping 提示
    fact = MemoryFact(
        text=f"她拜托他帮忙：{edef.label}。",
        source="system",
        tags=["errand", "daily_life"],
    )
    bond.memories = merge_memories(bond.memories, [fact])
    if not (bond.living.pending_ping or "").strip():
        bond.living.pending_ping = ask[:40]
        bond.living.pending_ping_kind = "soft"
    save.bonds[cid] = bond
    return save


def complete_errand(save: WorldSave) -> tuple[WorldSave, dict[str, Any]]:
    """在目标地点履约：扣 AP/钱，涨好感，写谢意记忆。"""
    save = expire_stale_errands(save)
    row = active_errand(save)
    if not row:
        return save, {"ok": False, "error": "当前没有待办"}
    edef = get_errand_def(row.errand_id)
    if not edef:
        return save, {"ok": False, "error": "未知待办"}
    if save.location_id != (edef.location_id or row.location_id):
        loc = edef.location_id or row.location_id
        return save, {"ok": False, "error": f"要去「{loc}」才能办这件事"}
    cost = max(0, int(edef.ap_cost or 1))
    if save.action_points < cost:
        return save, {"ok": False, "error": "心力不足"}
    # 故事优先：跑腿不扣金钱
    save.action_points -= cost
    bond = save.bonds.get(row.character_id)
    thanks = ""
    if bond:
        rel = bond.relationship_state
        aff = min(100, int(rel.affinity or 0) + int(edef.affinity_delta or 0))
        trust = min(100, max(0, int(rel.trust or 0) + int(edef.trust_delta or 0)))
        bond.relationship_state = rel.model_copy(update={"affinity": aff, "trust": trust})
        thanks = (edef.thanks_line or "她后来跟你说谢谢，语气软软的。").replace(
            "{name}", bond.profile.name or "她"
        )
        fact = MemoryFact(
            text=thanks,
            source="system",
            tags=["errand", "gratitude", "daily_life"],
        )
        bond.memories = merge_memories(bond.memories, [fact])
        save.bonds[row.character_id] = bond
    row.status = "done"
    save.errands = list(save.errands)
    return save, {
        "ok": True,
        "label": row.label,
        "character_id": row.character_id,
        "impression": thanks or f"办完了：{row.label}",
        "action_points": save.action_points,
    }


def errand_agenda_bits(save: WorldSave, character_id: str) -> tuple[str, str] | None:
    row = active_errand(save)
    if not row or row.character_id != character_id or row.status != "pending":
        return None
    return (
        f"心里惦记着拜托他办的事「{row.label}」，可旁敲侧击问进度，别催得太凶",
        row.ask_line or row.label,
    )


def errand_prompt_line(save: WorldSave, character_id: str) -> str:
    bits = errand_agenda_bits(save, character_id)
    if not bits:
        return ""
    _, hook = bits
    return f"\n【待办】{hook}。可用口语提一句，勿念系统字样。"


def public_active_errand(save: WorldSave) -> dict[str, Any] | None:
    save = expire_stale_errands(save)
    row = active_errand(save)
    if not row:
        return None
    bond = save.bonds.get(row.character_id)
    return {
        "id": row.id,
        "errand_id": row.errand_id,
        "character_id": row.character_id,
        "character_name": (bond.profile.name if bond else "") or row.character_id,
        "label": row.label,
        "location_id": row.location_id,
        "ask_line": row.ask_line,
        "can_complete_here": save.location_id == row.location_id,
        "day_assigned": row.day_assigned,
    }
