from __future__ import annotations

import re
from typing import Any

_URL_RE = re.compile(r"https?://[^\s)\]>\"']+", re.I)
_ARTIFACT_KEYS = (
    "midi_url",
    "instrumental_wav_url",
    "instrumental_mp3_url",
    "remix_wav_url",
    "wav_url",
    "mp3_url",
    "files_url",
    "file_url",
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
    sid = str(payload.get("session_id") or "").strip()
    if sid and sid not in seen:
        sources.append({"type": "doc", "ref": f"session:{sid}"})
    return sources


def format_media_answer(label: str, payload: dict[str, Any] | None) -> str:
    if not payload:
        return f"【{label}】"
    lines = [f"【{label}】"]
    for key in _ARTIFACT_KEYS:
        val = str(payload.get(key) or "").strip()
        if val:
            lines.append(f"{key}：{val}")
    prompt = str(payload.get("effective_prompt") or payload.get("user_prompt") or "").strip()
    if prompt:
        lines.append(f"需求：{prompt}")
    err = str(payload.get("error") or "").strip()
    if err:
        lines.append(f"错误：{err}")
    return "\n".join(lines) if len(lines) > 1 else lines[0]


def build_media_agent_result(
    agent: str,
    answer: str,
    payload: dict[str, Any] | None = None,
    *,
    trace_id: str | None = None,
    latency_ms: int | None = None,
) -> dict[str, Any]:
    text = str(answer or "").strip()
    sources = _artifact_sources(payload)
    sources.extend(_urls_from_text(text))
    dedup: list[dict[str, str]] = []
    seen: set[str] = set()
    for s in sources:
        ref = str(s.get("ref") or "")
        if ref in seen:
            continue
        seen.add(ref)
        dedup.append(s)
    ok = bool(text) and not re.search(r"^错误：", text, re.M) and not str((payload or {}).get("error") or "").strip()
    return {
        "ok": ok,
        "agent": agent,
        "trace_id": trace_id or None,
        "answer": text or None,
        "sources": dedup or None,
        "structured": {"artifact": dict(payload or {}), "mode": str((payload or {}).get("mode") or "compose")},
        "error_code": None if ok else "generation_failed",
        "latency_ms": latency_ms,
    }


def finalize_music_ws_done(
    result: dict[str, Any],
    *,
    trace_id: str | None,
    started_at: float | None,
    mode: str | None = None,
) -> dict[str, Any]:
    import time

    body = dict(result)
    if mode:
        body["mode"] = mode
    answer = format_media_answer("音乐生成", body)
    latency = int((time.time() - started_at) * 1000) if started_at else None
    body["agentResult"] = build_media_agent_result("music", answer, body, trace_id=trace_id, latency_ms=latency)
    return body
