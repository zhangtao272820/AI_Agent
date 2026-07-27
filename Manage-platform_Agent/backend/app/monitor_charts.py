"""监控大屏快照：聚合 Manager 与子 Agent 指标（供 ECharts 柱状/饼图）。"""

from __future__ import annotations

import time

from .agent_metrics_collector import collect_agent_metrics_once
from .manager_observability import build_manager_observability


def _counter_summary(metrics: dict | None) -> dict[str, float]:
    if not isinstance(metrics, dict):
        return {}
    out: dict[str, float] = {}
    counters = metrics.get("counters")
    if isinstance(counters, list):
        for item in counters:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("key") or "unknown").strip() or "unknown"
            raw = item.get("value", item.get("count"))
            try:
                val = float(raw)
            except (TypeError, ValueError):
                continue
            if val == val:
                out[name] = val
    aggregate = metrics.get("aggregate")
    if isinstance(aggregate, dict):
        for key, raw in aggregate.items():
            if isinstance(raw, (int, float)):
                out[str(key)] = float(raw)
    return out


def build_monitor_charts_snapshot(*, refresh_collector: bool = True) -> dict:
    if refresh_collector:
        try:
            collect_agent_metrics_once()
        except Exception:  # noqa: BLE001
            pass

    obs = build_manager_observability()
    mgr = obs.get("manager") if isinstance(obs.get("manager"), dict) else {}
    token_summary = mgr.get("token_summary") if isinstance(mgr.get("token_summary"), dict) else {}
    evolution = mgr.get("evolution") if isinstance(mgr.get("evolution"), dict) else {}
    phases = mgr.get("phases") if isinstance(mgr.get("phases"), dict) else {}
    by_agent_success = mgr.get("by_agent_success") if isinstance(mgr.get("by_agent_success"), dict) else {}

    agents_health = [
        h
        for h in (obs.get("agents_health") or [])
        if str(h.get("name") or "") not in ("PostgreSQL", "Redis", "Manager_Agent")
    ]
    metrics_by_name = {
        str(a.get("name") or ""): a for a in (obs.get("agents_metrics") or []) if a.get("name")
    }

    agents: list[dict] = []
    for h in agents_health:
        name = str(h.get("name") or "")
        snap = metrics_by_name.get(name) or {}
        agents.append(
            {
                "name": name,
                "status": h.get("status"),
                "latency_ms": h.get("latency_ms"),
                "target": h.get("target"),
                "metrics_ok": bool(snap.get("ok")),
                "metrics_error": snap.get("error"),
                "counters": _counter_summary(snap.get("metrics") if snap.get("ok") else None),
            }
        )

    healthy_count = sum(1 for a in agents if a.get("status") == "healthy")
    return {
        "ok": True,
        "checked_at": int(time.time()),
        "overall_status": obs.get("overall_status"),
        "manager": {
            "reachable": bool(mgr.get("reachable")),
            "endpoint": mgr.get("endpoint"),
            "runs": mgr.get("runs"),
            "phases": phases,
            "token_by_phase": token_summary.get("byPhase") or {},
            "token_by_agent": token_summary.get("byAgent") or {},
            "token_by_model": token_summary.get("byModel") or {},
            "total_tokens": token_summary.get("totalTokens"),
            "by_agent_success": by_agent_success,
            "evolution": {
                "firstPassSuccessRate": evolution.get("firstPassSuccessRate"),
                "nluSampleCount": evolution.get("nluSampleCount"),
                "avgFinalConfidence": evolution.get("avgFinalConfidence"),
                "avgRouteConfidence": evolution.get("avgRouteConfidence"),
                "experienceReplayUsageRate": evolution.get("experienceReplayUsageRate"),
                "experienceCount": evolution.get("experienceCount"),
            },
        },
        "agents": agents,
        "agents_summary": {
            "total": len(agents),
            "healthy": healthy_count,
            "degraded": sum(1 for a in agents if a.get("status") == "degraded"),
            "offline": sum(1 for a in agents if a.get("status") not in ("healthy", "degraded")),
        },
    }
