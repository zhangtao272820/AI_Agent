"""Build data/china_calendar_2026.json with holidays and workday flags."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 2026 法定节假日（国务院口径近似；调休上班日 is_workday=true）
HOLIDAYS = {
    "2026-01-01": {"festival": "元旦", "is_holiday": True, "is_workday": False, "lunar": "腊月十三", "note": "元旦假期"},
    "2026-01-02": {"festival": "元旦", "is_holiday": True, "is_workday": False, "note": "元旦假期"},
    "2026-01-03": {"festival": "元旦", "is_holiday": True, "is_workday": False, "note": "元旦假期"},
    "2026-02-04": {"festival": "", "is_holiday": False, "is_workday": True, "note": "春节调休上班"},
    "2026-02-15": {"festival": "春节", "is_holiday": True, "is_workday": False, "lunar": "腊月廿八", "note": "春节假期"},
    "2026-02-16": {"festival": "除夕", "is_holiday": True, "is_workday": False, "lunar": "腊月廿九", "note": "除夕"},
    "2026-02-17": {"festival": "春节", "is_holiday": True, "is_workday": False, "lunar": "正月初一", "note": "大年初一"},
    "2026-02-18": {"festival": "春节", "is_holiday": True, "is_workday": False, "lunar": "正月初二", "note": "春节假期"},
    "2026-02-19": {"festival": "春节", "is_holiday": True, "is_workday": False, "lunar": "正月初三", "note": "春节假期"},
    "2026-02-20": {"festival": "春节", "is_holiday": True, "is_workday": False, "note": "春节假期"},
    "2026-02-21": {"festival": "春节", "is_holiday": True, "is_workday": False, "note": "春节假期"},
    "2026-02-22": {"festival": "春节", "is_holiday": True, "is_workday": False, "note": "春节假期"},
    "2026-02-23": {"festival": "春节", "is_holiday": True, "is_workday": False, "note": "春节假期"},
    "2026-03-03": {"festival": "元宵", "is_holiday": False, "is_workday": True, "lunar": "正月十五", "note": "元宵节（工作日）"},
    "2026-04-04": {"festival": "清明", "is_holiday": True, "is_workday": False, "note": "清明假期"},
    "2026-04-05": {"festival": "清明", "is_holiday": True, "is_workday": False, "note": "清明节"},
    "2026-04-06": {"festival": "清明", "is_holiday": True, "is_workday": False, "note": "清明假期"},
    "2026-05-01": {"festival": "劳动节", "is_holiday": True, "is_workday": False, "note": "五一假期"},
    "2026-05-02": {"festival": "劳动节", "is_holiday": True, "is_workday": False, "note": "五一假期"},
    "2026-05-03": {"festival": "劳动节", "is_holiday": True, "is_workday": False, "note": "五一假期"},
    "2026-05-04": {"festival": "劳动节", "is_holiday": True, "is_workday": False, "note": "五一假期"},
    "2026-05-05": {"festival": "劳动节", "is_holiday": True, "is_workday": False, "note": "五一假期"},
    "2026-06-19": {"festival": "端午", "is_holiday": True, "is_workday": False, "note": "端午节"},
    "2026-06-20": {"festival": "端午", "is_holiday": True, "is_workday": False, "note": "端午假期"},
    "2026-06-21": {"festival": "端午", "is_holiday": True, "is_workday": False, "note": "端午假期"},
    "2026-09-25": {"festival": "中秋", "is_holiday": True, "is_workday": False, "note": "中秋节"},
    "2026-09-26": {"festival": "中秋", "is_holiday": True, "is_workday": False, "note": "中秋假期"},
    "2026-09-27": {"festival": "中秋", "is_holiday": True, "is_workday": False, "note": "中秋假期"},
    "2026-10-01": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆节"},
    "2026-10-02": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆假期"},
    "2026-10-03": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆假期"},
    "2026-10-04": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆假期"},
    "2026-10-05": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆假期"},
    "2026-10-06": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆假期"},
    "2026-10-07": {"festival": "国庆", "is_holiday": True, "is_workday": False, "note": "国庆假期"},
    "2026-09-20": {"festival": "", "is_holiday": False, "is_workday": True, "note": "中秋国庆调休上班"},
    "2026-10-10": {"festival": "", "is_holiday": False, "is_workday": True, "note": "国庆调休上班"},
    "2026-12-25": {"festival": "圣诞", "is_holiday": False, "is_workday": True, "note": "圣诞氛围日（非法定假）"},
    "2026-02-14": {"festival": "情人节", "is_holiday": False, "is_workday": False, "note": "周末情人节"},
    "2026-05-20": {"festival": "520", "is_holiday": False, "is_workday": True, "note": "网络情人节氛围"},
    "2026-07-07": {"festival": "七夕临近", "is_holiday": False, "is_workday": True, "note": "农历七月气氛"},
    "2026-08-19": {"festival": "七夕", "is_holiday": False, "is_workday": True, "lunar": "七月初七", "note": "七夕（工作日）"},
}


def main() -> None:
    days: dict = {}
    d = date(2026, 1, 1)
    end = date(2026, 12, 31)
    while d <= end:
        key = d.isoformat()
        weekend = d.isoweekday() >= 6
        entry = dict(HOLIDAYS.get(key) or {})
        if "is_workday" not in entry:
            if entry.get("is_holiday"):
                entry["is_workday"] = False
            else:
                entry["is_workday"] = not weekend
        if "is_holiday" not in entry:
            entry["is_holiday"] = weekend and not entry.get("is_workday", True)
        entry.setdefault("festival", "")
        entry.setdefault("lunar", "")
        entry.setdefault("note", "周末" if weekend and not entry.get("festival") else "")
        days[key] = entry
        d += timedelta(days=1)

    out = {
        "year": 2026,
        "anchor": "2026-07-15",
        "source_note": "法定节假日为近似编排，供游戏氛围；可按国务院正式通知微调",
        "days": days,
    }
    path = ROOT / "data" / "china_calendar_2026.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {path} days={len(days)}")


if __name__ == "__main__":
    main()
