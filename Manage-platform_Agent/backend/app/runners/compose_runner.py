"""Docker Compose runner (LAN / docker.sock)."""

from __future__ import annotations

import shutil
import subprocess
from typing import Callable

from ..config import get_settings
from ..managed_agents import managed_agent_specs
from .base import is_endpoint_reachable, wait_endpoint

settings = get_settings()

MANAGER_STACK_SERVICES = (
    "db_agent",
    "rag_agent",
    "code_assistent_agent",
    "extractor_agent",
    "ai_admin_agent",
    "music_agent",
    "video_agent",
    "multimodal_agent",
    "manager_agent",
)


def _spec_index() -> dict[str, dict[str, str]]:
    return {spec["name"]: spec for spec in managed_agent_specs()}


def _compose_executable() -> list[str]:
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    return ["docker", "compose"]


def _compose_cmd(*args: str) -> list[str]:
    return [
        *_compose_executable(),
        "--env-file",
        settings.compose_env_file_path,
        "-f",
        settings.compose_file_path,
        *args,
    ]


def _run_cmd(cmd: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)  # noqa: S603
    except FileNotFoundError as exc:
        missing = cmd[0] if cmd else "command"
        return subprocess.CompletedProcess(
            cmd,
            127,
            "",
            f"{missing} not found: {exc}",
        )


def _list_docker_running_services() -> set[str]:
    known = {
        str(spec.get("docker_service") or "").strip()
        for spec in managed_agent_specs()
        if str(spec.get("docker_service") or "").strip()
    }
    out = _run_cmd(["docker", "ps", "--format", "{{.Names}}"])
    if out.returncode != 0:
        return set()
    running = {line.strip() for line in out.stdout.splitlines() if line.strip()}
    return known & running


def _docker_service_of(name: str) -> str:
    spec = _spec_index().get(name)
    if not spec:
        raise ValueError(f"Unknown agent: {name}")
    service = spec.get("docker_service")
    if not service:
        raise ValueError(f"No docker service mapping for agent: {name}")
    return service


class ComposeRunner:
    mode = "docker"

    def start(self, name: str) -> bool:
        service = _docker_service_of(name)
        before = _list_docker_running_services()
        cmd = _compose_cmd("up", "-d", service)
        out = _run_cmd(cmd, cwd=settings.workspace_root)
        if out.returncode != 0:
            raise RuntimeError((out.stderr or out.stdout).strip() or f"failed to start {service}")
        after = _list_docker_running_services()
        return service not in before and service in after

    def stop(self, name: str) -> bool:
        service = _docker_service_of(name)
        before = _list_docker_running_services()
        cmd = _compose_cmd("stop", service)
        out = _run_cmd(cmd, cwd=settings.workspace_root)
        if out.returncode != 0:
            raise RuntimeError((out.stderr or out.stdout).strip() or f"failed to stop {service}")
        after = _list_docker_running_services()
        return service in before and service not in after

    def list_states(self) -> dict[str, bool]:
        running = _list_docker_running_services()
        use_probe_fallback = not running
        states: dict[str, bool] = {}
        for spec in managed_agent_specs():
            service = spec.get("docker_service", "")
            if service and not use_probe_fallback:
                states[spec["name"]] = service in running
                continue
            endpoint = spec.get("endpoint", "")
            states[spec["name"]] = is_endpoint_reachable(endpoint)
        return states

    def restart(
        self,
        name: str,
        *,
        build: bool = False,
        force_recreate: bool = False,
    ) -> dict[str, str | bool]:
        service = _docker_service_of(name)
        args = ["up", "-d"]
        if build:
            args.append("--build")
        if force_recreate:
            args.append("--force-recreate")
        args.append(service)
        cmd = _compose_cmd(*args)
        out = _run_cmd(cmd, cwd=settings.workspace_root)
        ok = out.returncode == 0
        detail = (out.stderr or out.stdout or "").strip()
        if not ok:
            raise RuntimeError(detail or f"failed to restart {service}")
        return {"service": service, "ok": ok, "detail": detail[:500]}

    def restart_manager_stack(self, *, build: bool = False) -> dict[str, str | bool]:
        if build:
            cmd = _compose_cmd("up", "-d", "--build", *MANAGER_STACK_SERVICES)
        else:
            cmd = _compose_cmd("restart", *MANAGER_STACK_SERVICES)
        out = _run_cmd(cmd, cwd=settings.workspace_root)
        ok = out.returncode == 0
        detail = (out.stderr or out.stdout or "").strip()
        if not ok:
            raise RuntimeError(detail or "failed to restart manager stack")
        return {"ok": ok, "services": ",".join(MANAGER_STACK_SERVICES), "detail": detail[:500]}

    def drain(self, name: str) -> dict[str, str | bool]:
        from ..agent_runtime_status import assert_agent_controllable

        spec = assert_agent_controllable(name)
        stopped = self.stop(name)
        endpoint = str(spec.get("endpoint") or "")
        down_ok = wait_endpoint(endpoint, want_up=False, timeout_sec=60.0) if endpoint else True
        return {
            "ok": bool(stopped or down_ok),
            "stopped": bool(stopped),
            "endpoint_down": bool(down_ok),
            "mode": self.mode,
        }

    def rolling_restart(self, name: str, *, timeout_sec: float = 120.0) -> dict[str, str | bool]:
        from ..agent_runtime_status import assert_agent_controllable

        spec = assert_agent_controllable(name)
        endpoint = str(spec.get("endpoint") or "")
        steps: list[str] = []
        try:
            self.stop(name)
            steps.append("stopped")
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"stop failed: {exc}", "steps": ",".join(steps)}

        if endpoint:
            if not wait_endpoint(endpoint, want_up=False, timeout_sec=min(60.0, timeout_sec / 2)):
                steps.append("wait_down_timeout")
            else:
                steps.append("down")

        try:
            self.start(name)
            steps.append("started")
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"start failed: {exc}", "steps": ",".join(steps)}

        ready = True
        if endpoint:
            ready = wait_endpoint(endpoint, want_up=True, timeout_sec=timeout_sec)
            steps.append("ready" if ready else "wait_up_timeout")

        return {
            "ok": bool(ready),
            "steps": ",".join(steps),
            "mode": self.mode,
            "endpoint": endpoint,
        }


def _bulk(ops: Callable[[str], bool]) -> dict[str, bool]:
    results: dict[str, bool] = {}
    for spec in managed_agent_specs():
        try:
            results[spec["name"]] = ops(spec["name"])
        except Exception:  # noqa: BLE001
            results[spec["name"]] = False
    return results
