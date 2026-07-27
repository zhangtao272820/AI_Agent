"""按 remix_plan 修改 MIDI 的 GM program（轨/通道/角色匹配，保留音符）。"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from mido import Message, MidiFile, MidiTrack

logger = logging.getLogger(__name__)

# GM 常用乐器（与 midi_engine / remix_presets 对齐）
GM_BY_NAME: dict[str, int] = {
    "piano": 0,
    "钢琴": 0,
    "acoustic_grand": 0,
    "bright_piano": 1,
    "electric_piano": 5,
    "电钢": 5,
    "harpsichord": 6,
    "clavinet": 7,
    "celesta": 8,
    "glockenspiel": 9,
    "music_box": 10,
    "vibraphone": 11,
    "marimba": 12,
    "xylophone": 13,
    "tubular_bells": 14,
    "dulcimer": 15,
    "drawbar_organ": 16,
    "organ": 17,
    "风琴": 17,
    "guitar": 24,
    "吉他": 24,
    "acoustic_guitar": 24,
    "nylon_guitar": 24,
    "steel_guitar": 25,
    "electric_guitar": 30,
    "电吉他": 30,
    "clean_guitar": 27,
    "distortion_guitar": 30,
    "bass": 33,
    "贝斯": 33,
    "acoustic_bass": 32,
    "electric_bass": 33,
    "fretless_bass": 35,
    "slap_bass": 36,
    "violin": 40,
    "小提琴": 40,
    "viola": 41,
    "cello": 42,
    "大提琴": 42,
    "contrabass": 43,
    "tremolo_strings": 44,
    "pizzicato_strings": 45,
    "harp": 46,
    "竖琴": 46,
    "timpani": 47,
    "strings": 48,
    "string_ensemble_1": 48,
    "string_ensemble": 49,
    "弦乐": 49,
    "slow_strings": 49,
    "synth_strings": 50,
    "choir": 52,
    "voice_oohs": 53,
    "voice_aahs": 54,
    "trumpet": 56,
    "小号": 56,
    "trombone": 57,
    "tuba": 58,
    "french_horn": 60,
    "brass": 61,
    "铜管": 61,
    "synth_brass": 62,
    "soprano_sax": 64,
    "sax": 65,
    "萨克斯": 65,
    "alto_sax": 65,
    "tenor_sax": 66,
    "baritone_sax": 67,
    "oboe": 68,
    "english_horn": 69,
    "bassoon": 70,
    "clarinet": 71,
    "piccolo": 72,
    "flute": 73,
    "长笛": 73,
    "recorder": 74,
    "pan_flute": 75,
    "whistle": 78,
    "ocarina": 79,
    "lead_synth": 80,
    "synth": 89,
    "合成": 89,
    "pad": 89,
    "warm_pad": 89,
    "polysynth": 90,
    "bowed_pad": 92,
    "metallic_pad": 93,
    "halo_pad": 94,
    "sweep_pad": 95,
    "drums": 9,
    "鼓": 9,
    "percussion": 9,
    "kalimba": 108,
    "bagpipe": 109,
    "fiddle": 110,
    "shanai": 111,
}

# 角色 → 默认混音 CC（不改音符，仅优化 FluidSynth 听感）
_ROLE_MIX_CC: dict[str, dict[str, int]] = {
    "melody": {"volume": 105, "pan": 64},
    "bass": {"volume": 92, "pan": 64},
    "harmony": {"volume": 78, "pan": 58},
    "pad": {"volume": 68, "pan": 70},
}


def name_to_program(name: str) -> int | None:
    if not name:
        return None
    key = re.sub(r"\s+", "_", name.strip().lower())
    if key in GM_BY_NAME:
        return GM_BY_NAME[key]
    for k, prog in GM_BY_NAME.items():
        if k in key or key in k:
            return prog
    return None


def _track_has_notes(track: MidiTrack) -> bool:
    return any(getattr(m, "type", "") in ("note_on", "note_off") for m in track)


def _track_uses_channel(track: MidiTrack, channel: int) -> bool:
    for msg in track:
        if msg.type in ("note_on", "note_off", "program_change", "control_change"):
            if int(getattr(msg, "channel", 0)) == channel:
                return True
    return False


def _insert_at_track_start(track: MidiTrack, msg: Message) -> None:
    """在轨首 meta 之后插入 MIDI 事件。"""
    insert_at = 0
    for i, m in enumerate(track):
        if getattr(m, "type", "").startswith("note") or m.type in (
            "program_change",
            "control_change",
            "pitchwheel",
        ):
            insert_at = i
            break
        insert_at = i + 1
    msg.time = 0
    track.insert(insert_at, msg)


def _set_program_on_track(track: MidiTrack, channel: int, program: int) -> bool:
    """更新或插入 program_change；鼓轨 (ch9) 跳过。"""
    if channel == 9:
        return False
    program = max(0, min(127, program))
    updated = False
    for msg in track:
        if msg.type == "program_change" and int(getattr(msg, "channel", 0)) == channel:
            if int(msg.program) != program:
                msg.program = program  # type: ignore[attr-defined]
            updated = True
    if not updated and _track_uses_channel(track, channel):
        _insert_at_track_start(
            track,
            Message("program_change", program=program, channel=channel, time=0),
        )
        updated = True
    return updated


def _apply_role_mix(track: MidiTrack, channel: int, role: str) -> None:
    """按声部角色设置音量/声像（CC7/CC10）。"""
    mix = _ROLE_MIX_CC.get((role or "").lower())
    if not mix or channel == 9:
        return
    for cc, val in (("volume", 7), ("pan", 10)):
        v = mix.get(cc)
        if v is None:
            continue
        _insert_at_track_start(
            track,
            Message("control_change", control=int(val), value=int(v), channel=channel, time=0),
        )


def _apply_channel_program(mid: MidiFile, channel: int, program: int) -> int:
    """在所有使用 channel 的轨上设置 program。"""
    count = 0
    for track in mid.tracks:
        if _set_program_on_track(track, channel, program):
            count += 1
    return count


def _apply_track_program(mid: MidiFile, track_index: int, channel: int, program: int) -> bool:
    if track_index < 0 or track_index >= len(mid.tracks):
        return False
    return _set_program_on_track(mid.tracks[track_index], channel, program)


def apply_remix_plan(
    midi_path: Path,
    output_path: Path,
    plan: dict[str, Any],
) -> dict[str, Any]:
    """
    根据 remix_plan 改写 GM program，保留全部音符与时长。

    映射项支持：
    - track_index + channel + to/to_instrument
    - channel + to/to_instrument（所有使用该 channel 的轨）
    - match_instrument / from_program + to
    - band_parts（按 role 或 channel；MIDI 多轨时优先 track_mappings）
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mid = MidiFile(midi_path)
    mappings = plan.get("track_mappings") or plan.get("mappings") or []
    if not isinstance(mappings, list):
        mappings = []

    changes: list[str] = []
    resolved: list[dict[str, Any]] = []
    touched: set[tuple[int, int]] = set()  # (track_index| -1, channel)

    apply_role_mix = bool(plan.get("apply_role_mix", True))
    midi_mode = str(plan.get("remix_mode") or "").lower() in ("timbral", "midi_swap", "instrument_swap")

    # 1) 显式 track_mappings（MIDI 升级路径优先）
    for raw in mappings:
        if not isinstance(raw, dict):
            continue
        to_name = str(raw.get("to") or raw.get("to_instrument") or raw.get("instrument") or "").strip()
        prog_raw = raw.get("program")
        if prog_raw is None and to_name:
            prog_raw = name_to_program(to_name)
        try:
            prog = int(prog_raw) if prog_raw is not None else None
        except (TypeError, ValueError):
            prog = name_to_program(str(prog_raw or ""))
        if prog is None:
            continue
        prog = max(0, min(127, prog))

        ch_raw = raw.get("channel")
        ti_raw = raw.get("track_index")
        role = str(raw.get("role") or "").strip().lower()

        if ti_raw is not None:
            try:
                ti = int(ti_raw)
                ch = int(ch_raw) if ch_raw is not None else 0
            except (TypeError, ValueError):
                continue
            if ch == 9:
                continue
            if _apply_track_program(mid, ti, ch, prog):
                key = (ti, ch)
                if key not in touched:
                    touched.add(key)
                    if apply_role_mix and role:
                        _apply_role_mix(mid.tracks[ti], ch, role)
                    old_p = raw.get("from_program")
                    changes.append(
                        f"track{ti} ch{ch}→{to_name or prog}"
                        + (f" (was {old_p})" if old_p is not None else "")
                    )
                    resolved.append({"track_index": ti, "channel": ch, "program": prog, "instrument": to_name})
            continue

        match_name = str(raw.get("match_instrument") or raw.get("from") or raw.get("from_instrument") or "").strip()
        match_prog = raw.get("from_program") or raw.get("match_program")
        if match_prog is None and match_name:
            match_prog = name_to_program(match_name)
        try:
            match_prog_i = int(match_prog) if match_prog is not None else None
        except (TypeError, ValueError):
            match_prog_i = name_to_program(str(match_prog or ""))

        if ch_raw is not None:
            try:
                ch = int(ch_raw)
            except (TypeError, ValueError):
                continue
            if ch == 9:
                continue
            n = _apply_channel_program(mid, ch, prog)
            if n:
                key = (-1, ch)
                if key not in touched:
                    touched.add(key)
                    changes.append(f"ch{ch}→{to_name or prog} ({n} tracks)")
                    resolved.append({"channel": ch, "program": prog, "instrument": to_name})
            continue

        if match_prog_i is not None:
            for ti, track in enumerate(mid.tracks):
                ch_prog = {}
                for msg in track:
                    if msg.type == "program_change":
                        ch_prog[int(getattr(msg, "channel", 0))] = int(msg.program)
                for ch, old in ch_prog.items():
                    if ch == 9 or old != match_prog_i:
                        continue
                    if _set_program_on_track(track, ch, prog):
                        key = (ti, ch)
                        if key not in touched:
                            touched.add(key)
                            changes.append(f"track{ti} match prog {old}→{prog}")
                            resolved.append({"track_index": ti, "channel": ch, "program": prog})

    # 2) band_parts：仅当尚无 track 级映射，或旧式单轨 MIDI
    band_parts = plan.get("band_parts")
    if isinstance(band_parts, list) and band_parts and not resolved:
        role_map = {
            str(p.get("role") or "").lower(): str(p.get("instrument") or p.get("to") or "").strip()
            for p in band_parts
            if isinstance(p, dict) and str(p.get("role") or "").lower() != "drums"
        }
        midi_tracks = plan.get("midi_tracks") or []
        if midi_mode and isinstance(midi_tracks, list) and midi_tracks:
            from .midi_analyze import build_track_mappings_from_roles

            auto_maps = build_track_mappings_from_roles(midi_tracks, band_parts)
            if auto_maps:
                sub_plan = {**plan, "track_mappings": auto_maps, "band_parts": []}
                sub_report = apply_remix_plan(midi_path, output_path, sub_plan)
                return sub_report

        for part in band_parts:
            if not isinstance(part, dict):
                continue
            ch = int(part.get("channel", 0))
            if ch == 9:
                continue
            inst = str(part.get("instrument") or part.get("to") or "").strip()
            prog = name_to_program(inst)
            if prog is None:
                continue
            role = str(part.get("role") or "").lower()
            n = _apply_channel_program(mid, ch, prog)
            if n:
                changes.append(f"band ch{ch}→{inst}({prog})")
                resolved.append({"channel": ch, "instrument": inst, "program": prog})
                if apply_role_mix and role:
                    for ti, track in enumerate(mid.tracks):
                        if _track_uses_channel(track, ch):
                            _apply_role_mix(track, ch, role)

    # 3) 全局 target_instrument（兜底：所有非鼓演奏轨）
    target_name = str(plan.get("target_instrument") or "").strip()
    if target_name and not resolved:
        tp = name_to_program(target_name)
        if tp is not None:
            for ti, track in enumerate(mid.tracks):
                if not _track_has_notes(track):
                    continue
                chs = {
                    int(getattr(m, "channel", 0))
                    for m in track
                    if m.type in ("note_on", "note_off") and int(getattr(m, "velocity", 0)) > 0
                }
                for ch in sorted(chs):
                    if ch == 9:
                        continue
                    if _set_program_on_track(track, ch, tp):
                        changes.append(f"track{ti} ch{ch}→{target_name}({tp})")
                        resolved.append({"track_index": ti, "channel": ch, "program": tp})

    # 4) 单轨独奏 MIDI：将全部演奏轨统一换成主旋律目标音色
    if not resolved and isinstance(band_parts, list) and band_parts:
        melody_part = next(
            (p for p in band_parts if isinstance(p, dict) and str(p.get("role") or "").lower() == "melody"),
            None,
        )
        if melody_part:
            inst = str(melody_part.get("instrument") or melody_part.get("to") or "").strip()
            prog = name_to_program(inst)
            if prog is not None:
                for ti, track in enumerate(mid.tracks):
                    if not _track_has_notes(track):
                        continue
                    chs = {
                        int(getattr(m, "channel", 0))
                        for m in track
                        if m.type in ("note_on", "note_off")
                        and int(getattr(m, "velocity", 0)) > 0
                    }
                    for ch in sorted(chs):
                        if ch == 9:
                            continue
                        if _set_program_on_track(track, ch, prog):
                            changes.append(f"solo track{ti} ch{ch}→{inst}({prog})")
                            resolved.append({"track_index": ti, "channel": ch, "program": prog, "solo": True})

    # 5) default_program 兜底
    default_prog = plan.get("default_program")
    if not resolved and default_prog is not None:
        try:
            dp = max(0, min(127, int(default_prog)))
            for track in mid.tracks:
                for msg in track:
                    if msg.type == "program_change" and int(getattr(msg, "channel", 0)) != 9:
                        msg.program = dp  # type: ignore[attr-defined]
            changes.append(f"default_program→{dp}")
        except (TypeError, ValueError):
            pass

    mid.save(str(output_path))
    return {
        "output": str(output_path),
        "changes": changes,
        "resolved_mappings": resolved,
        "mapping_count": len(resolved),
        "midi_swap_mode": midi_mode,
    }
