"""Music Agent 异步任务队列（进程内 + 文件持久化）。"""
from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

JobStatus = Literal["queued", "running", "done", "failed", "canceled"]

_DATA = Path(__file__).resolve().parent.parent / ".data" / "music-jobs"
_LOCK = threading.Lock()
_ACTIVE = 0
_MAX = 2
_WAITERS: list[threading.Event] = []


@dataclass
class MusicJobRecord:
    id: str
    status: JobStatus
    created_at: str
    task: str
    action: str = "compose"
    started_at: str | None = None
    finished_at: str | None = None
    stage: str | None = None
    pct: int | None = None
    error: str | None = None
    result: dict[str, Any] | None = None
    events: list[dict[str, Any]] = field(default_factory=list)


def _jobs_dir() -> Path:
    _DATA.mkdir(parents=True, exist_ok=True)
    return _DATA


def _job_path(job_id: str) -> Path:
    return _jobs_dir() / f"{job_id}.json"


def write_job(job: MusicJobRecord) -> None:
    try:
        _job_path(job.id).write_text(
            json.dumps(job.__dict__, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def read_job(job_id: str) -> MusicJobRecord | None:
    try:
        raw = _job_path(job_id).read_text(encoding="utf-8")
        data = json.loads(raw)
        return MusicJobRecord(**data)
    except Exception:
        return None


def create_job_id() -> str:
    return f"mj_{uuid.uuid4().hex[:12]}"


def _acquire_slot() -> None:
    global _ACTIVE
    with _LOCK:
        if _ACTIVE < _MAX:
            _ACTIVE += 1
            return
    ev = threading.Event()
    with _LOCK:
        _WAITERS.append(ev)
    ev.wait(timeout=600)
    with _LOCK:
        _ACTIVE += 1


def _release_slot() -> None:
    global _ACTIVE
    with _LOCK:
        _ACTIVE = max(0, _ACTIVE - 1)
        if _WAITERS:
            nxt = _WAITERS.pop(0)
            nxt.set()


class JobEventSink:
    """duck-type WebSocket：收集 stage/done/error 供 poll API。"""

    def __init__(self, job_id: str):
        self.job_id = job_id

    async def send_text(self, text: str) -> None:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return
        job = read_job(self.job_id)
        if not job:
            return
        t = str(payload.get("type") or "")
        if t == "stage":
            job.stage = str(payload.get("stage") or "")
            msg = payload.get("message")
            if isinstance(msg, str) and msg.strip():
                job.events.append({"type": "stage", "stage": job.stage, "message": msg[:500]})
        elif t == "thinking":
            job.events.append({"type": "thinking", "text": str(payload.get("text") or "")[:300]})
        elif t == "done":
            job.status = "done"
            job.result = {k: v for k, v in payload.items() if k != "type"}
            job.finished_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        elif t == "error":
            job.status = "failed"
            job.error = str(payload.get("message") or "error")
            job.finished_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_job(job)


def enqueue_music_job(
    *,
    task: str,
    action: str,
    payload: dict[str, Any],
    runner: Callable,
) -> str:
    job_id = create_job_id()
    job = MusicJobRecord(
        id=job_id,
        status="queued",
        created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        task=task[:500],
        action=action,
    )
    write_job(job)

    def _worker() -> None:
        _acquire_slot()
        running = read_job(job_id)
        if not running:
            _release_slot()
            return
        running.status = "running"
        running.started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_job(running)
        sink = JobEventSink(job_id)
        try:
            import asyncio

            asyncio.run(runner(sink, payload))
            cur = read_job(job_id)
            if cur and cur.status == "running":
                cur.status = "done" if cur.result else "failed"
                if not cur.error and cur.status == "failed":
                    cur.error = "no result"
                cur.finished_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                write_job(cur)
        except Exception as ex:
            cur = read_job(job_id) or running
            cur.status = "failed"
            cur.error = str(ex)
            cur.finished_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            write_job(cur)
        finally:
            _release_slot()

    threading.Thread(target=_worker, daemon=True).start()
    return job_id
