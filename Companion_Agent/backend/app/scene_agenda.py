"""P5：本场软轨道议程（模板，不调 LLM）。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .china_calendar import anniversary_match, day_info
from .world_store import BondShelf, WorldSave


class SceneAgenda(BaseModel):
    goal: str = ""
    hook: str = ""
    soft_choices_hint: bool = True
    source: str = ""  # appointment|quest|festival|longing|anniversary|date|chat


def build_scene_agenda(
    save: WorldSave | None,
    *,
    character_id: str,
    bond: BondShelf | None,
    date_mode: bool = False,
    quest_snip: str = "",
    cold_input_streak: int = 0,
    present_ids: list[str] | None = None,
) -> SceneAgenda:
    if not save or not bond:
        return SceneAgenda(
            goal="自然聊天，留意对方心情",
            hook="日常碰面",
            source="chat",
        )

    day = save.calendar.day_index
    info = day_info(day)
    fest = str(info.get("festival") or "")
    talked = int(bond.living.talked_day_index or 0)
    days_since = (day - talked) if talked else 0
    flags = bond.relationship_state.flags or {}

    # 0) 档期冲突：被晾在一边（压过未赴预约提示）
    if flags.get("schedule_clash_stood_aside"):
        return SceneAgenda(
            goal="委婉提起他好像同时约了别人，看他怎么解释；别一上来就翻脸",
            hook="听说你同时段另有安排",
            source="rivalry",
        )

    # 0b) 刚吵过 / 冷战旗
    if flags.get("recent_quarrel"):
        return SceneAgenda(
            goal="别装作没事；话可以硬一点，若他真诚道歉再稍稍松口",
            hook="刚才吵过",
            source="quarrel",
        )
    if flags.get("cold_war_active"):
        return SceneAgenda(
            goal="保持疏离与礼貌距离；勿主动热情，除非他认真和解",
            hook="冷战中",
            source="cold",
        )

    # 1) 未赴预约
    pending = [
        a
        for a in save.appointments
        if a.status == "pending" and a.character_id == character_id
    ]
    if pending:
        a0 = sorted(pending, key=lambda x: x.day_index)[0]
        ainfo = day_info(a0.day_index)
        return SceneAgenda(
            goal=f"提起或确认「{a0.label}」的约定，看他是否当真",
            hook=f"你们约了{ainfo.get('label') or ''}见面",
            source="appointment",
        )

    # 2) 爽约冷淡长尾
    from .life_friction import is_soft_cold, silence_agenda, stingy_agenda_bits

    if is_soft_cold(bond, day):
        return SceneAgenda(
            goal="保持礼貌距离，话少一点；若他真诚道歉可稍微松口，别立刻热情",
            hook="这周她还记得被放鸽子的事",
            source="cold",
        )

    # 2a) 档期冲突：他还同时约了别人（未决）
    if flags.get("schedule_clash_pending"):
        return SceneAgenda(
            goal="旁敲侧击确认他今晚是不是还约了别人，话里带点试探",
            hook="总觉得他的时间表有点满",
            source="rivalry",
        )

    # 2b) 消费摩擦
    stingy = stingy_agenda_bits(bond)
    if stingy:
        goal, hook = stingy
        return SceneAgenda(goal=goal, hook=hook, source="spend")

    # 2c) 共同待办
    from .errands import errand_agenda_bits

    errand = errand_agenda_bits(save, character_id)
    if errand:
        goal, hook = errand
        return SceneAgenda(goal=goal, hook=hook, source="errand")

    # 2d) 连续敷衍输入 → 沉默（不压过预约/冷淡/消费/待办）
    if int(cold_input_streak or 0) >= 2:
        goal, hook = silence_agenda()
        return SceneAgenda(goal=goal, hook=hook, source="silence")

    # 3) 多线/后宫张力（开放后宫下的 rivalry）
    if bond.cast_kind == "romance":
        from .romance_policy import rivalry_agenda_for

        rival = rivalry_agenda_for(save, character_id=character_id, bond=bond)
        if rival:
            goal, hook = rival
            return SceneAgenda(goal=goal, hook=hook, source="rivalry")

    # 4) 约会模式
    if date_mode:
        return SceneAgenda(
            goal="享受这次见面，试探彼此心意，留下一个小约定或印象",
            hook="眼下正在约会",
            soft_choices_hint=True,
            source="date",
        )

    # 5) 节日
    if fest:
        return SceneAgenda(
            goal=f"用过节的气氛聊两句，可提一起过或各回各家，不必硬送礼，感受他是否记得「{fest}」",
            hook=f"今天是{fest}",
            source="festival",
        )

    # 6) 纪念日
    if bond.living.first_date_day and anniversary_match(day, bond.living.first_date_day):
        return SceneAgenda(
            goal="心里有点软，想旁敲侧击提起‘好像有一天也是这种天气’，看他记不记得",
            hook="某个重要见面的同月同日",
            source="anniversary",
        )

    # 7) 久未见 / 倒追意图
    from .romance_policy import get_romance_policy

    pol = get_romance_policy(character_id)
    if days_since >= 3:
        return SceneAgenda(
            goal="委婉问问他这段时间都忙什么，别兴师问罪",
            hook="好像有一阵子没好好聊了",
            source="longing",
        )
    if (
        pol.confess_init
        and pol.pursuit == "pursues"
        and not (bond.relationship_state.flags or {}).get("confessed")
        and bond.relationship_state.affinity >= 65
        and bond.relationship_state.stage_id in {"crush", "close_friend", "dating"}
    ):
        return SceneAgenda(
            goal="心里已经有点动了，想找机会试探或轻轻表白，看他接不接得住",
            hook="最近见面时心跳有点快",
            source="pursuit",
        )

    # 8) quest 有当前步
    if (quest_snip or "").strip():
        short = quest_snip.strip().split("\n")[0][:60]
        return SceneAgenda(
            goal="把谈话轻轻导向当前想确认的小事",
            hook=short,
            source="quest",
        )

    # 9) 同场张力 / 有边第三人 → ensemble（可忽略软选项）
    if present_ids and len(present_ids) >= 2:
        from .social_life import ensemble_tension_present

        if ensemble_tension_present(save, character_id=character_id, present_ids=present_ids):
            others = [cid for cid in present_ids if cid != character_id]
            other_name = ""
            if others:
                ob = save.bonds.get(others[0])
                other_name = ob.profile.name if ob else others[0]
            return SceneAgenda(
                goal="留意旁边也在场的人，可用一两句带过，别抢主戏；若他提起可顺着回应",
                hook=f"{other_name}也在附近" if other_name else "旁边还有别人",
                source="ensemble",
            )

    return SceneAgenda(
        goal="轻松闲聊，观察他今天状态，不必强推话题",
        hook="日常碰面",
        source="chat",
    )


def agenda_prompt_block(agenda: SceneAgenda, *, pullback: bool = False) -> str:
    if not (agenda.goal or "").strip():
        return ""
    pull = ""
    if pullback:
        pull = "他刚才有点跑题：她想把话轻轻拉回正事，不要说教。"
    choices = (
        "合适时可给 2~3 个短【选项】作开场提示；他自由打字与点选项等价，不必逼选，选项不单独改好感。"
        if agenda.soft_choices_hint
        else ""
    )
    return (
        f"\n【本场议程】她心里想：{agenda.goal.strip()}。"
        f"由头：{agenda.hook.strip() or '当下心情'}。"
        f"{pull}"
        f"{choices}"
        "用对话自然推进，禁止念出「议程/flag/系统」字样。"
        "禁止主持人口吻：不要问「想聊什么话题」「有什么想说的吗」这类空话；"
        "像真人见面，从眼前、近况或议程由头接下去。"
    )
