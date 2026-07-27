"""Admin graph 运行中向 WebSocket 推送中间 thought（ContextVar，不影响业务逻辑）。"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Callable, Optional

_admin_thought_cb: ContextVar[Optional[Callable[[str], None]]] = ContextVar(
    "admin_thought_cb", default=None
)


def set_admin_thought_callback(cb: Callable[[str], None] | None) -> None:
    _admin_thought_cb.set(cb)


def get_admin_thought_callback() -> Callable[[str], None] | None:
    return _admin_thought_cb.get()


def emit_admin_thought(content: str) -> None:
    msg = str(content or "").strip()
    if not msg:
        return
    cb = _admin_thought_cb.get()
    if cb is not None:
        try:
            cb(msg)
        except Exception:
            pass
