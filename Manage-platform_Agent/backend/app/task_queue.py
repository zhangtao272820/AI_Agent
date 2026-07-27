import asyncio
import json
import time

from redis.asyncio import from_url
from sqlalchemy.orm import Session

from .config import get_settings
from .db import SessionLocal
from .db_models import TaskRecord
from .graph_flow import build_graph
from .manager_bridge import run_manager_chat
from .tenant_usage import record_task_usage
from .metrics import task_duration_seconds
from .models import PlatformEvent
from .qwen_client import QwenClient

settings = get_settings()
redis_client = from_url(settings.redis_url, decode_responses=True)
QUEUE_KEY = "clawhive:tasks"
DLQ_KEY = "clawhive:tasks:dlq"

qwen = QwenClient()
task_graph = build_graph(qwen)

MANAGER_TARGET_ALIASES = frozenset(
    {"manager", "manager_agent", "Manager_Agent", "13106", "orchestrator", "总管"}
)


def _is_manager_target(target: str) -> bool:
    t = str(target or "").strip()
    if not t or t.lower() == "auto":
        return True
    return t in MANAGER_TARGET_ALIASES or t.lower() in {x.lower() for x in MANAGER_TARGET_ALIASES}


async def _invoke_manager_task(record: TaskRecord) -> dict:
    user_id = str(record.created_by or "").strip() or None
    tenant_id = str(record.tenant_id or "default").strip() or "default"
    trace_id = str(record.trace_id or record.task_id or "").strip() or None
    return await run_manager_chat(
        record.task,
        user_id=user_id,
        tenant_id=tenant_id,
        trace_id=trace_id,
        session_id=f"platform_{record.task_id}",
    )


async def enqueue_task(task_id: str) -> None:
    await redis_client.lpush(QUEUE_KEY, task_id)


def _load_task(db: Session, task_id: str) -> TaskRecord | None:
    return db.query(TaskRecord).filter(TaskRecord.task_id == task_id).first()


async def process_one(task_id: str, broadcaster):
    start = time.perf_counter()
    db = SessionLocal()
    try:
        record = _load_task(db, task_id)
        if not record:
            return
        record.status = "running"
        db.commit()

        await broadcaster(
            PlatformEvent(
                event_type="task.started",
                payload={"task_id": task_id, "task": record.task, "priority": record.priority},
            )
        )

        target = str(record.target_agent_id or "").strip()
        if _is_manager_target(target):
            mgr = await _invoke_manager_task(record)
            failed = not bool(mgr.get("ok"))
            record.status = "failed" if failed else "success"
            record.summary = str(mgr.get("final") or mgr.get("error") or "Manager 编排完成")[:4000]
            record.planner_output = json.dumps(
                {
                    "manager_ws": mgr.get("manager_ws"),
                    "run_id": mgr.get("run_id"),
                    "phase_timeline": mgr.get("phase_timeline") or [],
                    "token_summary": mgr.get("token_summary"),
                    "wall_clock_ms": mgr.get("wall_clock_ms"),
                },
                ensure_ascii=False,
            )
            record.execution_output = record.summary
            token_total = 0
            ts = mgr.get("token_summary")
            if isinstance(ts, dict):
                token_total = int(ts.get("totalTokens") or ts.get("total_tokens") or 0)
            record.cost_estimate_tokens = token_total or max(1, len(record.summary) // 4)
            if failed:
                await _requeue_or_dlq(record, str(mgr.get("error") or "manager run failed"))
        else:
            final_state = task_graph.invoke(
                {
                    "task": record.task,
                    "priority": record.priority,
                    "target_agent_id": record.target_agent_id,
                    "context": {},
                }
            )
            failed = bool(final_state.get("failed", False))
            record.status = "failed" if failed else "success"
            record.summary = final_state.get("summary", "任务执行完成")
            record.planner_output = final_state.get("planner_output", "")
            record.execution_output = final_state.get("execution_output", "")
            record.cost_estimate_tokens = (
                len(record.planner_output) + len(record.execution_output)
            ) // 4
            if failed:
                await _requeue_or_dlq(record, "图执行返回 failed 状态")
        if record.status == "success" and int(record.cost_estimate_tokens or 0) > 0:
            record_task_usage(
                db,
                tenant_id=str(record.tenant_id or "default"),
                task_id=record.task_id,
                tokens=int(record.cost_estimate_tokens or 0),
                username=str(record.created_by or ""),
            )
        db.commit()

        await broadcaster(
            PlatformEvent(
                event_type="task.finished",
                payload={
                    "task_id": record.task_id,
                    "status": record.status,
                    "summary": record.summary,
                    "planner_output": record.planner_output,
                    "execution_output": record.execution_output,
                    "cost_estimate_tokens": record.cost_estimate_tokens,
                    "phase_timeline": (
                        json.loads(record.planner_output).get("phase_timeline")
                        if str(record.planner_output or "").startswith("{")
                        else []
                    ),
                    "token_summary": (
                        json.loads(record.planner_output).get("token_summary")
                        if str(record.planner_output or "").startswith("{")
                        else None
                    ),
                },
            )
        )
    except Exception as exc:  # noqa: BLE001
        record = _load_task(db, task_id)
        if record:
            await _requeue_or_dlq(record, str(exc))
            db.commit()
        raise
    finally:
        db.close()
        task_duration_seconds.observe(time.perf_counter() - start)


async def _requeue_or_dlq(record: TaskRecord, error: str):
    record.retry_count += 1
    record.last_error = error
    if record.retry_count <= record.max_retries:
        record.status = "queued"
        await enqueue_task(record.task_id)
    else:
        record.status = "dead"
        await redis_client.lpush(DLQ_KEY, record.task_id)


async def worker_loop(broadcaster):
    while True:
        item = await redis_client.brpop(QUEUE_KEY, timeout=5)
        if not item:
            await asyncio.sleep(0.2)
            continue
        _, task_id = item
        try:
            await process_one(task_id, broadcaster)
        except Exception as exc:  # noqa: BLE001
            await broadcaster(
                PlatformEvent(
                    event_type="task.error",
                    payload={"task_id": task_id, "error": str(exc)},
                )
            )
