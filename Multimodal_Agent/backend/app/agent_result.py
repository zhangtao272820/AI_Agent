from __future__ import annotations

import re
from typing import Any

_URL_RE = re.compile(r"https?://[^\s)\]>\"']+", re.I)


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


def _pick_answer(payload: dict[str, Any] | None) -> str:
    if not payload:
        return ""
    if isinstance(payload.get("agent_reply"), str) and str(payload["agent_reply"]).strip():
        return str(payload["agent_reply"]).strip()
    for key in ("answer", "description", "summary", "transcript", "ocr_text"):
        val = str(payload.get(key) or "").strip()
        if val:
            return val
    result = payload.get("result")
    if isinstance(result, dict):
        return _pick_answer(result)
    if isinstance(result, str) and result.strip():
        return result.strip()
    return ""


def build_multimodal_agent_result(
    payload: dict[str, Any] | None,
    *,
    trace_id: str | None = None,
    latency_ms: int | None = None,
    media_type: str | None = None,
) -> dict[str, Any]:
    row = payload if isinstance(payload, dict) else {}
    answer = _pick_answer(row)
    sources = _urls_from_text(answer)
    fp = str(row.get("file_path") or "").strip()
    if fp:
        sources.append({"type": "doc", "ref": fp})
    ok = bool(answer)
    return {
        "ok": ok,
        "agent": "multimodal",
        "trace_id": trace_id or None,
        "answer": answer or None,
        "sources": sources or None,
        "structured": {
            "media_type": media_type or str(row.get("media_type") or ""),
            "action": str(row.get("action") or "understand"),
            "raw": row,
        },
        "error_code": None if ok else "empty_result",
        "latency_ms": latency_ms,
    }
