"""晨间简报、邮件分拣、会前准备、周报（国内办公场景复合工具）。"""
from __future__ import annotations

import datetime

from app.core.config import settings
from app.core.time_utils import local_now_aware, utc_naive_to_local_naive
from app.core.user_preferences import get_user_preferences
from app.tools.common import _tool_err, _tool_ok
from app.tools import calendar, email, tasks, weather, notes, knowledge


def _pref_city(session_id: str = "default") -> str:
    prefs = get_user_preferences(session_id)
    return str(prefs.get("default_weather_city") or "").strip()


def daily_briefing(city: str = "", session_id: str = "default", include_emails: bool = True) -> dict:
    """聚合天气 + 今日日程 + 待办 +（可选）未读邮件摘要。"""
    now = local_now_aware()
    lines = [f"📋 **{now.strftime('%Y年%m月%d日')} 晨间简报**", ""]

    c = (city or _pref_city(session_id) or "").strip()
    if c:
        w = weather.get_weather(c, "today", session_id)
        wtext = w.get("human_message", str(w)) if isinstance(w, dict) else str(w)
        lines.extend(["**天气**", wtext, ""])
    else:
        lines.extend(["**天气**", "（未设置默认城市，可说「北京天气」或告诉我常住城市）", ""])

    ev = calendar.list_events()
    etext = ev.get("human_message", str(ev)) if isinstance(ev, dict) else str(ev)
    lines.extend(["**日程**", etext, ""])

    tk = tasks.list_tasks()
    ttext = tk.get("human_message", str(tk)) if isinstance(tk, dict) else str(tk)
    lines.extend(["**待办**", ttext, ""])

    email_summary = ""
    if include_emails and (settings.IMAP_USER or settings.SMTP_USER):
        em = email.list_emails(limit=5)
        et = em.get("human_message", str(em)) if isinstance(em, dict) else str(em)
        email_summary = et
        lines.extend(["**最近邮件**", et, ""])
    elif include_emails:
        lines.extend(["**邮件**", "（IMAP 未配置，跳过邮件摘要）", ""])

    body = "\n".join(lines).strip()
    return _tool_ok(
        body,
        data={"city": c or None, "has_email": bool(email_summary), "date": now.strftime("%Y-%m-%d")},
        code="briefing_ok",
    )


def triage_emails(limit: int = 20, session_id: str = "default") -> dict:
    """列出并分类邮件，给出优先级建议。"""
    if not (settings.IMAP_USER or settings.SMTP_USER):
        return _tool_err(
            "邮件分拣需要配置 IMAP/SMTP（.env 中 IMAP_USER / SMTP_USER）。",
            code="imap_not_configured",
        )
    listed = email.list_emails(limit=max(5, min(int(limit or 20), 50)))
    if isinstance(listed, dict) and not listed.get("ok", True):
        return listed
    classified = email.classify_emails(session_id=session_id)
    ltext = listed.get("human_message", "") if isinstance(listed, dict) else str(listed)
    ctext = classified.get("human_message", str(classified)) if isinstance(classified, dict) else str(classified)
    body = f"**收件箱概览**\n{ltext}\n\n**分类与优先级**\n{ctext}"
    return _tool_ok(body, data={"limit": limit}, code="triage_ok")


def prepare_meeting(
    query: str = "",
    event_title: str = "",
    session_id: str = "default",
) -> dict:
    """会前准备：相关日程 + 知识库检索 + 备忘要点。"""
    q = str(query or event_title or "").strip()
    lines = ["**会前准备**", ""]

    ev = calendar.list_events()
    etext = ev.get("human_message", str(ev)) if isinstance(ev, dict) else str(ev)
    lines.extend(["**相关日程**", etext, ""])

    rag_q = q or "会议 议程 材料"
    kr = knowledge.knowledge_retrieval(rag_q, session_id=session_id)
    ktext = kr.get("human_message", str(kr)) if isinstance(kr, dict) else str(kr)
    lines.extend(["**知识库参考**", ktext, ""])

    hint = f"会前备忘（{local_now_aware().strftime('%Y-%m-%d %H:%M')}）：\n- 确认议程与参会人\n- 准备需讨论的数据与结论\n"
    if q:
        hint += f"- 主题：{q}\n"
    lines.extend(["**建议备忘**", hint])

    body = "\n".join(lines).strip()
    return _tool_ok(body, data={"query": rag_q}, code="meeting_prep_ok")


def weekly_report(session_id: str = "default") -> dict:
    """生成本周工作周报草稿（待办 + 日程 + 笔记摘要）。"""
    now = local_now_aware()
    week_start = (now - datetime.timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    lines = [f"**本周工作周报（{week_start} ~ {now.strftime('%Y-%m-%d')}）**", ""]

    tk = tasks.list_tasks()
    lines.extend(["**待办进展**", tk.get("human_message", str(tk)) if isinstance(tk, dict) else str(tk), ""])

    ev = calendar.list_events()
    lines.extend(["**本周日程**", ev.get("human_message", str(ev)) if isinstance(ev, dict) else str(ev), ""])

    nt = notes.list_notes()
    lines.extend(["**笔记摘录**", nt.get("human_message", str(nt)) if isinstance(nt, dict) else str(nt), ""])

    lines.append("**下周计划**（请补充）\n- ")
    body = "\n".join(lines).strip()
    return _tool_ok(body, data={"week_start": week_start}, code="weekly_ok")
