"""Local process runner (npm/uvicorn child processes)."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from typing import Callable

from ..config import get_settings
from ..managed_agents import managed_agent_specs
from .base import is_endpoint_reachable, wait_endpoint

settings = get_settings()


@dataclass
class ManagedProcess:
    name: str
    process: subprocess.Popen


_proc_map: dict[str, ManagedProcess] = {}


def _spec_index() -> dict[str, dict[str, str]]:
    return {spec["name"]: spec for spec in managed_agent_specs()}


class LocalRunner:
    mode = "local"

    def start(self, name: str) -> bool:
        spec = _spec_index().get(name)
        if not spec:
            raise ValueError(f"Unknown agent: {name}")

        existing = _proc_map.get(name)
        if existing and existing.process.poll() is None:
            return False

        cwd = spec["cwd"]
        port = spec["port"]
        is_python = spec.get("runner") == "python"
        if is_python:
            cmd = ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", port]
        else:
            cmd = ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", port]

        env = dict(os.environ)
        if is_python:
            env["PORT"] = port

        proc = subprocess.Popen(cmd, cwd=cwd, env=env, shell=False)  # noqa: S603
        _proc_map[name] = ManagedProcess(name=name, process=proc)
        return True

    def stop(self, name: str) -> bool:
        proc = _proc_map.get(name)
        if not proc or proc.process.poll() is not None:
            return False
        proc.process.terminate()
        return True

    def list_states(self) -> dict[str, bool]:
        states: dict[str, bool] = {}
        for spec in managed_agent_specs():
            proc = _proc_map.get(spec["name"])
            if proc and proc.process.poll() is None:
                states[spec["name"]] = True
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
        _ = build, force_recreate
        stopped = self.stop(name)
        started = self.start(name)
        return {"ok": bool(stopped or started), "mode": self.mode, "restarted": bool(started)}

    def restart_manager_stack(self, *, build: bool = False) -> dict[str, str | bool]:
        _ = build

        def _one(n: str) -> bool:
            return self.stop(n) or self.start(n)

        results = _bulk(_one)
        return {"ok": any(results.values()), "mode": self.mode, "results": str(results)[:500]}

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
