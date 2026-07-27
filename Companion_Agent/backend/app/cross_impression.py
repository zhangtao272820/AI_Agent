"""P5/P6：跨角色软印象（1 句，不泄全文）。"""

from __future__ import annotations

from .romance_policy import get_romance_policy, list_partners
from .world_store import WorldSave


def cross_character_impression(save: WorldSave, *, character_id: str) -> str:
    """
    男主与其他人互动后，当前角色可能听闻的软印象。
    只返回一句；无则空串。
    """
    bond = save.bonds.get(character_id)
    if not bond:
        return ""

    # P6：其他已确认伴侣优先（开放后宫张力）
    partners = list_partners(save, exclude_id=character_id)
    if partners and bond.cast_kind == "romance":
        who = "、".join(n for _, n in partners[:2])
        pol = get_romance_policy(character_id)
        if pol.rivalry == "withdraw":
            return f"隐约听说你和{who}走得很近"
        if pol.rivalry == "interfere":
            return f"有人说你最近和{who}挺亲密——你心里不是滋味"
        return f"听说你和{who}好像不只是朋友"

    # 最近传闻：关于「别人」且与玩家圈子相关
    for r in reversed(list(save.rumors or [])[-5:]):
        about = r.about_id or ""
        if about and about != character_id and about in save.bonds:
            name = save.bonds[about].profile.name or about
            text = (r.text or "").strip()
            if text:
                soft = text if len(text) <= 28 else text[:28] + "…"
                return f"听说{name}那边：{soft}"

    busy_names: list[str] = []
    for cid, other in save.bonds.items():
        if cid == character_id:
            continue
        flags = other.relationship_state.flags or {}
        if flags.get("dated_once") or flags.get("cafe_date_done") or flags.get("home_dinner"):
            if other.living.talked_day_index >= max(1, save.calendar.day_index - 3):
                busy_names.append(other.profile.name or cid)
        if len(busy_names) >= 2:
            break
    if busy_names:
        who = "、".join(busy_names[:2])
        return f"隐约听说你最近好像和{who}走得近"

    if save.protagonist.worked_day_index == save.calendar.day_index:
        return "听说你今天去公司忙了一天"
    return ""


def cross_impression_prompt_line(save: WorldSave, *, character_id: str) -> str:
    tip = cross_character_impression(save, character_id=character_id)
    if not tip:
        return ""
    return (
        f"\n【她听来的闲话】{tip}。"
        "可关心、吃味或装作不在意，勿当庭审，勿念系统字段。"
    )
