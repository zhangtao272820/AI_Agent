"""轻量重演绎：保留主旋律，仅内部推断音色与稀疏织体（不开放曲风手选）。"""
from __future__ import annotations

from typing import Any

from .remix_instrumental import is_instrumental_audio
from .remix_vocal_pop import is_vocal_pop_analysis


def apply_timbral_remix_defaults(
    plan: dict[str, Any],
    *,
    analysis: dict[str, Any] | None,
    settings: Any | None = None,
) -> dict[str, Any]:
    """
    统一重演绎策略：
    - 上传 MIDI：不改音符，仅 remap 换音色
    - 人声流行音频：保留 vocal_band 稀疏伴奏
    - 其它音频：light 网格对齐 + 高 melody_priority，禁止 band 全编配
    """
    out = dict(plan)
    out["remix_mode"] = "timbral"
    a = analysis or {}
    is_midi = str(a.get("analysis_mode") or "").lower() == "midi"
    vocal_pop = is_vocal_pop_analysis(a)

    if is_midi:
        out["arrangement_mode"] = "off"
        out["remix_mode"] = "midi_swap"
        out["melody_priority"] = max(float(out.get("melody_priority") or 0), 0.88)
        return out

    if is_instrumental_audio(a):
        if str(out.get("remix_mode") or "").lower() in ("instrumental_band", "instrumental_anchor"):
            return out
        out["arrangement_mode"] = "off"
        out["remix_mode"] = "instrumental_hybrid"
        out["separate_mode"] = "4stems"
        floor = float(getattr(settings, "remix_instrumental_melody_priority", 0.96))
        out["melody_priority"] = max(float(out.get("melody_priority") or 0), floor)
        return out

    if vocal_pop:
        out["arrangement_mode"] = str(
            out.get("arrangement_mode")
            or getattr(settings, "remix_vocal_pop_arrangement_mode", "vocal_band")
            or "vocal_band"
        ).lower()
        floor = float(getattr(settings, "remix_vocal_pop_melody_priority", 0.96))
        out["melody_priority"] = max(float(out.get("melody_priority") or 0), floor)
        return out

    mode = str(out.get("arrangement_mode") or "").strip().lower()
    if mode in ("band", "conducted", "off", "none", ""):
        default_light = str(getattr(settings, "remix_orchestrate_mode", "light") or "light")
        if default_light in ("band", "conducted"):
            default_light = "light"
        out["arrangement_mode"] = default_light
    floor_pri = float(getattr(settings, "remix_orchestrate_melody_priority", 0.95))
    out["melody_priority"] = max(float(out.get("melody_priority") or 0), max(0.95, floor_pri))
    return out
