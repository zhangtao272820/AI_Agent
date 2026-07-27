from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import os
import sys
import subprocess
import traceback
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from .config import get_settings
from .db_models import SkillArtifactRecord, SkillRunRecord


def _runtime_root() -> Path:
    settings = get_settings()
    root = Path(settings.runtime_root) / "skills_runtime"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in value)


def _extract_if_needed(artifact: SkillArtifactRecord, target_dir: Path) -> Path:
    zip_path = Path(artifact.storage_path)
    # Workspace import stores manifest path directly. Use its directory as runtime root.
    if zip_path.suffix.lower() in (".yaml", ".yml"):
        if not zip_path.exists():
            raise FileNotFoundError(f"Skill manifest not found: {zip_path}")
        return zip_path.parent

    target_dir.mkdir(parents=True, exist_ok=True)
    marker = target_dir / ".extracted.ok"
    if marker.exists():
        return target_dir
    if not zip_path.exists():
        raise FileNotFoundError(f"Skill artifact not found: {zip_path}")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(target_dir)
    marker.write_text(datetime.utcnow().isoformat(), encoding="utf-8")
    return target_dir


def _load_manifest(artifact: SkillArtifactRecord) -> dict[str, Any]:
    if artifact.manifest_text.strip():
        manifest = yaml.safe_load(artifact.manifest_text) or {}
    else:
        manifest = {}
    if not isinstance(manifest, dict):
        raise ValueError("skill manifest must be a mapping")
    return manifest


def _parse_entrypoint(manifest: dict[str, Any], fallback_entrypoint: str) -> tuple[str, str]:
    entry = ""
    exec_cfg = manifest.get("execution")
    if isinstance(exec_cfg, dict):
        maybe = exec_cfg.get("entrypoint")
        if isinstance(maybe, str):
            entry = maybe.strip()
    if not entry and fallback_entrypoint:
        entry = fallback_entrypoint.strip()
    if ":" not in entry:
        raise ValueError("entrypoint must be '<relative_path.py>:<callable_name>'")
    script_rel, func_name = entry.split(":", 1)
    script_rel = script_rel.strip()
    func_name = func_name.strip()
    if not script_rel or not func_name:
        raise ValueError("invalid entrypoint")
    return script_rel, func_name


def _invoke_python(script_path: Path, func_name: str, payload: dict[str, Any]) -> tuple[Any, str]:
    module_name = f"skill_runtime_{_safe_name(script_path.stem)}_{int(datetime.utcnow().timestamp() * 1000)}"
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load script: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    fn = getattr(module, func_name, None)
    if fn is None or not callable(fn):
        raise RuntimeError(f"callable '{func_name}' not found in {script_path}")

    buffer = io.StringIO()
    with redirect_stdout(buffer), redirect_stderr(buffer):
        result = fn(payload)
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)
    return result, buffer.getvalue()


