from __future__ import annotations

import re
from typing import Any

_URL_RE = re.compile(r"https?://[^\s)\]>\"']+", re.I)
_ARTIFACT_KEYS = (
    "final_video_url",
    "video_url",
    "bgm_url",
    "audio_url",
    "final_audio_url",
)


def _urls_from_text(text: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for m in _URL_RE.findall(str(text or "")):
        ref = m.rstrip(".,;:!?)")
        if not ref or ref in seen:
            continue
        seen.add(ref)
        out.append({"type": "url", "ref": ref})
    return out


def _artifact_sources(payload: dict[str, Any] | None) -> list[dict[str, str]]:
    if not payload:
        return []
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for key in _ARTIFACT_KEYS:
        ref = str(payload.get(key) or "").strip()
        if not ref or ref in seen:
            continue
        seen.add(ref)
        sources.append({"type": "doc", "ref": f"{key}:{ref}"})
    return sources


def format_video_answer(payload: dict[str, Any] | None) -> str:
    if not payload:
        return "【视频生成】"
    lines = ["【视频生成】"]
    for key in _ARTIFACT_KEYS:
        val = str(payload.get(key) or "").strip()
        if val:
            lines.append(f"{key}：{val}")
    prompt = str(payload.get("user_prompt") or "").strip()
    if prompt:
        lines.append(f"需求：{prompt}")
    err = str(payload.get("error") or "").strip()
    if err:
        lines.append(f"错误：{err}")
    return "\n".join(lines) if len(lines) > 1 else lines[0]


def build_video_agent_result(
    payload: dict[str, Any] | None,
    *,
    trace_id: str | None = None,
    latency_ms: int | None = None,
) -> dict[str, Any]:
    answer = format_video_answer(payload)
    text = str(answer or "").strip()
    sources = _artifact_sources(payload)
    sources.extend(_urls_from_text(text))
    ok = bool(text) and not str((payload or {}).get("error") or "").strip()
    return {
        "ok": ok,
        "agent": "video",
        "trace_id": trace_id or None,
        "answer": text or None,
        "sources": sources or None,
        "structured": {"artifact": dict(payload or {})},
        "error_code": None if ok else "generation_failed",
        "latency_ms": latency_ms,
    }
