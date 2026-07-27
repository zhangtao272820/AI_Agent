"""AgentRunner protocol + shared helpers."""

from __future__ import annotations

import socket
import time
from typing import Protocol
from urllib.parse import urlparse


class AgentRunner(Protocol):
    def start(self, name: str) -> bool: ...

    def stop(self, name: str) -> bool: ...

    def list_states(self) -> dict[str, bool]: ...

    def restart(
        self,
        name: str,
        *,
        build: bool = False,
        force_recreate: bool = False,
    ) -> dict[str, str | bool]: ...

    def restart_manager_stack(self, *, build: bool = False) -> dict[str, str | bool]: ...

    def drain(self, name: str) -> dict[str, str | bool]: ...

    def rolling_restart(self, name: str, *, timeout_sec: float = 120.0) -> dict[str, str | bool]: ...


def is_endpoint_reachable(endpoint: str) -> bool:
    if not endpoint:
        return False
    try:
        parsed = urlparse(endpoint)
        host = parsed.hostname
        port = parsed.port
        if not host or not port:
            return False
        with socket.create_connection((host, port), timeout=1.2):
            return True
    except Exception:
        return False


def wait_endpoint(
    endpoint: str,
    *,
    want_up: bool,
    timeout_sec: float = 90.0,
    poll_sec: float = 2.0,
) -> bool:
    deadline = time.monotonic() + max(5.0, timeout_sec)
    while time.monotonic() < deadline:
        up = is_endpoint_reachable(endpoint)
        if want_up and up:
            return True
        if (not want_up) and (not up):
            return True
        time.sleep(poll_sec)
    return False
