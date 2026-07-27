"""Agent process control facade — delegates to runners (local / docker / kubernetes)."""

from __future__ import annotations

from typing import Callable

from .config import get_settings
from .managed_agents import managed_agent_specs
from .runners import get_agent_runner
from .runners.compose_runner import MANAGER_STACK_SERVICES

settings = get_settings()

# Re-export for callers that imported this constant
__all__ = [
    "MANAGER_STACK_SERVICES",
    "list_process_states",
    "start_agent_process",
    "stop_agent_process",
    "start_all_agent_processes",
    "stop_all_agent_processes",
    "restart_agent_process",
    "restart_manager_stack",
    "drain_agent_process",
    "rolling_restart_agent_process",
]


def _bulk(ops: Callable[[str], bool]) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for spec in managed_agent_specs():
        try:
            results[spec["name"]] = ops(spec["name"])
        except Exception:  # noqa: BLE001
            results[spec["name"]] = False
    return results


def list_process_states() -> dict[str, bool]:
    return get_agent_runner().list_states()


def start_agent_process(name: str) -> bool:
    from .agent_runtime_status import assert_agent_controllable

    assert_agent_controllable(name)
    return get_agent_runner().start(name)


def stop_agent_process(name: str) -> bool:
    from .agent_runtime_status import assert_agent_controllable

    assert_agent_controllable(name)
    return get_agent_runner().stop(name)


def start_all_agent_processes() -> dict[str, bool]:
    return _bulk(start_agent_process)


def stop_all_agent_processes() -> dict[str, bool]:
    return _bulk(stop_agent_process)


def restart_agent_process(
    name: str,
    *,
    build: bool = False,
    force_recreate: bool = False,
) -> dict[str, str | bool]:
    from .agent_runtime_status import assert_agent_controllable

    assert_agent_controllable(name)
    return get_agent_runner().restart(name, build=build, force_recreate=force_recreate)


def restart_manager_stack(*, build: bool = False) -> dict[str, str | bool]:
    return get_agent_runner().restart_manager_stack(build=build)


def drain_agent_process(name: str) -> dict[str, str | bool]:
    """摘流量语义：停容器/进程/缩容；调用方负责把 DB desired 标为 offline。"""
    from .agent_runtime_status import assert_agent_controllable

    assert_agent_controllable(name)
    return get_agent_runner().drain(name)


def rolling_restart_agent_process(name: str, *, timeout_sec: float = 120.0) -> dict[str, str | bool]:
    from .agent_runtime_status import assert_agent_controllable

    assert_agent_controllable(name)
    return get_agent_runner().rolling_restart(name, timeout_sec=timeout_sec)
