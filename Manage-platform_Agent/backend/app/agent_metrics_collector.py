"""后台轮询子 Agent 探活与 /api/metrics，写入 Prometheus Gauge。"""

from __future__ import annotations

import logging
import threading
import time

from .agents_metrics import build_agents_metrics_snapshot
from .health_overview import build_health_overview
from .metrics import update_agent_probe_metrics

_log = logging.getLogger(__name__)

_COLLECTOR_INTERVAL_SEC = 20.0
_collector_thread: threading.Thread | None = None
_collector_stop = threading.Event()


def _extract_counter_pairs(metrics: dict | None) -> list[tuple[str, float]]:
    if not isinstance(metrics, dict):
        return []
    pairs: list[tuple[str, float]] = []
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
                pairs.append((name, val))
    aggregate = metrics.get("aggregate")
    if isinstance(aggregate, dict):
        for key, raw in aggregate.items():
            if isinstance(raw, (int, float)):
                pairs.append((str(key), float(raw)))
    return pairs


def collect_agent_metrics_once() -> dict:
    health = build_health_overview(use_cache=False)
    agents_metrics = build_agents_metrics_snapshot()
    metrics_by_name = {
        str(a.get("name") or ""): a for a in (agents_metrics.get("agents") or []) if a.get("name")
    }

    rows: list[dict] = []
    for check in health.get("checks") or []:
        name = str(check.get("name") or "").strip()
        if not name or name in ("PostgreSQL", "Redis", "Manager_Agent"):
            continue
        status = str(check.get("status") or "unknown")
        up = 1.0 if status == "healthy" else 0.0
        latency = float(check.get("latency_ms") or 0)
        snap = metrics_by_name.get(name) or {}
        counters = _extract_counter_pairs(snap.get("metrics") if snap.get("ok") else None)
        update_agent_probe_metrics(
            agent=name,
            up=up,
            latency_ms=latency,
            counters=counters,
        )
        rows.append(
            {
                "name": name,
                "status": status,
                "latency_ms": int(latency),
                "metrics_ok": bool(snap.get("ok")),
                "counters": {k: v for k, v in counters},
            }
        )

    return {"ok": True, "checked_at": int(time.time()), "agents": rows}


def _collector_loop() -> None:
    while not _collector_stop.is_set():
        try:
            collect_agent_metrics_once()
        except Exception as exc:  # noqa: BLE001
            _log.warning("agent metrics collector failed: %s", exc)
        _collector_stop.wait(_COLLECTOR_INTERVAL_SEC)


def start_agent_metrics_collector() -> None:
    global _collector_thread
    if _collector_thread and _collector_thread.is_alive():
        return
    _collector_stop.clear()
    _collector_thread = threading.Thread(target=_collector_loop, name="agent-metrics-collector", daemon=True)
    _collector_thread.start()


def stop_agent_metrics_collector() -> None:
    _collector_stop.set()
    global _collector_thread
    if _collector_thread:
        _collector_thread.join(timeout=2.0)
        _collector_thread = None
