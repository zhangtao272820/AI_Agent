"""Grafana Explore deep-link helpers for Tempo + Loki + Langfuse."""

from __future__ import annotations

import json
from urllib.parse import quote

from .config import get_settings


def normalize_trace_id_hex(trace_id: str) -> str:
    """Manager runId → 32-char hex used as OTLP traceId (same as otelExport.ts)."""
    raw = "".join(c for c in str(trace_id or "") if c in "0123456789abcdefABCDEF").lower()
    return (raw + ("0" * 32))[:32]


def build_grafana_explore_url(trace_id: str, *, grafana_public_url: str | None = None) -> str | None:
    """Build Grafana Explore URL for Tempo datasource uid=tempo."""
    settings = get_settings()
    base = (grafana_public_url or settings.grafana_public_url or "").rstrip("/")
    tid = normalize_trace_id_hex(trace_id)
    if not base or not tid or tid == "0" * 32:
        return None
    panes = {
        "trace": {
            "datasource": "tempo",
            "queries": [
                {
                    "refId": "A",
                    "queryType": "traceql",
                    "query": tid,
                    "limit": 20,
                }
            ],
            "range": {"from": "now-24h", "to": "now"},
        }
    }
    panes_enc = quote(json.dumps(panes, separators=(",", ":")), safe="")
    return f"{base}/explore?schemaVersion=1&panes={panes_enc}&orgId=1"


def build_grafana_loki_explore_url(run_id: str, *, grafana_public_url: str | None = None) -> str | None:
    """Build Grafana Explore URL for Loki datasource uid=loki, filtered by run_id."""
    settings = get_settings()
    base = (grafana_public_url or settings.grafana_public_url or "").rstrip("/")
    rid = str(run_id or "").strip()
    if not base or not rid:
        return None
    escaped = rid.replace("\\", "\\\\").replace('"', '\\"')
    logql = f'{{service="manager_agent"}} |= "{escaped}"'
    panes = {
        "logs": {
            "datasource": "loki",
            "queries": [
                {
                    "refId": "A",
                    "expr": logql,
                    "queryType": "range",
                    "datasource": {"type": "loki", "uid": "loki"},
                    "editorMode": "code",
                }
            ],
            "range": {"from": "now-24h", "to": "now"},
        }
    }
    panes_enc = quote(json.dumps(panes, separators=(",", ":")), safe="")
    return f"{base}/explore?schemaVersion=1&panes={panes_enc}&orgId=1"


def build_langfuse_trace_url(trace_id: str, *, langfuse_public_url: str | None = None) -> str | None:
    """Langfuse UI deep-link by OTLP trace id (hex)."""
    settings = get_settings()
    base = (langfuse_public_url or settings.langfuse_public_url or "").rstrip("/")
    tid = normalize_trace_id_hex(trace_id)
    if not base or not tid or tid == "0" * 32:
        return None
    return f"{base}/trace/{tid}"


def build_trace_link_payload(trace_id: str) -> dict:
    settings = get_settings()
    tid_hex = normalize_trace_id_hex(trace_id)
    url = build_grafana_explore_url(trace_id)
    langfuse_url = build_langfuse_trace_url(trace_id)
    return {
        "ok": bool(url or langfuse_url),
        "trace_id": str(trace_id or "").strip(),
        "trace_id_hex": tid_hex,
        "grafana_explore_url": url,
        "langfuse_url": langfuse_url,
        "grafana_public_url": settings.grafana_public_url,
        "langfuse_public_url": settings.langfuse_public_url,
        "tempo_base_url": settings.tempo_base_url,
    }


def build_log_link_payload(run_id: str) -> dict:
    settings = get_settings()
    rid = str(run_id or "").strip()
    url = build_grafana_loki_explore_url(rid)
    return {
        "ok": bool(url),
        "run_id": rid,
        "grafana_loki_url": url,
        "grafana_explore_url": url,
        "grafana_public_url": settings.grafana_public_url,
        "loki_base_url": settings.loki_base_url,
    }
