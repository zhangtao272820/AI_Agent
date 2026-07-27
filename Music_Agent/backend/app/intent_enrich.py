"""用规则从用户原文补全 LLM 意图（乐器、风格、情绪），避免每次生成雷同。"""
from __future__ import annotations

import re
import time
from typing import Any

from .compose_instruments import extract_instruments_from_text, infer_style_hints


def enrich_intent_from_user_text(user_text: str, intent: dict[str, Any]) -> dict[str, Any]:
    text = (user_text or "").strip()
    out = dict(intent)
    if not text:
        return out

    hints = infer_style_hints(text)
    extracted = extract_instruments_from_text(text)

    if extracted:
        # 用户明确提到的乐器优先，保留 LLM 补充项
        llm_inst = [str(x).lower() for x in (out.get("instruments") or [])]
        merged: list[str] = []
        for name in extracted:
            if name not in merged:
                merged.append(name)
        for x in out.get("instruments") or []:
            sx = str(x).strip()
            if sx and sx.lower() not in {m.lower() for m in merged}:
                merged.append(sx)
        out["instruments"] = merged[:8]
        out["primary_instruments"] = merged[:3]
        out["secondary_instruments"] = merged[3:6]

    if hints.get("style"):
        out["style"] = hints["style"]
    if hints.get("harmony_style"):
        out["harmony_style"] = hints["harmony_style"]
    if hints.get("emotion"):
        out["emotion"] = hints["emotion"]

    if hints.get("tempo_hint") == "slow":
        try:
            out["tempo"] = min(int(out.get("tempo") or 100), 84)
        except (TypeError, ValueError):
            out["tempo"] = 76
    elif hints.get("tempo_hint") == "fast":
        try:
            out["tempo"] = max(int(out.get("tempo") or 100), 112)
        except (TypeError, ValueError):
            out["tempo"] = 118

    if hints.get("no_drums") == "1":
        inst = list(out.get("instruments") or [])
        if not any("no_drums" in str(i).lower() for i in inst):
            inst.append("no_drums")
        out["instruments"] = inst

    # 纪录片 / 短片：曲式更适合短 BGM
    if any(k in text for k in ("纪录片", "documentary", "片头", "片尾", "bgm", "背景")):
        if str(out.get("structure") or "").upper() in ("A-B-A", "A-B-A", ""):
            out["structure"] = "intro-A-outro"

    # 中国风默认五声倾向调性
    if out.get("style") == "chinese" and str(out.get("key") or "").startswith("C"):
        if any(k in text for k in ("忧伤", "悲", "sad")):
            out["key"] = "A小调"
        elif "宁静" in text or "悠远" in text:
            out["key"] = "D大调"

    # 每次生成微扰（供前端展示；compose 侧另有随机 seed）
    out["compose_nonce"] = int(time.time_ns() % 10_000_000)

    return out


def compose_seed_for_attempt(
    *,
    key: str,
    tempo: int,
    emotion: str,
    user_text: str,
    attempt: int = 0,
    explicit_seed: int | None = None,
) -> int:
    if explicit_seed is not None:
        return int(explicit_seed) & 0x7fffffff
    import hashlib

    blob = f"{key}|{tempo}|{emotion}|{attempt}|{time.time_ns()}|{user_text[:120]}"
    h = hashlib.sha256(blob.encode()).digest()
    return int.from_bytes(h[:4], "big") & 0x7fffffff
