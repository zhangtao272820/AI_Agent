"""MIDI 结构分析：多轨角色识别，供「只换乐器、不改音符」重演绎。"""
from __future__ import annotations

import logging
import statistics
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from mido import MidiFile

logger = logging.getLogger(__name__)

# GM program → 大致家族（用于角色推断）
_GM_FAMILY: dict[int, str] = {}
for _prog in list(range(0, 8)) + list(range(16, 24)):
    _GM_FAMILY[_prog] = "keyboard"
for _prog in range(24, 32):
    _GM_FAMILY[_prog] = "guitar"
for _prog in range(32, 40):
    _GM_FAMILY[_prog] = "bass"
for _prog in range(40, 48):
    _GM_FAMILY[_prog] = "strings"
for _prog in range(48, 56):
    _GM_FAMILY[_prog] = "ensemble"
for _prog in range(56, 64):
    _GM_FAMILY[_prog] = "brass"
for _prog in range(64, 72):
    _GM_FAMILY[_prog] = "reed"
for _prog in range(72, 80):
    _GM_FAMILY[_prog] = "pipe"
for _prog in range(80, 88):
    _GM_FAMILY[_prog] = "synth_lead"
for _prog in range(88, 96):
    _GM_FAMILY[_prog] = "synth_pad"
for _prog in range(96, 104):
    _GM_FAMILY[_prog] = "fx"
for _prog in range(104, 112):
    _GM_FAMILY[_prog] = "ethnic"
for _prog in range(112, 120):
    _GM_FAMILY[_prog] = "perc_melodic"


@dataclass
class MidiTrackInfo:
    track_index: int
    name: str = ""
    channels: list[int] = field(default_factory=list)
    primary_channel: int = 0
    programs: dict[int, int] = field(default_factory=dict)
    primary_program: int | None = None
    note_count: int = 0
    pitch_min: int = 127
    pitch_max: int = 0
    pitch_mean: float = 60.0
    role_hint: str = "unknown"  # melody | bass | drums | harmony | pad | unknown
    instrument_family: str = "unknown"

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["programs"] = {str(k): v for k, v in self.programs.items()}
        return d


def _track_name(track) -> str:
    for msg in track:
        if getattr(msg, "type", None) == "track_name":
            return str(getattr(msg, "name", "") or "").strip()
    return ""


def _scan_track(track_index: int, track) -> MidiTrackInfo | None:
    info = MidiTrackInfo(track_index=track_index, name=_track_name(track))
    ch_notes: dict[int, list[int]] = {}
    ch_prog: dict[int, int] = {}
    ch_vel: dict[int, list[int]] = {}
    pitches: list[int] = []

    for msg in track:
        ch = int(getattr(msg, "channel", 0))
        if msg.type == "program_change":
            ch_prog[ch] = int(msg.program)
        elif msg.type == "note_on" and int(getattr(msg, "velocity", 0)) > 0:
            pitch = int(msg.note)
            vel = int(getattr(msg, "velocity", 72))
            info.note_count += 1
            pitches.append(pitch)
            ch_notes.setdefault(ch, []).append(pitch)
            ch_vel.setdefault(ch, []).append(vel)

    if info.note_count == 0:
        return None

    info.channels = sorted(ch_notes.keys())
    info.primary_channel = max(info.channels, key=lambda c: len(ch_notes.get(c, [])))
    info.programs = dict(ch_prog)
    if info.primary_channel in ch_prog:
        info.primary_program = ch_prog[info.primary_channel]
    elif ch_prog:
        info.primary_program = ch_prog[max(ch_prog, key=lambda c: len(ch_notes.get(c, [])))]

    info.pitch_min = min(pitches)
    info.pitch_max = max(pitches)
    info.pitch_mean = float(statistics.mean(pitches))

    if info.primary_channel == 9 or all(c == 9 for c in info.channels):
        info.role_hint = "drums"
        info.instrument_family = "drums"
    elif info.primary_program is not None:
        info.instrument_family = _GM_FAMILY.get(info.primary_program, "unknown")

    return info


