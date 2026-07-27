#!/usr/bin/env python3
"""Enrich social_graph.json with occupation + workday/rest schedules (idempotent)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

STUDENT_KW = ("高中生", "大学生", "实习生", "练习生", "社团", "学徒")
OFFICE_KW = ("工程师", "顾问", "讲师", "评测")
CAFE_KW = ("咖啡", "花艺", "店员")
HOME_KW = ("插画", "设计", "诗人", "魔女", "游侠")


def track_for(occupation: str, base_schedule: dict, home: list[str]) -> tuple[dict, dict]:
    occ = occupation or ""
    home = home or ["home"]
    base = base_schedule or {}

    if any(k in occ for k in STUDENT_KW):
        work = {
            "morning": ["campus"],
            "afternoon": ["campus", "library"],
            "evening": ["street", "cafe"] + home[:1],
            "night": home[:1] or ["home"],
        }
        rest = {
            "morning": home[:1] or ["home"],
            "afternoon": ["cafe", "park", "street"],
            "evening": ["cafe", "park"] + home[:1],
            "night": home[:1] or ["home"],
        }
    elif any(k in occ for k in OFFICE_KW):
        work = {
            "morning": ["office"],
            "afternoon": ["office"],
            "evening": ["street", "cafe", "store"],
            "night": home[:1] or ["home"],
        }
        rest = {
            "morning": home[:1] or ["home"],
            "afternoon": ["cafe", "park", "street"],
            "evening": ["cafe", "park"],
            "night": home[:1] or ["home"],
        }
    elif any(k in occ for k in CAFE_KW):
        work = {
            "morning": ["cafe"],
            "afternoon": ["cafe"],
            "evening": ["cafe", "street"],
            "night": home[:1] or ["cafe"],
        }
        rest = {
            "morning": home[:1] or ["home"],
            "afternoon": ["park", "street", "cafe"],
            "evening": ["cafe", "park"],
            "night": home[:1] or ["home"],
        }
    elif any(k in occ for k in HOME_KW) or "精灵" in occ:
        work = {
            "morning": home[:1] or ["home"],
            "afternoon": ["cafe", "library", "forest", "park"],
            "evening": ["cafe", "park"] + home[:1],
            "night": home[:1] or ["home"],
        }
        rest = {
            "morning": home[:1] or ["home"],
            "afternoon": ["park", "forest", "cafe"],
            "evening": ["park", "cafe"],
            "night": home[:1] or ["home"],
        }
    else:
        work = {k: list(v) for k, v in base.items()} or {
            "morning": home[:1] or ["home"],
            "afternoon": ["cafe", "street"],
            "evening": ["cafe"] + home[:1],
            "night": home[:1] or ["home"],
        }
        rest = {
            "morning": home[:1] or ["home"],
            "afternoon": ["cafe", "park", "street"],
            "evening": ["cafe", "park"] + home[:1],
            "night": home[:1] or ["home"],
        }
    # Prefer existing schedule as workday fallback when already rich
    if base and not any(k in occ for k in STUDENT_KW + OFFICE_KW + CAFE_KW):
        work = {k: list(v) for k, v in base.items()}
    return work, rest


def main() -> None:
    roles = json.loads((ROOT / "data" / "model_roles.json").read_text(encoding="utf-8"))
    occ_map: dict[str, str] = {}
    for base in roles.get("bases") or []:
        for row in base.get("characters") or []:
            cid = str(row.get("id") or "")
            prof = row.get("profile") or {}
            if cid:
                occ_map[cid] = str(prof.get("occupation") or "")

    path = ROOT / "data" / "social_graph.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    chars = data.get("characters") or {}
    for cid, row in chars.items():
        occ = occ_map.get(cid) or row.get("occupation") or ""
        row["occupation"] = occ
        home = list(row.get("home_locations") or [])
        base_sched = row.get("schedule") or {}
        work, rest = track_for(occ, base_sched, home)
        row["schedule_workday"] = work
        row["schedule_rest"] = rest
        # keep schedule as workday default for older readers
        row["schedule"] = work
        if not row.get("contact_style"):
            row["contact_style"] = "消息长短随心情起伏"
        if not row.get("boundary"):
            row["boundary"] = "不喜欢被当众起哄或逼问隐私"

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"enriched {len(chars)} characters → {path}")


if __name__ == "__main__":
    main()
