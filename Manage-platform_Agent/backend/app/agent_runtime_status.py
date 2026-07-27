"""Agent 运行态契约：desired / actual / version（P0 控制面）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .config import get_settings
from .db_models import AgentRecord
from .managed_agents import managed_agent_specs
from .process_control import list_process_states

settings = get_settings()


def _map_desired(status: str | None) -> str:
    s = str(status or "").strip().lower()
    if s in ("offline", "down", "stopped", "stop"):
        return "stopped"
    # online / empty / unknown → 期望运行（托管目录默认应在线）
    return "running"


def _control_mode() -> str:
    return settings.agent_control_mode.lower().strip()


def is_agent_controllable(name: str) -> bool:
    specs = {s["name"]: s for s in managed_agent_specs()}
    spec = specs.get(name)
    if not spec:
        return False
    mode = _control_mode()
    if mode in ("kubernetes", "k8s"):
        return bool(str(spec.get("k8s_deployment") or spec.get("docker_service") or "").strip())
    if mode == "docker":
        return bool(str(spec.get("docker_service") or "").strip())
    return bool(str(spec.get("cwd") or "").strip())


def assert_agent_controllable(name: str) -> dict[str, str]:
    """启停前门禁：未知或无 runner 映射则抛 ValueError。"""
    specs = {s["name"]: s for s in managed_agent_specs()}
    spec = specs.get(name)
    if not spec:
        raise ValueError(f"未登记 Agent，无法管控: {name}")
    mode = _control_mode()
    if mode in ("kubernetes", "k8s"):
        if not str(spec.get("k8s_deployment") or spec.get("docker_service") or "").strip():
            raise ValueError(f"Agent 无 k8s_deployment，无法启停: {name}")
    elif mode == "docker":
        if not str(spec.get("docker_service") or "").strip():
            raise ValueError(f"Agent 无 docker_service，无法启停: {name}")
    elif not str(spec.get("cwd") or "").strip():
        raise ValueError(f"Agent 无本地 cwd，无法启停: {name}")
    return spec


def build_agent_runtime_status(
    db: Session | None = None,
    *,
    config_version: str = "",
    config_signed: bool | None = None,
    agent_name: str | None = None,
) -> dict[str, Any]:
    actual_map = list_process_states()
    image_version = str(getattr(settings, "clawhive_image_tag", None) or "").strip() or "prod"

    desired_by_name: dict[str, str] = {}
    if db is not None:
        for row in db.query(AgentRecord).all():
            desired_by_name[row.name] = _map_desired(row.status)

    agents: list[dict[str, Any]] = []
    running: dict[str, bool] = {}
    for spec in managed_agent_specs():
        name = spec["name"]
        if agent_name and name != agent_name:
            continue
        actual_running = bool(actual_map.get(name))
        running[name] = actual_running
        desired = desired_by_name.get(name) or "running"
        agents.append(
            {
                "name": name,
                "category": spec.get("category") or "general",
                "endpoint": spec.get("endpoint") or "",
                "docker_service": spec.get("docker_service") or "",
                "k8s_deployment": spec.get("k8s_deployment")
                or spec.get("docker_service")
                or "",
                "desired_state": desired,
                "actual_state": "running" if actual_running else "stopped",
                "image_version": image_version,
                "config_version": config_version or "",
                "controllable": is_agent_controllable(name),
            }
        )

    signed = bool(config_signed) if config_signed is not None else bool(str(config_version or "").strip())
    return {
        "ok": True,
        "control_mode": settings.agent_control_mode,
        "running": running,
        "agents": agents,
        "config_package": {
            "version": config_version or "",
            "signed": signed,
        },
        "image_version": image_version,
    }
