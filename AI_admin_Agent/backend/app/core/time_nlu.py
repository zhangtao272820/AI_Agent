"""
自然语言日期时间理解：由大模型结合当前时刻拆解，输出可执行的本地墙钟时间。
支持中文、英文及混合表达；禁止用正则猜时间。
"""
from __future__ import annotations

import datetime
import json
from typing import Any, Dict, Optional

from app.core.llm import qwen_llm
from app.core.time_utils import local_now_aware, user_tz


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    text = (raw_text or "").strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    start_idx = text.find("{")
    if start_idx < 0:
        raise ValueError("No JSON object found.")
    depth = 0
    in_string = False
    escaped = False
    for idx in range(start_idx, len(text)):
        ch = text[idx]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start_idx : idx + 1])
    raise ValueError("No complete JSON object found.")


def _validate_local_iso(value: str) -> Optional[str]:
    s = (value or "").strip()
    if not s:
        return None
    try:
        dt = datetime.datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            dt = datetime.datetime.strptime(s[:16], "%Y-%m-%d %H:%M")
        except ValueError:
            return None
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def should_resolve_datetime_from_understanding(understanding: Dict[str, Any] | None) -> bool:
    """根据语义理解结果判断是否需要调用时间模型（不用正则扫用户原话）。"""
    from app.core.admin_text_sensitivity import has_time_signal

    if not isinstance(understanding, dict):
        return False
    if understanding.get("has_time_reference") is True:
        return True
    intent = str(understanding.get("intent") or "")
    if intent in ("日程", "待办", "混合任务"):
        return True
    slots = understanding.get("slots") if isinstance(understanding.get("slots"), dict) else {}
    for key in ("start_time_expression", "task_due_time_expression"):
        expr = str(slots.get(key) or "").strip()
        if expr:
            return True
        if has_time_signal(expr):
            return True
    time_expr = str(understanding.get("time_expression") or "").strip()
    if time_expr or has_time_signal(time_expr):
        return True
    return False


def resolve_datetime_with_llm(
    user_message: str,
    hint_expression: str = "",
) -> Dict[str, Any]:
    """
    用大模型把用户话里的时间拆解为本地时刻。
    返回: ok, time_expression, start_time_local, display_text, reason
    """
    now = local_now_aware()
    tz_label = now.tzname() or str(user_tz())
    weekday_names = "一二三四五六日"
    today_wd = weekday_names[now.weekday()]
    en_weekday = now.strftime("%A")

    prompt = f"""你是多语言日期时间解析器（中文 + 英文）。根据用户原话和当前时刻，算出事件应发生的本地墙钟时间。

当前时刻（本地）: {now.strftime("%Y-%m-%d %H:%M:%S")} 星期{today_wd} / {en_weekday} ({tz_label})
用户原话: "{user_message}"
补充时间片段（可能为空，保留用户原文语言）: "{hint_expression}"

语义规则（必须遵守）:
【中文 — 高敏感】
1. 「下周五」「下周三」= 下一自然周的那个 weekday，不是本周、不是今天。
2. 「这周五」「本周五」「周五」在无「下」「下下周」时 = 本周尚未过去的 weekday；若已过则指下一周。
3. 「明天/后天/大后天/今天/昨日」按日历日，再结合上午/下午/晚上/几点。
4. 数字必须精确：下午1点=13:00，下午2点=14:00，下午3点=15:00；上午9点=09:00；晚上8点=20:00。
   禁止把「下午3点」理解成13:00或18:00；禁止把「下午」默认成15:00。
5. 「9点半」「3点30分」「15:30」「14：30」（全角冒号）均按字面解析；半=30分。
6. 中文数字与阿拉伯数字等价：「三点」「3点」「３点」均按 15:00/03:00 等语境判断。
7. 「每月1号/5日/12号」「下月3日」按公历日；用户未提年份时用当前年，已过则下一年。
8. time_expression 必须保留用户原话中的中文与数字写法，不要改成英文或 ISO 塞进 time_expression。

【英文】
9. tomorrow / the day after tomorrow / today → calendar day + clock time.
10. next Friday / next Monday = that weekday in the *next* calendar week.
11. this Friday / Friday (without next) = upcoming occurrence in current week, or next week if already passed.
12. 3pm / 3 PM / 15:00 → 24h wall clock; noon=12:00, midnight=00:00.
13. in 2 hours / in 30 minutes → relative to current moment above.

【通用】
14. 只解析用户明确要安排日程/待办/提醒的时间；纯查询、无时间意图则 ok=false。
15. 用户原话中的数字（含全角０-９）与中文时间词必须全部体现在 time_expression。
16. 若只有日期没有具体时刻且语境需要时刻，ok=false 并在 reason 中说明需要补充几点。

只输出一个 JSON（不要其它文字）:
{{
  "ok": true,
  "time_expression": "next Friday 9am",
  "start_time_local": "2026-05-29 09:00:00",
  "display_text": "下周五（5月29日）上午9:00"
}}
字段说明:
- start_time_local: 本地墙钟 YYYY-MM-DD HH:MM:SS（24小时制，不要带时区后缀）
- display_text: 给用户确认用的一行（可用中文简述）
- ok=false 时 reason 说明缺什么
"""
    try:
        raw = qwen_llm.chat_text_json([{"role": "user", "content": prompt}])
        data = _extract_json_object(raw)
    except Exception as e:
        return {"ok": False, "reason": f"时间理解失败: {e}"}

    if not data.get("ok"):
        return {
            "ok": False,
            "reason": str(data.get("reason") or "未能从语句中识别时间"),
        }

    local = _validate_local_iso(str(data.get("start_time_local", "")))
    if not local:
        return {"ok": False, "reason": "模型返回的时间格式无效"}

    return {
        "ok": True,
        "time_expression": str(data.get("time_expression") or hint_expression or "").strip(),
        "start_time_local": local,
        "display_text": str(data.get("display_text") or local).strip(),
    }


def resolve_datetime_to_local_dt(
    expression: str,
    user_message: str = "",
    hint_expression: str = "",
) -> datetime.datetime:
    """将自然语言或已锁定 ISO 本地时间转为 datetime；优先 LLM，仅对已锁定 ISO 做字面解析。"""
    locked = _validate_local_iso(expression)
    if locked:
        return datetime.datetime.strptime(locked, "%Y-%m-%d %H:%M:%S")

    anchor = (user_message or "").strip() or (expression or "").strip()
    hint = (hint_expression or expression or "").strip()
    if not anchor and not hint:
        raise ValueError("开始时间为空。")

    res = resolve_datetime_with_llm(anchor, hint)
    if not res.get("ok"):
        raise ValueError(str(res.get("reason") or "无法解析时间，请补充具体日期与时刻。"))

    local = str(res.get("start_time_local") or "")
    validated = _validate_local_iso(local)
    if not validated:
        raise ValueError("时间解析结果无效。")
    return datetime.datetime.strptime(validated, "%Y-%m-%d %H:%M:%S")
