"""人声流行 MP3 重演绎：从人声轨提取主旋律，仅输出器乐重编（不混回原唱）。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from mido import Message, MidiFile, MidiTrack

from .remix_presets import band_parts_to_track_mappings, build_band_parts, get_style_spec

logger = logging.getLogger(__name__)

_VOCAL_LABELS = frozenset({"song", "likely_song", "vocal", "vocals"})


def is_vocal_pop_analysis(analysis: dict[str, Any] | None) -> bool:
    """是否按「人声流行单曲」处理：须有人声证据（歌词或明确人声标签），纯 BGM 不算。"""
    a = analysis or {}
    if str(a.get("analysis_mode") or "").lower() != "audio":
        return False
    if str(a.get("vocal_label") or "").lower() == "instrumental":
        return False
    if str(a.get("lyrics_text") or "").strip():
        return True
    label = str(a.get("vocal_label") or "").lower()
    if label in _VOCAL_LABELS and a.get("has_vocal") is True:
        return True
    if a.get("has_vocal") is True and label == "song":
        return False
    return False


def vocal_pop_band_parts(style_id: str) -> list[dict[str, Any]]:
    """流行人声：完整乐队编制（旋律/贝斯/和声/铺底/鼓）。"""
    return build_band_parts(style_id)


def apply_vocal_pop_plan(
    plan: dict[str, Any],
    *,
    analysis: dict[str, Any] | None,
    settings: Any,
) -> dict[str, Any]:
    """为人声流行覆盖 remix_plan 默认值。"""
    if not getattr(settings, "remix_vocal_pop_enabled", True):
        return plan
    if not is_vocal_pop_analysis(analysis):
        return plan

    out = dict(plan)
    style_id = str(out.get("remix_style") or out.get("style_hint") or "mandopop").lower()
    out["melody_source"] = "vocals"
    out["arrangement_mode"] = str(
        getattr(settings, "remix_vocal_pop_arrangement_mode", "vocal_band")
        or "vocal_band"
    )
    out["melody_priority"] = max(
        float(out.get("melody_priority") or 0.88),
        float(getattr(settings, "remix_vocal_pop_melody_priority", 0.96)),
    )
    out["keep_vocal"] = bool(
        out.get("keep_vocal")
        if out.get("keep_vocal") is not None
        else getattr(settings, "remix_vocal_pop_keep_vocal", False)
    )
    out["vocal_gain_db"] = float(out.get("vocal_gain_db") or 0.0)
    out["instrumental_gain_db"] = float(
        out.get("instrumental_gain_db")
        if out.get("instrumental_gain_db") is not None
        else getattr(settings, "remix_vocal_pop_instrumental_gain_db", -6.0)
    )
    out["band_parts"] = vocal_pop_band_parts(style_id)
    out["track_mappings"] = band_parts_to_track_mappings(out["band_parts"])
    note = str(out.get("notes") or "").strip()
    suffix = "人声流行乐队编配：人声轨转旋律 + 伴奏分轨补充低音/和声，纯器乐成品。"
    out["notes"] = f"{note} {suffix}".strip() if note else suffix
    return out


def merge_vocal_melody_with_acc_bass(
    vocal_mid: Path,
    acc_mid: Path,
    dest: Path,
    *,
    melody_ch: int = 0,
    bass_ch: int = 1,
    bass_max_below_melody: int = 12,
) -> dict[str, int]:
    """主旋律取自人声转写 MIDI，低音取自伴奏转写（每拍最低音）。"""
    v_mid = MidiFile(vocal_mid)
    a_mid = MidiFile(acc_mid)
    tpb = int(v_mid.ticks_per_beat or a_mid.ticks_per_beat or 480)

    def _notes(mid: MidiFile) -> list[tuple[int, int, int, int]]:
        raw: list[tuple[int, int, int, int]] = []
        for track in mid.tracks:
            t = 0
            open_n: dict[tuple[int, int], int] = {}
            for msg in track:
                t += int(msg.time)
                ch = int(getattr(msg, "channel", 0))
                if ch == 9:
                    continue
                if msg.type == "note_on" and getattr(msg, "velocity", 0) > 0:
                    open_n[(ch, int(msg.note))] = t
                elif msg.type in ("note_off", "note_on") and (
                    msg.type == "note_off" or int(getattr(msg, "velocity", 0)) == 0
                ):
                    key = (ch, int(msg.note))
                    st = open_n.pop(key, None)
                    if st is not None:
                        vel = int(getattr(msg, "velocity", 72) or 72)
                        raw.append((st, max(st + 1, t), int(msg.note), vel))
        return raw

    v_raw = _notes(v_mid)
    a_raw = _notes(a_mid)
    if not v_raw:
        import shutil

        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(acc_mid, dest)
        return {"melody_notes": 0, "bass_notes": 0, "fallback": 1}

    grid = max(1, tpb // 4)

    def snap(t: int) -> int:
        return max(0, round(t / grid) * grid)

    events: list[tuple[int, int, int, int, int]] = []
    seen_melody: set[tuple[int, int]] = set()

    for st, en, pitch, vel in v_raw:
        st_q = snap(st)
        en_q = max(st_q + grid, snap(en))
        key = (st_q, int(pitch))
        if key in seen_melody:
            continue
        seen_melody.add(key)
        events.append((melody_ch, int(pitch), st_q, en_q, min(120, int(vel or 88) + 8)))

    a_slots: dict[int, list[int]] = {}
    for st, _en, pitch, _vel in a_raw:
        slot = snap(st)
        a_slots.setdefault(slot, []).append(int(pitch))

    for slot, pitches in a_slots.items():
        if not pitches:
            continue
        end = slot + grid * 2
        highs = sorted(set(pitches), reverse=True)
        melody_ref = highs[0]
        lows = [p for p in highs if p <= melody_ref - bass_max_below_melody]
        if lows:
            events.append((bass_ch, min(lows), slot, end, 72))
        mids = [p for p in highs if melody_ref - 14 <= p < melody_ref - 2]
        if mids and slot % (grid * 4) == 0:
            events.append((2, mids[0], slot, end, 54))

    out = MidiFile(ticks_per_beat=tpb)
    from mido import MetaMessage, bpm2tempo

    tempo_tr = MidiTrack()
    tempo_tr.append(MetaMessage("set_tempo", tempo=int(bpm2tempo(120)), time=0))
    perf = MidiTrack()
    perf.append(MetaMessage("track_name", name="vocal_pop", time=0))
    evs: list[tuple[int, Message]] = []
    for ch, pitch, st, en, vel in events:
        evs.append((st, Message("note_on", note=pitch, velocity=vel, channel=ch, time=0)))
        evs.append((en, Message("note_off", note=pitch, velocity=0, channel=ch, time=0)))
    evs.sort(key=lambda x: (x[0], 0 if x[1].type == "note_on" else 1))
    last = 0
    for abs_t, msg in evs:
        msg.time = max(0, abs_t - last)
        last = abs_t
        perf.append(msg)
    out.tracks = [tempo_tr, perf]
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    return {
        "melody_notes": sum(1 for e in events if e[0] == melody_ch),
        "bass_notes": sum(1 for e in events if e[0] == bass_ch),
    }