def _infer_roles(tracks: list[MidiTrackInfo]) -> None:
    """为各轨推断 melody/bass/harmony/pad（鼓轨已标记）。"""
    melodic = [t for t in tracks if t.role_hint != "drums"]
    if not melodic:
        return

    by_mean = sorted(melodic, key=lambda t: t.pitch_mean, reverse=True)
    by_count = sorted(melodic, key=lambda t: t.note_count, reverse=True)

    # 名称关键词优先
    _ROLE_KW = {
        "melody": ("melody", "lead", "solo", "主旋律", "主题"),
        "bass": ("bass", "贝斯", "低音"),
        "drums": ("drum", "perc", "鼓"),
        "pad": ("pad", "铺底", "ambient"),
        "harmony": ("harm", "chord", "comp", "acc", "和声", "伴奏"),
    }
    assigned: set[int] = set()
    for t in melodic:
        low_name = t.name.lower()
        for role, kws in _ROLE_KW.items():
            if any(k in low_name for k in kws):
                t.role_hint = role
                assigned.add(t.track_index)
                break

    # 贝斯：最低音域 + 音高中位偏低
    bass_cands = [t for t in melodic if t.track_index not in assigned]
    if bass_cands:
        bass = min(bass_cands, key=lambda t: (t.pitch_mean, -t.note_count))
        if bass.pitch_mean < 58 or bass.instrument_family == "bass":
            bass.role_hint = "bass"
            assigned.add(bass.track_index)

    # 主旋律：最高音域或音符最多且偏高
    mel_cands = [t for t in melodic if t.track_index not in assigned]
    if mel_cands:
        melody = max(mel_cands, key=lambda t: (t.pitch_mean, t.note_count))
        melody.role_hint = "melody"
        assigned.add(melody.track_index)

    # 其余：和声 / 铺底
    for t in melodic:
        if t.track_index in assigned:
            continue
        if t.instrument_family in ("synth_pad", "ensemble", "strings") or t.pitch_mean < 62:
            t.role_hint = "pad" if t.instrument_family == "synth_pad" else "harmony"
        elif t.note_count < by_count[0].note_count * 0.35:
            t.role_hint = "pad"
        else:
            t.role_hint = "harmony"
        assigned.add(t.track_index)


def analyze_midi_structure(path: Path) -> dict[str, Any]:
    """解析 MIDI 多轨结构，返回可写入 analysis 的摘要。"""
    mid = MidiFile(path)
    tracks: list[MidiTrackInfo] = []
    for ti, track in enumerate(mid.tracks):
        info = _scan_track(ti, track)
        if info:
            tracks.append(info)
    _infer_roles(tracks)

    programs_used = sorted(
        {p for t in tracks for p in (t.programs.values() if t.programs else ([t.primary_program] if t.primary_program is not None else []))}
    )
    channels_used = sorted({c for t in tracks for c in t.channels})

    return {
        "ticks_per_beat": int(getattr(mid, "ticks_per_beat", 480) or 480),
        "duration_seconds": round(float(getattr(mid, "length", 0) or 0), 3),
        "performance_tracks": len(tracks),
        "channels_used": channels_used,
        "programs_used": programs_used,
        "midi_tracks": [t.to_dict() for t in tracks],
        "roles": {t.role_hint: t.track_index for t in tracks if t.role_hint != "unknown"},
    }


def build_track_mappings_from_roles(
    midi_tracks: list[dict[str, Any]],
    band_parts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    按推断角色 + band_parts 目标乐器，生成 track_index 级映射（保留原音符）。
    """
    role_inst: dict[str, str] = {}
    for p in band_parts:
        if not isinstance(p, dict):
            continue
        role = str(p.get("role") or "").strip().lower()
        inst = str(p.get("instrument") or p.get("to") or "").strip()
        if role and role != "drums" and inst:
            role_inst[role] = inst

    mappings: list[dict[str, Any]] = []
    for tr in midi_tracks:
        if not isinstance(tr, dict):
            continue
        role = str(tr.get("role_hint") or "unknown").lower()
        if role == "drums":
            continue
        ch = int(tr.get("primary_channel", tr.get("channels", [0])[0] if tr.get("channels") else 0))
        if ch == 9:
            continue
        ti = int(tr.get("track_index", 0))
        inst = role_inst.get(role)
        if not inst:
            continue
        mappings.append(
            {
                "track_index": ti,
                "channel": ch,
                "role": role,
                "to": inst,
                "to_instrument": inst,
                "from_program": tr.get("primary_program"),
            }
        )
    return mappings


def enrich_analysis_with_midi(analysis: dict[str, Any], path: Path) -> dict[str, Any]:
    """将 MIDI 结构分析合并进 upload analysis。"""
    out = dict(analysis)
    try:
        struct = analyze_midi_structure(path)
        out.update(
            {
                "performance_tracks": struct.get("performance_tracks"),
                "channels_used": struct.get("channels_used"),
                "programs_used": struct.get("programs_used"),
                "midi_tracks": struct.get("midi_tracks"),
                "midi_roles": struct.get("roles"),
            }
        )
    except Exception as ex:
        logger.info("midi structure analyze skipped: %s", ex)
        out["midi_analyze_warning"] = str(ex)[:200]
    return out
