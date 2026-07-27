import math
import threading
from collections import defaultdict, deque

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.responses import Response

api_requests_total = Counter("clawhive_api_requests_total", "API 请求总数", ["endpoint", "method"])
llm_calls_total = Counter("clawhive_llm_calls_total", "模型调用总数")
task_duration_seconds = Histogram("clawhive_task_duration_seconds", "任务执行耗时")
skill_invocations_total = Counter(
    "clawhive_skill_invocations_total",
    "技能调用总数",
    ["skill_id", "version", "agent"],
)
skill_errors_total = Counter(
    "clawhive_skill_errors_total",
    "技能错误总数",
    ["skill_id", "version", "error_code"],
)
skill_duration_seconds = Histogram(
    "clawhive_skill_duration_seconds",
    "技能执行耗时",
    ["skill_id", "version"],
)

skill_cost_tokens_total = Counter(
    "clawhive_skill_cost_tokens_total",
    "技能调用成本（tokens 口径，MVP 默认 0）",
    ["skill_id", "version"],
)

skill_external_api_cost_total = Counter(
    "clawhive_skill_external_api_cost_total",
    "技能外部 API 成本总和",
    ["skill_id", "version"],
)

skill_total_cost_total = Counter(
    "clawhive_skill_total_cost_total",
    "技能综合成本总和",
    ["skill_id", "version"],
)

skill_success_total = Counter(
    "clawhive_skill_success_total",
    "技能成功调用总数",
    ["skill_id", "version"],
)

skill_failure_total = Counter(
    "clawhive_skill_failure_total",
    "技能失败调用总数",
    ["skill_id", "version"],
)

skill_success_rate = Gauge(
    "clawhive_skill_success_rate",
    "技能成功率（0-1，基于内存滑动统计）",
    ["skill_id", "version"],
)

skill_latency_p95_ms = Gauge(
    "clawhive_skill_latency_p95_ms",
    "技能延迟 p95（ms，基于最近窗口估算）",
    ["skill_id", "version"],
)

tenant_tokens_used_month = Gauge(
    "clawhive_tenant_tokens_used_month",
    "租户当月 Token 用量",
    ["tenant_id"],
)

tenant_quota_utilization = Gauge(
    "clawhive_tenant_quota_utilization",
    "租户配额使用率 0..1（无配额时为 0）",
    ["tenant_id"],
)

tenant_quota_exceeded = Gauge(
    "clawhive_tenant_quota_exceeded",
    "租户配额是否已用尽（1=是）",
    ["tenant_id"],
)

skill_catalog_install_total = Counter(
    "clawhive_skill_catalog_install_total",
    "技能市场赋能次数",
    ["registry_id", "result"],
)

skill_sync_total = Counter(
    "clawhive_skill_sync_total",
    "技能同步次数",
    ["sync_status"],
)

skill_registry_fetch_total = Counter(
    "clawhive_skill_registry_fetch_total",
    "Registry index 拉取次数",
    ["registry_id", "result"],
)

agent_up = Gauge(
    "clawhive_agent_up",
    "子 Agent 探活状态（1=healthy）",
    ["agent"],
)

agent_probe_latency_ms = Gauge(
    "clawhive_agent_probe_latency_ms",
    "子 Agent 探活延迟（ms）",
    ["agent"],
)

agent_counter_total = Gauge(
    "clawhive_agent_counter_total",
    "子 Agent 指标计数快照",
    ["agent", "counter"],
)

_lock = threading.Lock()
_invocation_mem = defaultdict(int)  # (skill_id, version) -> total
_success_mem = defaultdict(int)  # (skill_id, version) -> success
_latency_windows_ms = defaultdict(lambda: deque(maxlen=200))  # (skill_id, version) -> deque[ms]


def update_agent_probe_metrics(
    *,
    agent: str,
    up: float,
    latency_ms: float,
    counters: list[tuple[str, float]] | None = None,
) -> None:
    name = str(agent or "").strip()
    if not name:
        return
    agent_up.labels(agent=name).set(1.0 if up >= 0.5 else 0.0)
    agent_probe_latency_ms.labels(agent=name).set(max(0.0, float(latency_ms or 0)))
    for counter_name, value in counters or []:
        cname = str(counter_name or "unknown").strip() or "unknown"
        agent_counter_total.labels(agent=name, counter=cname).set(float(value))


def update_skill_derived_metrics(*, skill_id: str, version: str, status: str, duration_ms: int) -> None:
    key = (skill_id, version)
    with _lock:
        _invocation_mem[key] += 1
        if status == "success":
            _success_mem[key] += 1

        inv = _invocation_mem[key]
        suc = _success_mem[key]
        rate = (suc / inv) if inv else 0.0
        skill_success_rate.labels(skill_id=skill_id, version=version).set(rate)

        win = _latency_windows_ms[key]
        win.append(int(duration_ms or 0))
        if win:
            sorted_win = sorted(win)
            # nearest-rank for p95
            idx = int(math.ceil(0.95 * len(sorted_win))) - 1
            idx = max(0, min(idx, len(sorted_win) - 1))
            p95_ms = sorted_win[idx]
            skill_latency_p95_ms.labels(skill_id=skill_id, version=version).set(p95_ms)


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
