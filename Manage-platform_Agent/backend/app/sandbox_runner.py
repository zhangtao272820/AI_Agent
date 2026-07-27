from __future__ import annotations

import argparse
import io
import json
import socket
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from importlib.util import module_from_spec, spec_from_file_location
from typing import Any


@dataclass
class RunnerConfig:
    script_path: str
    func_name: str
    allowed_hosts: set[str]


def _patch_network(allowed_hosts: set[str]) -> None:
    """
    Best-effort network restriction:
    - block outbound connections
    - allow only connections to localhost/allowed hosts
    """

    real_socket = socket.socket
    real_create_connection = getattr(socket, "create_connection", None)

    def _is_allowed_host(host: str) -> bool:
        normalized = host.lower().strip()
        if normalized in ("127.0.0.1", "::1", "localhost"):
            return True
        return normalized in allowed_hosts

    if real_create_connection:
        def create_connection(address, *args, **kwargs):  # type: ignore[no-untyped-def]
            host = ""
            port = None
            if isinstance(address, tuple) and len(address) >= 1:
                host = str(address[0])
                port = address[1] if len(address) >= 2 else None
            else:
                host = str(address)
            if not _is_allowed_host(host):
                raise PermissionError(f"Network access blocked by sandbox: host={host} port={port}")
            return real_create_connection(address, *args, **kwargs)

        socket.create_connection = create_connection  # type: ignore[assignment]

    def blocked_socket(*args, **kwargs):
        s = real_socket(*args, **kwargs)

        real_connect = s.connect
        real_connect_ex = getattr(s, "connect_ex", None)

        def connect(address):  # type: ignore[no-untyped-def]
            host = ""
            port = None
            try:
                if isinstance(address, tuple) and len(address) >= 1:
                    host = str(address[0])
                    port = address[1] if len(address) >= 2 else None
                else:
                    host = str(address)
            except Exception:
                host = ""

            normalized = host.lower().strip()
            allowed = normalized in allowed_hosts
            # also allow raw loopback
            if normalized in ("127.0.0.1", "::1", "localhost"):
                allowed = True

            if not allowed:
                raise PermissionError(f"Network access blocked by sandbox: host={host} port={port}")
            return real_connect(address)

        s.connect = connect  # type: ignore[assignment]

        if real_connect_ex:
            def connect_ex(address):  # type: ignore[no-untyped-def]
                # Reuse the same rules as connect()
                host = ""
                port = None
                if isinstance(address, tuple) and len(address) >= 1:
                    host = str(address[0])
                    port = address[1] if len(address) >= 2 else None
                else:
                    host = str(address)
                if not _is_allowed_host(host):
                    raise PermissionError(f"Network access blocked by sandbox: host={host} port={port}")
                return real_connect_ex(address)

            s.connect_ex = connect_ex  # type: ignore[assignment]
        return s

    socket.socket = blocked_socket  # type: ignore[assignment]


def _load_callable(script_path: str, func_name: str) -> Any:
    spec = spec_from_file_location("skill_runtime_module", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load script: {script_path}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    fn = getattr(module, func_name, None)
    if fn is None or not callable(fn):
        raise RuntimeError(f"Callable '{func_name}' not found in {script_path}")
    return fn


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-path", required=True)
    parser.add_argument("--func-name", required=True)
    parser.add_argument("--allowed-hosts", default="127.0.0.1,localhost")
    args = parser.parse_args()

    cfg = RunnerConfig(
        script_path=args.script_path,
        func_name=args.func_name,
        allowed_hosts={x.strip().lower() for x in args.allowed_hosts.split(",") if x.strip()},
    )
    _patch_network(cfg.allowed_hosts)

    raw = sys.stdin.read()
    payload = {}
    if raw:
        payload = json.loads(raw)

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    result: Any = None
    err_text = ""
    try:
        fn = _load_callable(cfg.script_path, cfg.func_name)
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            result = fn(payload)
    except Exception:
        err_text = traceback.format_exc()

    logs = ""
    try:
        logs = stdout_buf.getvalue() + ("\n" if stdout_buf.getvalue() and stderr_buf.getvalue() else "") + stderr_buf.getvalue()
    except Exception:
        logs = ""

    # Always emit a single JSON object to stdout for the parent to parse.
    out = {
        "status": "success" if not err_text else "failed",
        "result": result,
        "logs": logs,
        "error_text": err_text,
    }
    # Ensure `result` can be serialized.
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()