def _invoke_python_sandboxed(script_path: Path, func_name: str, payload: dict[str, Any]) -> tuple[Any, str]:
    """
    Execute skill in a separate process with best-effort sandboxing.
    """
    settings = get_settings()
    runner = Path(__file__).resolve().parent / "sandbox_runner.py"
    if not runner.exists():
        raise FileNotFoundError(f"sandbox runner not found: {runner}")

    cmd = [
        sys.executable,
        str(runner),
        "--script-path",
        str(script_path),
        "--func-name",
        func_name,
        "--allowed-hosts",
        settings.skill_sandbox_allowed_hosts,
    ]

    try:
        proc = subprocess.run(
            cmd,
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=settings.skill_sandbox_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        # Best-effort: include whatever output exists so the UI can display it.
        partial_stdout = (exc.stdout or b"").decode("utf-8", errors="replace") if isinstance(exc.stdout, (bytes, bytearray)) else (exc.stdout or "")
        partial_stderr = (exc.stderr or b"").decode("utf-8", errors="replace") if isinstance(exc.stderr, (bytes, bytearray)) else (exc.stderr or "")
        raise RuntimeError(
            f"Skill sandbox timeout after {settings.skill_sandbox_timeout_seconds}s\nstderr:\n{partial_stderr[:8000]}\nstdout:\n{partial_stdout[:8000]}"
        ) from exc

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()
    if proc.returncode != 0:
        # runner process itself crashed
        raise RuntimeError(f"sandbox runner failed: rc={proc.returncode}; stderr={stderr[:4000]}")

    try:
        out = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        raise RuntimeError(f"sandbox runner returned non-json output: {stdout[:4000]}")

    logs = out.get("logs") or ""
    if out.get("status") != "success":
        err = out.get("error_text") or "SkillExecutionError"
        e = RuntimeError(err)
        setattr(e, "_sandbox_logs", logs)
        raise e
    return out.get("result"), logs


def execute_skill_run(
    *,
    run: SkillRunRecord,
    artifact: SkillArtifactRecord,
    fallback_entrypoint: str,
    input_payload: dict[str, Any],
) -> tuple[str, str, str, str, str, int, int, float, int, int, float]:
    started = datetime.utcnow()
    cpu_started = os.times()
    logs = ""
    output_json = ""
    error_text = ""
    status = "failed"
    error_code = ""
    cost_tokens = 0
    external_api_cost = 0.0
    resource_cpu_ms = 0
    resource_mem_mb_ms = 0
    total_cost = 0.0
    try:
        manifest = _load_manifest(artifact)
        runtime = str(manifest.get("runtime", "python")).strip().lower()
        if not runtime.startswith("python"):
            raise RuntimeError(f"unsupported runtime: {runtime}")
        script_rel, func_name = _parse_entrypoint(manifest, fallback_entrypoint)
        unpack_dir = _runtime_root() / f"{_safe_name(run.skill_id)}_{_safe_name(run.version)}"
        # `_extract_if_needed` may return a different directory (e.g. when artifact is a manifest file path).
        unpack_dir = _extract_if_needed(artifact, unpack_dir)
        script_path = (unpack_dir / script_rel).resolve()
        if not script_path.exists():
            raise FileNotFoundError(
                f"entry script not found: {script_rel}; resolved={script_path}; unpack_dir={unpack_dir}; "
                f"artifact.storage_path={artifact.storage_path}"
            )

        # Ensure skill package local imports work.
        package_root = str(unpack_dir)
        if package_root not in sys.path:
            sys.path.insert(0, package_root)
        # Use sandboxed execution (subprocess + network restriction).
        result, captured = _invoke_python_sandboxed(script_path, func_name, input_payload)
        logs = captured or ""
        output_json = json.dumps(result if result is not None else {}, ensure_ascii=False)
        status = "success"
    except Exception as exc:
        error_text = traceback.format_exc()
        error_code = exc.__class__.__name__
        # If sandbox runner provided logs, attach them for observability.
        sandbox_logs = getattr(exc, "_sandbox_logs", "")
        logs = sandbox_logs or logs
    finished = datetime.utcnow()
    cpu_finished = os.times()
    duration_ms = int((finished - started).total_seconds() * 1000)
    cpu_delta = (
        (cpu_finished.user + cpu_finished.system) - (cpu_started.user + cpu_started.system)
    )
    resource_cpu_ms = max(0, int(cpu_delta * 1000))
    # Placeholder resource memory metric for MVP; replace with real sampler later.
    resource_mem_mb_ms = 0
    # Unified cost model (MVP weights, can be moved to config later).
    total_cost = float(cost_tokens) + float(external_api_cost) + (resource_cpu_ms / 1000.0) * 0.01
    return (
        status,
        output_json,
        error_text,
        logs,
        error_code,
        duration_ms if duration_ms >= 0 else 0,
        cost_tokens,
        external_api_cost,
        resource_cpu_ms,
        resource_mem_mb_ms,
        total_cost,
    )
