"""从 AuditLog 统计工具失败与高频错误码，驱动 prompt 进化。"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.database import AuditLog, SessionLocal
from app.core.prompt_evolution import PatchStage, append_prompt_patch, learn_from_tool_failure


def _parse_result_code(result_text: str, status: str) -> str:
    text = str(result_text or "")
    if status == "error":
        return "execute_error"
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and obj.get("code"):
            return str(obj["code"])
    except (json.JSONDecodeError, TypeError):
        pass
    m = re.search(r'"code"\s*:\s*"([^"]+)"', text)
    if m:
        return m.group(1)
    if "time_parse_failed" in text:
        return "time_parse_failed"
    if "失败" in text or status == "error":
        return "failed"
    return "ok" if status == "ok" else str(status or "unknown")


def scan_audit_logs(limit: int = 500, days: int = 14) -> dict[str, Any]:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    db = SessionLocal()
    try:
        rows = (
            db.query(AuditLog)
            .filter(AuditLog.created_at >= since)
            .order_by(AuditLog.id.desc())
            .limit(limit)
            .all()
        )
    finally:
        db.close()

    tool_total: Counter[str] = Counter()
    tool_errors: Counter[str] = Counter()
    code_errors: Counter[str] = Counter()
    pair_errors: Counter[str] = Counter()
    failures: list[dict[str, Any]] = []

    for row in rows:
        tool = str(row.tool_name or "").strip()
        status = str(row.status or "ok").strip()
        code = _parse_result_code(str(row.result_text or ""), status)
        tool_total[tool] += 1
        if status != "ok" or code not in ("ok", ""):
            tool_errors[tool] += 1
            code_errors[code] += 1
            pair_errors[f"{tool}::{code}"] += 1
            if len(failures) < 30:
                failures.append(
                    {
                        "tool_name": tool,
                        "code": code,
                        "status": status,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                )

    top_tools = [{"tool": k, "errors": v} for k, v in tool_errors.most_common(10)]
    top_codes = [{"code": k, "count": v} for k, v in code_errors.most_common(10)]
    top_pairs = [{"pair": k, "count": v} for k, v in pair_errors.most_common(10)]

    return {
        "windowDays": days,
        "sampleSize": len(rows),
        "toolTotals": dict(tool_total),
        "topToolErrors": top_tools,
        "topFailureCodes": top_codes,
        "topFailurePairs": top_pairs,
        "recentFailures": failures,
    }


def ingest_audit_failures_to_patches(limit: int = 120) -> int:
    """扫描近期审计失败并写入影子补丁（去重由 append_prompt_patch 处理）。"""
    stats = scan_audit_logs(limit=limit)
    count = 0
    for item in stats.get("recentFailures") or []:
        if not isinstance(item, dict):
            continue
        tool = str(item.get("tool_name") or "")
        code = str(item.get("code") or "")
        if code in ("ok", ""):
            continue
        learn_from_tool_failure(tool, code)
        count += 1
    return count


def get_audit_learning_summary(days: int = 14) -> dict[str, Any]:
    stats = scan_audit_logs(days=days)
    return {
        "audit": stats,
        "failureRate": (
            round(
                sum(x["errors"] for x in stats.get("topToolErrors") or [])
                / max(1, stats.get("sampleSize") or 1),
                4,
            )
        ),
    }
