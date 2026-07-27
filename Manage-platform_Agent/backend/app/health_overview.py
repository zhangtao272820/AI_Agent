import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from redis import from_url as redis_from_url
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .config import get_settings
from .db import SessionLocal
from .managed_agents import managed_agent_specs

settings = get_settings()

DEFAULT_HEALTH_PATHS = ("/api/health", "/health")
# 探活只验证可达性；并行探测后单 Agent 超时不必过长
NODE_AGENT_PROBE_TIMEOUT_SEC = 2.2
DEFAULT_PROBE_TIMEOUT_SEC = 1.5
_HEALTH_CACHE_TTL_SEC = 20.0
_health_cache_lock = threading.Lock()
_health_cache: dict = {"at": 0.0, "data": None}


def _probe_http(url: str, timeout_sec: float = DEFAULT_PROBE_TIMEOUT_SEC) -> dict:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout_sec) as resp:  # noqa: S310
            latency = int((time.perf_counter() - started) * 1000)
            body = None
            try:
                raw = resp.read(4096)
                if raw:
                    text_body = raw.decode("utf-8", errors="replace")
                    try:
                        body = json.loads(text_body)
                    except json.JSONDecodeError:
                        body = text_body[:240]
            except Exception:
                body = None
            return {
                "ok": True,
                "status_code": getattr(resp, "status", 200),
                "latency_ms": latency,
                "detail": "reachable",
                "body": body,
            }
    except urllib.error.HTTPError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        body = None
        try:
            raw = exc.read(4096)
            if raw:
                text_body = raw.decode("utf-8", errors="replace")
                try:
                    body = json.loads(text_body)
                except json.JSONDecodeError:
                    body = text_body[:240]
        except Exception:
            body = None
        return {
            "ok": True,
            "status_code": exc.code,
            "latency_ms": latency,
            "detail": "reachable_with_http_error",
            "body": body,
        }
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": latency,
            "detail": str(exc),
            "body": None,
        }


def _health_paths_for_spec(spec: dict) -> tuple[str, ...]:
    runner = str(spec.get("runner") or "").strip().lower()
    name = str(spec.get("name") or "").strip()
    if name == "AI_Agent":
        return ("/health", "/api/health")
    if runner == "node":
        return ("/api/health", "/health")
    if runner == "python":
        return ("/api/health", "/health")
    return DEFAULT_HEALTH_PATHS


def _probe_agent_health(endpoint: str, spec: dict, *, fast: bool = True) -> dict:
    base = str(endpoint or "").rstrip("/")
    runner = str(spec.get("runner") or "").strip().lower()
    timeout_sec = NODE_AGENT_PROBE_TIMEOUT_SEC if runner == "node" else DEFAULT_PROBE_TIMEOUT_SEC
    paths = _health_paths_for_spec(spec)
    if fast:
        paths = paths[:1]
    tried: list[str] = []
    for path in paths:
        health_url = f"{base}{path}"
        tried.append(health_url)
        probed = _probe_http(health_url, timeout_sec=timeout_sec)
        if probed["ok"]:
            return {
                **probed,
                "target": health_url,
                "probe_path": path,
                "tried_paths": tried,
            }

    if fast:
        return {
            **probed,
            "target": tried[0] if tried else base,
            "probe_path": paths[0] if paths else None,
            "tried_paths": tried,
        }

    root_probe = _probe_http(base, timeout_sec=timeout_sec)
    tried.append(base)
    if root_probe["ok"]:
        return {
            **root_probe,
            "target": base,
            "probe_path": "/",
            "tried_paths": tried,
        }

    return {
        **root_probe,
        "target": tried[0] if tried else base,
        "probe_path": None,
        "tried_paths": tried,
    }


def _probe_database() -> dict:
    started = time.perf_counter()
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        latency = int((time.perf_counter() - started) * 1000)
        return {"ok": True, "latency_ms": latency, "detail": "query_ok"}
    except SQLAlchemyError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "latency_ms": latency, "detail": str(exc)}
    finally:
        db.close()


def _probe_redis() -> dict:
    started = time.perf_counter()
    client = redis_from_url(settings.redis_url, decode_responses=True)
    try:
        pong = client.ping()
        latency = int((time.perf_counter() - started) * 1000)
        return {"ok": bool(pong), "latency_ms": latency, "detail": "pong" if pong else "no_pong"}
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "latency_ms": latency, "detail": str(exc)}
    finally:
        try:
            client.close()
        except Exception:
            pass


def _agent_check_from_probe(spec: dict, probed: dict) -> dict:
    endpoint = spec["endpoint"]
    health_body = probed.get("body")
    health_ok = None
    if isinstance(health_body, dict):
        health_ok = health_body.get("ok")
        if health_ok is None and "service" in health_body:
            health_ok = True
    return {
        "name": spec["name"],
        "target": probed.get("target") or endpoint,
        "status": "healthy" if probed["ok"] else "down",
        "latency_ms": probed["latency_ms"],
        "detail": probed["detail"],
        "probe_path": probed.get("probe_path"),
        "health_ok": health_ok,
        "health_body": health_body if isinstance(health_body, dict) else None,
    }


def _build_health_overview_uncached() -> dict:
    checks: list[dict] = []

    db_check = _probe_database()
    checks.append(
        {
            "name": "PostgreSQL",
            "target": settings.database_url,
            "status": "healthy" if db_check["ok"] else "down",
            "latency_ms": db_check["latency_ms"],
            "detail": db_check["detail"],
        }
    )

    redis_check = _probe_redis()
    checks.append(
        {
            "name": "Redis",
            "target": settings.redis_url,
            "status": "healthy" if redis_check["ok"] else "down",
            "latency_ms": redis_check["latency_ms"],
            "detail": redis_check["detail"],
        }
    )

    specs = managed_agent_specs()
    if specs:
        workers = min(12, len(specs))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_probe_agent_health, spec["endpoint"], spec): spec for spec in specs
            }
            for fut in as_completed(futures):
                spec = futures[fut]
                probed = fut.result()
                checks.append(_agent_check_from_probe(spec, probed))

    # 并行完成后按名称排序，便于前端展示稳定
    infra_names = {"PostgreSQL", "Redis"}
    infra = [c for c in checks if c["name"] in infra_names]
    agents = sorted([c for c in checks if c["name"] not in infra_names], key=lambda x: x["name"])
    checks = infra + agents

    down_count = len([item for item in checks if item["status"] != "healthy"])
    overall = "healthy" if down_count == 0 else ("degraded" if down_count < len(checks) else "down")
    return {
        "overall_status": overall,
        "deploy_mode": settings.deploy_mode,
        "checked_at": int(time.time()),
        "checks": checks,
    }


def build_health_overview(*, use_cache: bool = True) -> dict:
    now = time.monotonic()
    if use_cache:
        with _health_cache_lock:
            cached = _health_cache.get("data")
            cached_at = float(_health_cache.get("at") or 0)
            if cached and now - cached_at < _HEALTH_CACHE_TTL_SEC:
                return cached

    data = _build_health_overview_uncached()
    with _health_cache_lock:
        _health_cache["at"] = now
        _health_cache["data"] = data
    return data


def invalidate_health_cache() -> None:
    with _health_cache_lock:
        _health_cache["at"] = 0.0
        _health_cache["data"] = None
