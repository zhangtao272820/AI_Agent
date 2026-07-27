import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .config import get_settings

settings = get_settings()

_CLUSTER_CACHE_TTL_SEC = 15.0
_cluster_cache_lock = threading.Lock()
_cluster_cache: dict = {"at": 0.0, "data": None}


def _manager_base_url() -> str:
    host = str(settings.manager_agent_host or "localhost").strip()
    port = str(settings.manager_agent_port or "13106").strip()
    return f"http://{host}:{port}"


def _fetch_json(url: str, timeout_sec: float = 3.0) -> dict:
    started = time.perf_counter()
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:  # noqa: S310
            raw = resp.read(512_000)
            latency = int((time.perf_counter() - started) * 1000)
            text = raw.decode("utf-8", errors="replace") or ""
            if text.lstrip().startswith("<"):
                return {
                    "ok": False,
                    "url": url,
                    "latency_ms": latency,
                    "status_code": getattr(resp, "status", 200),
                    "error": "返回 HTML 页面（manager_agent 未启动或端口错误）",
                }
            try:
                payload = json.loads(text) if text.strip() else {}
            except json.JSONDecodeError as exc:
                return {
                    "ok": False,
                    "url": url,
                    "latency_ms": latency,
                    "status_code": getattr(resp, "status", 200),
                    "error": f"JSON 解析失败: {exc}; 片段: {text[:120]}",
                }
            return {
                "ok": True,
                "url": url,
                "latency_ms": latency,
                "status_code": getattr(resp, "status", 200),
                "data": payload,
            }
    except urllib.error.HTTPError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        body = ""
        try:
            body = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            pass
        return {
            "ok": False,
            "url": url,
            "latency_ms": latency,
            "status_code": exc.code,
            "error": body[:400] or str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - started) * 1000)
        hint = str(exc)
        if "Connection refused" in hint or "Name or service not known" in hint:
            hint = f"无法连接 Manager（请 docker compose up -d manager_agent）: {hint}"
        return {
            "ok": False,
            "url": url,
            "latency_ms": latency,
            "status_code": None,
            "error": hint,
        }


def _build_manager_cluster_status_uncached() -> dict:
    base = _manager_base_url().rstrip("/")
    metrics_url = f"{base}/api/metrics"
    registry_url = f"{base}/api/agents/registry"
    with ThreadPoolExecutor(max_workers=2) as pool:
        fm = pool.submit(_fetch_json, metrics_url)
        fr = pool.submit(_fetch_json, registry_url)
        metrics = fm.result()
        registry = fr.result()
    ok = bool(metrics.get("ok") and registry.get("ok"))
    err_parts = []
    if not metrics.get("ok"):
        err_parts.append(f"metrics: {metrics.get('error') or 'failed'}")
    if not registry.get("ok"):
        err_parts.append(f"registry: {registry.get('error') or 'failed'}")
    return {
        "ok": ok,
        "manager_endpoint": base,
        "checked_at": int(time.time()),
        "metrics": metrics,
        "registry": registry,
        "error": "; ".join(err_parts) if err_parts else None,
    }


def build_manager_cluster_status(*, use_cache: bool = True) -> dict:
    now = time.monotonic()
    if use_cache:
        with _cluster_cache_lock:
            cached = _cluster_cache.get("data")
            cached_at = float(_cluster_cache.get("at") or 0)
            if cached and now - cached_at < _CLUSTER_CACHE_TTL_SEC:
                return cached

    data = _build_manager_cluster_status_uncached()
    with _cluster_cache_lock:
        _cluster_cache["at"] = now
        _cluster_cache["data"] = data
    return data
