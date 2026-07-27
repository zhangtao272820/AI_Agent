"""Kubernetes Deployment runner (scale / rollout)."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from ..config import get_settings
from ..managed_agents import managed_agent_specs
from .base import wait_endpoint

settings = get_settings()

MANAGER_STACK_DEPLOYMENTS = (
    "db_agent",
    "rag_agent",
    "code_assistent_agent",
    "extractor_agent",
    "ai_admin_agent",
    "manager_agent",
)


def _spec_index() -> dict[str, dict[str, str]]:
    return {spec["name"]: spec for spec in managed_agent_specs()}


def _deployment_of(name: str) -> str:
    spec = _spec_index().get(name)
    if not spec:
        raise ValueError(f"Unknown agent: {name}")
    dep = str(spec.get("k8s_deployment") or spec.get("docker_service") or "").strip()
    if not dep:
        raise ValueError(f"No k8s_deployment mapping for agent: {name}")
    return dep


def _apps_v1():
    try:
        from kubernetes import client, config
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "kubernetes package not installed; pip install kubernetes"
        ) from exc

    kubeconfig = str(getattr(settings, "k8s_kubeconfig", None) or "").strip()
    try:
        if kubeconfig:
            config.load_kube_config(config_file=kubeconfig)
        else:
            try:
                config.load_incluster_config()
            except config.ConfigException:
                config.load_kube_config()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"failed to load kube config: {exc}") from exc
    return client.AppsV1Api()


def _namespace() -> str:
    return str(getattr(settings, "k8s_namespace", None) or "clawhive").strip() or "clawhive"


def _scale(deployment: str, replicas: int) -> None:
    api = _apps_v1()
    ns = _namespace()
    body = {"spec": {"replicas": int(replicas)}}
    api.patch_namespaced_deployment_scale(name=deployment, namespace=ns, body=body)


def _ready_replicas(deployment: str) -> int:
    api = _apps_v1()
    ns = _namespace()
    dep = api.read_namespaced_deployment(name=deployment, namespace=ns)
    status = getattr(dep, "status", None)
    return int(getattr(status, "ready_replicas", None) or 0)


def _wait_replicas(
    deployment: str,
    *,
    want_ready: bool,
    timeout_sec: float,
    min_ready: int = 1,
) -> bool:
    want = max(1, int(min_ready))
    deadline = time.monotonic() + max(5.0, timeout_sec)
    while time.monotonic() < deadline:
        ready = _ready_replicas(deployment)
        if want_ready and ready >= want:
            return True
        if (not want_ready) and ready == 0:
            return True
        time.sleep(2.0)
    return False


def _hpa_min_replicas(deployment: str) -> int | None:
    """Return HPA minReplicas for a Deployment of the same name, if present."""
    try:
        from kubernetes import client
    except ImportError:
        return None
    try:
        # Ensure kube config is loaded via AppsV1 path.
        _apps_v1()
        api = client.AutoscalingV2Api()
        hpa = api.read_namespaced_horizontal_pod_autoscaler(
            name=deployment, namespace=_namespace()
        )
        spec = getattr(hpa, "spec", None)
        mn = getattr(spec, "min_replicas", None) if spec else None
        if mn is None:
            return None
        return max(1, int(mn))
    except Exception:  # noqa: BLE001
        return None


def _start_replica_count(deployment: str) -> int:
    return _hpa_min_replicas(deployment) or 1


def _rollout_restart(deployment: str) -> None:
    api = _apps_v1()
    ns = _namespace()
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    body: dict[str, Any] = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "kubectl.kubernetes.io/restartedAt": now,
                    }
                }
            }
        }
    }
    api.patch_namespaced_deployment(name=deployment, namespace=ns, body=body)


class KubernetesRunner:
    mode = "kubernetes"

    def start(self, name: str) -> bool:
        dep = _deployment_of(name)
        want = _start_replica_count(dep)
        before = _ready_replicas(dep)
        _scale(dep, want)
        _wait_replicas(dep, want_ready=True, timeout_sec=90.0, min_ready=want)
        after = _ready_replicas(dep)
        return before < want and after >= want

    def stop(self, name: str) -> bool:
        dep = _deployment_of(name)
        before = _ready_replicas(dep)
        _scale(dep, 0)
        _wait_replicas(dep, want_ready=False, timeout_sec=60.0)
        after = _ready_replicas(dep)
        return before >= 1 and after == 0

    def list_states(self) -> dict[str, bool]:
        states: dict[str, bool] = {}
        try:
            api = _apps_v1()
            ns = _namespace()
        except Exception:  # noqa: BLE001
            # degrade: endpoint probe
            from .base import is_endpoint_reachable

            for spec in managed_agent_specs():
                states[spec["name"]] = is_endpoint_reachable(spec.get("endpoint", ""))
            return states

        for spec in managed_agent_specs():
            dep = str(spec.get("k8s_deployment") or spec.get("docker_service") or "").strip()
            if not dep:
                from .base import is_endpoint_reachable

                states[spec["name"]] = is_endpoint_reachable(spec.get("endpoint", ""))
                continue
            try:
                states[spec["name"]] = _ready_replicas(dep) >= 1
            except Exception:  # noqa: BLE001
                from .base import is_endpoint_reachable

                states[spec["name"]] = is_endpoint_reachable(spec.get("endpoint", ""))
        _ = api, ns
        return states

    def restart(
        self,
        name: str,
        *,
        build: bool = False,
        force_recreate: bool = False,
    ) -> dict[str, str | bool]:
        _ = build, force_recreate
        dep = _deployment_of(name)
        want = _start_replica_count(dep)
        _rollout_restart(dep)
        ok = _wait_replicas(dep, want_ready=True, timeout_sec=120.0, min_ready=want)
        return {"deployment": dep, "ok": ok, "mode": self.mode, "replicas": want}

    def restart_manager_stack(self, *, build: bool = False) -> dict[str, str | bool]:
        _ = build
        errors: list[str] = []
        for dep in MANAGER_STACK_DEPLOYMENTS:
            try:
                _rollout_restart(dep)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{dep}:{exc}")
        return {
            "ok": not errors,
            "mode": self.mode,
            "services": ",".join(MANAGER_STACK_DEPLOYMENTS),
            "detail": ";".join(errors)[:500],
        }

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
        dep = _deployment_of(name)
        want = _start_replica_count(dep)
        endpoint = str(spec.get("endpoint") or "")
        steps: list[str] = []
        try:
            _rollout_restart(dep)
            steps.append("rollout")
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"rollout failed: {exc}", "steps": ",".join(steps)}

        ready = _wait_replicas(dep, want_ready=True, timeout_sec=timeout_sec, min_ready=want)
        steps.append("ready" if ready else "wait_ready_timeout")
        if endpoint and ready:
            ep_ok = wait_endpoint(endpoint, want_up=True, timeout_sec=min(60.0, timeout_sec / 2))
            steps.append("endpoint_up" if ep_ok else "endpoint_timeout")
            ready = ready and ep_ok
        return {
            "ok": bool(ready),
            "steps": ",".join(steps),
            "mode": self.mode,
            "deployment": dep,
            "endpoint": endpoint,
            "replicas": want,
        }
