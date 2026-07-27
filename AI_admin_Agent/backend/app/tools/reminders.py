from __future__ import annotations

from app.core.reminders import reminder_manager
from app.core.time_utils import utc_naive_to_local_naive, utc_now_naive
from app.db.database import Event, SessionLocal
from app.tools.common import _tool_err, _tool_ok
from app.tools.time_parse import _naive_local, _resolve_stored_event_time

def add_reminder(
    content: str,
    remind_time_str: str,
    remind_time_local: str | None = None,
) -> str:
    """添加定时提醒并触发系统通知"""
    try:
        # Scheduler expects local-naive datetime.
        remind_time = _naive_local(
            _resolve_stored_event_time(remind_time_str, remind_time_local)
        )
    except Exception as e:
        return _tool_err(
            f"提醒创建失败：{str(e)}",
            data={"remind_time_str": remind_time_str, "content": content},
            code="time_parse_failed",
        )

    res = reminder_manager.add_reminder("AI 助理提醒", remind_time, content)
    return _tool_ok(
        str(res),
        data={
            "content": content,
            "remind_time_local": remind_time.strftime("%Y-%m-%d %H:%M:%S"),
        },
        code="reminder_created",
    )


def restore_event_reminders() -> int:
    """应用启动时从数据库恢复未来日程提醒。"""
    db = SessionLocal()
    now = utc_now_naive()
    events = db.query(Event).filter(Event.start_time >= now).all()
    db.close()
    restored = 0
    for event in events:
        reminder_id = f"event_{event.id}"
        try:
            reminder_manager.add_reminder(
                event.title,
                utc_naive_to_local_naive(event.start_time),
                event.description or "",
                reminder_id=reminder_id,
            )
            restored += 1
        except Exception:
            continue
    return restored


def list_reminders() -> str:
    reminders = reminder_manager.list_reminders()
    if not reminders:
        return _tool_ok("当前没有待触发的提醒。", data={"items": [], "count": 0}, code="empty")
    lines = ["提醒列表："]
    items = []
    for item in reminders[:30]:
        title = item["args"][0] if item.get("args") else "提醒"
        lines.append(f"- [{item['id']}] {title} @ {item.get('next_run_time') or '未知时间'}")
        items.append(
            {
                "id": item.get("id"),
                "title": title,
                "next_run_time": item.get("next_run_time"),
            }
        )
    return _tool_ok("\n".join(lines), data={"items": items, "count": len(items)})


def cancel_reminder(reminder_id: str) -> str:
    rid = (reminder_id or "").strip()
    if not rid:
        return _tool_err(
            "取消提醒失败：reminder_id 不能为空。",
            data={"reminder_id": rid},
            code="missing_required_fields",
        )
    ok = reminder_manager.cancel_reminder(rid)
    if ok:
        return _tool_ok(
            f"已取消提醒：{rid}",
            data={"reminder_id": rid},
            code="cancelled",
        )
    return _tool_err(
        f"取消失败：未找到提醒ID {rid}",
        data={"reminder_id": rid},
        code="reminder_not_found",
    )

