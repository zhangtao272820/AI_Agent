"""Select AgentRunner by AGENT_CONTROL_MODE."""

from __future__ import annotations

from functools import lru_cache

from ..config import get_settings
from .compose_runner import ComposeRunner
from .kubernetes_runner import KubernetesRunner
from .local_runner import LocalRunner


@lru_cache(maxsize=1)
def get_agent_runner():
    mode = get_settings().agent_control_mode.lower().strip()
    if mode in ("kubernetes", "k8s"):
        return KubernetesRunner()
    if mode == "docker":
        return ComposeRunner()
    return LocalRunner()
