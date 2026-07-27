"""日历 ICS 导入/导出（轻量实现，替代完整 OAuth 同步的第一阶段）。"""
from __future__ import annotations

import datetime as dt
import urllib.request
from typing import Any

from app.core.time_utils import utc_naive_to_local_naive


def _unfold_ics(text: str) -> list[str]:
    lines: list[str] = []
    for raw in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _parse_ics_datetime(value: str) -> dt.datetime:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("ICS 时间为空")
    if raw.endswith("Z"):
        raw = raw[:-1]
        fmt = "%Y%m%dT%H%M%S" if "T" in raw else "%Y%m%d"
        parsed = dt.datetime.strptime(raw[:15] if "T" in raw else raw[:8], fmt)
        return parsed.replace(tzinfo=dt.timezone.utc).replace(tzinfo=None)
    if "T" in raw:
        parsed = dt.datetime.strptime(raw[:15], "%Y%m%dT%H%M%S")
    else:
        parsed = dt.datetime.strptime(raw[:8], "%Y%m%d")
    return parsed


def _ics_field(line: str) -> tuple[str, str]:
    if ":" not in line:
        return line.upper(), ""
    key, val = line.split(":", 1)
    return key.split(";", 1)[0].upper(), val.strip()


def parse_ics_events(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    current: dict[str, Any] = {}
    in_event = False
    for line in _unfold_ics(text):
        upper = line.upper()
        if upper == "BEGIN:VEVENT":
            in_event = True
            current = {}
            continue
        if upper == "END:VEVENT":
            in_event = False
            title = str(current.get("title") or "").strip()
            start = current.get("start")
            if title and isinstance(start, dt.datetime):
                events.append(
                    {
                        "title": title,
                        "start_time": start,
                        "description": str(current.get("description") or ""),
                        "uid": str(current.get("uid") or ""),
                    }
                )
            current = {}
            continue
        if not in_event:
            continue
        key, val = _ics_field(line)
        if key == "SUMMARY":
            current["title"] = val
        elif key == "DTSTART":
            current["start"] = _parse_ics_datetime(val)
        elif key == "DESCRIPTION":
            current["description"] = val.replace("\\n", "\n").replace("\\,", ",")
        elif key == "UID":
            current["uid"] = val
    return events


def fetch_ics_from_url(url: str, timeout: float = 20.0) -> str:
    target = str(url or "").strip()
    if not target.lower().startswith(("http://", "https://", "webcal://")):
        raise ValueError("ICS URL 需以 http(s):// 或 webcal:// 开头")
    if target.lower().startswith("webcal://"):
        target = "https://" + target[9:]
    req = urllib.request.Request(target, headers={"User-Agent": "AI_admin_Agent/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    return data.decode("utf-8", errors="replace")


def render_ics_events(events: list[dict[str, Any]]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AI_admin_Agent//ICS Export//CN",
        "CALSCALE:GREGORIAN",
    ]
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    for idx, ev in enumerate(events):
        title = str(ev.get("title") or "未命名").replace("\n", "\\n").replace(",", "\\,")
        start = ev.get("start_time")
        if not isinstance(start, dt.datetime):
            continue
        local = utc_naive_to_local_naive(start)
        dtstart = local.strftime("%Y%m%dT%H%M%S")
        uid = str(ev.get("uid") or f"admin-event-{ev.get('id', idx)}@local")
        desc = str(ev.get("description") or "").replace("\n", "\\n").replace(",", "\\,")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTAMP:{stamp}",
                f"DTSTART:{dtstart}",
                f"SUMMARY:{title}",
            ]
        )
        if desc:
            lines.append(f"DESCRIPTION:{desc}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def dedupe_key(title: str, start: dt.datetime) -> str:
    return f"{title.strip().lower()}|{start.strftime('%Y-%m-%d %H:%M')}"
