"""并行拉取各子 Agent /api/metrics（供平台监控页展示）。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from .managed_agents import managed_agent_specs


def _fetch_json(url: str, timeout_sec: float = 2.5) -> dict:
    started = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:  # noqa: S310
            raw = resp.read(256_000)
            latency = int((time.perf_counter() - started) * 1000)
            payload = json.loads(raw.decode("utf-8", errors="replace") or "{}")
            return {
                "ok": True,
                "url": url,
                "latency_ms": latency,
                "data": payload,
            }
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "url": url,
            "latency_ms": latency,
            "error": str(exc)[:400],
        }


def _agent_metrics_url(spec: dict) -> str | None:
    name = str(spec.get("name") or "").strip()
    if name in ("Manager_Agent", "manager_agent"):
        return None
    endpoint = str(spec.get("endpoint") or "").strip().rstrip("/")
    if not endpoint:
        host = str(spec.get("host") or "").strip()
        port = str(spec.get("port") or "").strip()
        if host and port:
            endpoint = f"http://{host}:{port}"
    if not endpoint:
        return None
    return f"{endpoint}/api/metrics"


def build_agents_metrics_snapshot() -> dict:
    specs = managed_agent_specs()
    jobs: list[tuple[str, str]] = []
    for spec in specs:
        url = _agent_metrics_url(spec)
        if not url:
            continue
        jobs.append((str(spec.get("name") or "unknown"), url))

    agents: list[dict] = []
    if not jobs:
        return {"ok": True, "checked_at": int(time.time()), "agents": agents}

    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
        futures = {pool.submit(_fetch_json, url): (name, url) for name, url in jobs}
        for fut in as_completed(futures):
            name, url = futures[fut]
            result = fut.result()
            agents.append(
                {
                    "name": name,
                    "endpoint": url.rsplit("/api/metrics", 1)[0],
                    "ok": bool(result.get("ok")),
                    "latency_ms": result.get("latency_ms"),
                    "metrics": result.get("data") if result.get("ok") else None,
                    "error": result.get("error"),
                }
            )

    agents.sort(key=lambda x: x.get("name") or "")
    return {
        "ok": True,
        "checked_at": int(time.time()),
        "agents": agents,
    }
