from apscheduler.schedulers.background import BackgroundScheduler
from plyer import notification
import datetime
import logging
from typing import List, Dict, Any

class ReminderManager:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.scheduler.start()
        logging.info("Reminder scheduler started.")

    def send_notification(self, title: str, message: str):
        """发送系统桌面通知，并可选 Webhook 推送。"""
        from app.core.webhook_notify import send_webhook_notification

        send_webhook_notification(title, message)
        try:
            notification.notify(
                title=title,
                message=message,
                app_name="AI Agent Assistant",
                timeout=10  # 通知显示时间（秒）
            )
        except Exception as e:
            logging.error(f"Failed to send notification: {e}")

    def add_reminder(
        self,
        title: str,
        remind_time: datetime.datetime,
        content: str = "",
        reminder_id: str | None = None,
    ):
        """添加一个定时提醒任务；可选指定 reminder_id 以便覆盖更新。"""
        add_args = {
            "func": self.send_notification,
            "trigger": "date",
            "run_date": remind_time,
            "args": [f"⏰ 提醒: {title}", content or "您预设的时间到了！"],
        }
        if reminder_id:
            add_args["id"] = reminder_id
            add_args["replace_existing"] = True
        job = self.scheduler.add_job(**add_args)
        return (
            f"已安排提醒：{title}，时间：{remind_time.strftime('%Y-%m-%d %H:%M:%S')}，"
            f"提醒ID：{job.id}"
        )

    def list_reminders(self) -> List[Dict[str, Any]]:
        jobs = self.scheduler.get_jobs()
        result: List[Dict[str, Any]] = []
        for job in jobs:
            run_time = None
            if getattr(job, "next_run_time", None):
                run_time = job.next_run_time.strftime("%Y-%m-%d %H:%M:%S")
            result.append(
                {
                    "id": job.id,
                    "next_run_time": run_time,
                    "args": list(job.args or []),
                }
            )
        return result

    def cancel_reminder(self, reminder_id: str) -> bool:
        try:
            self.scheduler.remove_job(reminder_id)
            return True
        except Exception:
            return False

reminder_manager = ReminderManager()
