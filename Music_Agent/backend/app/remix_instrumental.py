"""纯音乐 MP3 重演绎：分轨保留鼓/贝斯，多轨转写乐队重编。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .instrument_swap import infer_swap_lead_instrument
from .remix_presets import band_parts_to_track_mappings, build_band_parts, infer_style_hint
from .remix_vocal_pop import is_vocal_pop_analysis

logger = logging.getLogger(__name__)

_INSTRUMENTAL_LABELS = frozenset({"instrumental", "演奏向", "纯音乐", "bgm", "inst"})


def is_instrumental_audio(analysis: dict[str, Any] | None) -> bool:
    """音频且无人声线索 → 按纯器乐重演绎。"""
    a = analysis or {}
    if str(a.get("analysis_mode") or "").lower() != "audio":
        return False
    if is_vocal_pop_analysis(a):
        return False
    if str(a.get("vocal_label") or "").lower() in _INSTRUMENTAL_LABELS:
        return True
    if a.get("has_vocal") is False and not str(a.get("lyrics_text") or "").strip():
        return True
    fn = str(a.get("filename") or "").lower()
    if any(k in fn for k in ("纯音乐", "伴奏", "inst", "instrumental", "piano", "钢琴", "bgm")):
        if not str(a.get("lyrics_text") or "").strip():
            return True
    return False


def is_instrumental_hybrid_plan(plan: dict[str, Any] | None) -> bool:
    mode = str((plan or {}).get("remix_mode") or "").lower()
    return mode in ("instrumental_hybrid", "instrumental_band", "instrumental_anchor")


def is_instrumental_anchor_plan(plan: dict[str, Any] | None) -> bool:
    mode = str((plan or {}).get("remix_mode") or "").lower()
    if mode == "instrumental_anchor":
        return True
    return bool((plan or {}).get("anchor_stem_mix"))


def _resolve_instrumental_strategy(settings: Any, plan: dict[str, Any]) -> str:
    """anchor=保留原曲分轨旋律；band=MIDI乐队；midi=单旋律MIDI换音色。"""
    explicit = str(plan.get("remix_strategy") or plan.get("instrumental_strategy") or "").strip().lower()
    if explicit in ("anchor", "band", "midi"):
        return explicit
    cfg = str(getattr(settings, "remix_instrumental_strategy", "anchor") or "anchor").strip().lower()
    return cfg if cfg in ("anchor", "band", "midi") else "anchor"


def is_bgm_instrumental(analysis: dict[str, Any] | None, plan: dict[str, Any] | None = None) -> bool:
    return is_instrumental_audio(analysis)


def _band_parts_with_swap(
    style_id: str,
    lead_inst: str,
    source_inst: str,
) -> list[dict[str, Any]]:
    parts = build_band_parts(style_id)
    out: list[dict[str, Any]] = []
    for p in parts:
        row = dict(p)
        role = str(row.get("role") or "")
        inst = str(row.get("instrument") or "")
        if role == "melody":
            row["instrument"] = lead_inst
        elif role == "bass" and inst == lead_inst:
            row["instrument"] = "bass"
        elif role in ("harmony", "pad") and inst == source_inst:
            row["instrument"] = "strings" if role == "harmony" else "harp"
        out.append(row)
    return out


def apply_instrumental_remix_plan(
    plan: dict[str, Any],
    *,
    analysis: dict[str, Any] | None,
    settings: Any,
) -> dict[str, Any]:
    """纯音乐 MP3：4 轨分离 + other/bass 多轨转写 + 乐队换音色 + 鼓轨混回。"""
    if not getattr(settings, "remix_instrumental_enabled", True):
        return plan
    if not is_instrumental_audio(analysis):
        return plan

    out = dict(plan)
    fn = str((analysis or {}).get("filename") or "")
    style_id = str(
        out.get("remix_style") or out.get("style_hint") or infer_style_hint(analysis, fn) or "bgm"
    ).lower()
    if style_id not in ("classical", "folk", "jazz", "electronic", "jpop", "mandopop"):
        style_id = "bgm"
    lead_inst, source_inst = infer_swap_lead_instrument(analysis, out, fn)
    strategy = _resolve_instrumental_strategy(settings, out)
    out["remix_strategy"] = strategy
    out["remix_style"] = style_id
    out["style_hint"] = style_id
    out["source_instrument"] = source_inst
    out["lead_instrument"] = lead_inst

    if strategy == "anchor":
        out["remix_mode"] = "instrumental_anchor"
        out["arrangement_mode"] = "anchor"
        out["anchor_stem_mix"] = True
        out["skip_midi_render"] = True
        out["separate_mode"] = str(
            out.get("separate_mode")
            or getattr(settings, "remix_instrumental_separate_mode", "4stems")
            or "4stems"
        )
        out["hybrid_mix"] = True
        out["hybrid_drums_only"] = False
        out["bed_stem_mix"] = False
        out["bgm_profile"] = True
        out["keep_vocal"] = False
        out["anchor_gain_db"] = float(
            out.get("anchor_gain_db")
            if out.get("anchor_gain_db") is not None
            else getattr(settings, "remix_instrumental_anchor_gain_db", 0.0)
        )
        out["drums_gain_db"] = float(
            out.get("drums_gain_db")
            if out.get("drums_gain_db") is not None
            else getattr(settings, "remix_instrumental_drums_gain_db", -3.0)
        )
        out["bass_gain_db"] = float(
            out.get("bass_gain_db")
            if out.get("bass_gain_db") is not None
            else getattr(settings, "remix_instrumental_bass_gain_db", -6.0)
        )
        out["band_parts"] = _band_parts_with_swap(style_id, lead_inst, source_inst)
        out["track_mappings"] = band_parts_to_track_mappings(out["band_parts"])
        out["harmony_style"] = "classical"
        note = str(out.get("notes") or "").strip()
        suffix = (
            f"音频锚定重演绎：保留原曲 other 分轨主旋律（不经 MIDI 再合成），"
            f"DSP 重塑为 {lead_inst} 气质；叠原曲鼓/贝斯。"
            f"原主奏≈{source_inst}。"
        )
        out["notes"] = f"{note} {suffix}".strip() if note else suffix
        return out

    out["remix_mode"] = "instrumental_band"
    out["arrangement_mode"] = "instrumental_band"
    out["separate_mode"] = str(
        out.get("separate_mode")
        or getattr(settings, "remix_instrumental_separate_mode", "4stems")
        or "4stems"
    )
    out["hybrid_mix"] = True
    out["hybrid_drums_only"] = True
    out["bed_stem_mix"] = False
    out["bgm_profile"] = True
    out["keep_vocal"] = False
    out["melody_priority"] = max(
        float(out.get("melody_priority") or 0.88),
        float(getattr(settings, "remix_instrumental_melody_priority", 0.96)),
    )
    out["band_parts"] = _band_parts_with_swap(style_id, lead_inst, source_inst)
    out["track_mappings"] = band_parts_to_track_mappings(out["band_parts"])
    out["harmony_style"] = "classical"
    out["conduct_band"] = True
    out["drums_gain_db"] = float(
        out.get("drums_gain_db")
        if out.get("drums_gain_db") is not None
        else getattr(settings, "remix_instrumental_drums_gain_db", -2.5)
    )
    out["bass_gain_db"] = float(
        out.get("bass_gain_db")
        if out.get("bass_gain_db") is not None
        else getattr(settings, "remix_instrumental_bass_gain_db", -99.0)
    )
    out["lead_gain_db"] = float(
        out.get("lead_gain_db")
        if out.get("lead_gain_db") is not None
        else getattr(settings, "remix_instrumental_lead_gain_db", 2.0)
    )
    note = str(out.get("notes") or "").strip()
    suffix = (
        f"纯音乐管弦重演绎：other+bass 分轨转写后经指挥式整理；"
        f"编制 {lead_inst}/cello/strings/harp + 原曲鼓；"
        f"原主奏≈{source_inst}。"
    )
    out["notes"] = f"{note} {suffix}".strip() if note else suffix
    return out


def resolve_pitch_source_stem(
    stems: dict[str, Path],
    plan: dict[str, Any],
    *,
    analysis: dict[str, Any] | None,
) -> Path | None:
    if is_instrumental_audio(analysis) or is_instrumental_hybrid_plan(plan):
        other = stems.get("other")
        if other and other.is_file():
            return other
        acc = stems.get("accompaniment")
        if acc and acc.is_file():
            return acc
    acc = stems.get("accompaniment")
    if acc and acc.is_file():
        return acc
    return stems.get("other")


def resolve_bed_stem(
    stems: dict[str, Path],
    plan: dict[str, Any],
    *,
    analysis: dict[str, Any] | None,
) -> Path | None:
    if not bool(plan.get("bed_stem_mix")):
        return None
    return None
