"""纯音乐 BGM：Basic Pitch 转写后的主旋律提取，保留原始起音时间以减少卡顿。"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

from .midi_remap import name_to_program

logger = logging.getLogger(__name__)

_DEFAULT_BPM = 72.0
_OUTPUT_TPB = 960


def _collect_note_segments(mid: MidiFile) -> list[tuple[int, int, int]]:
    segments: list[tuple[int, int, int]] = []
    for track in mid.tracks:
        t = 0
        open_notes: dict[int, list[int]] = {}
        for msg in track:
            t += int(msg.time)
            if msg.type == "note_on" and int(getattr(msg, "velocity", 0)) > 0:
                open_notes.setdefault(int(msg.note), []).append(t)
            elif msg.type in ("note_off", "note_on") and (
                msg.type == "note_off" or int(getattr(msg, "velocity", 0)) == 0
            ):
                pitch = int(msg.note)
                starts = open_notes.get(pitch)
                if not starts:
                    continue
                st = starts.pop(0)
                if not starts:
                    open_notes.pop(pitch, None)
                segments.append((pitch, st, max(st + 1, t)))
    return segments


def _scale_segments(
    segments: list[tuple[int, int, int]], src_tpb: int, dst_tpb: int
) -> list[tuple[int, int, int]]:
    if src_tpb <= 0 or src_tpb == dst_tpb:
        return segments
    ratio = dst_tpb / src_tpb
    return [(p, int(st * ratio), max(int(st * ratio) + 1, int(en * ratio))) for p, st, en in segments]


def _extract_highest_voice_segments(
    segments: list[tuple[int, int, int]],
) -> list[tuple[int, int, int]]:
    events: list[tuple[int, str, int]] = []
    for pitch, st, en in segments:
        events.append((st, "on", pitch))
        events.append((en, "off", pitch))
    events.sort(key=lambda x: (x[0], 0 if x[1] == "off" else 1))

    active: set[int] = set()
    melody: list[tuple[int, int, int]] = []
    cur_pitch: int | None = None
    cur_start: int | None = None

    def close(at: int) -> None:
        nonlocal cur_pitch, cur_start
        if cur_pitch is not None and cur_start is not None and at > cur_start:
            melody.append((cur_pitch, cur_start, at))
        cur_pitch = None
        cur_start = None

    for t, kind, pitch in events:
        if kind == "on":
            active.add(pitch)
        else:
            active.discard(pitch)
        top = max(active) if active else None
        if top != cur_pitch:
            close(t)
            if top is not None:
                cur_pitch = top
                cur_start = t
    return melody


def clean_bgm_pitch_midi(
    src: Path,
    dest: Path,
    *,
    melody_voices: int = 1,
    grid_divisions: int = 16,
    min_note_ms: float = 70.0,
    legato_gap_ms: float = 120.0,
    legato_overlap_ms: float = 45.0,
    default_bpm: float = _DEFAULT_BPM,
    ticks_per_beat: int = _OUTPUT_TPB,
    lead_instrument: str = "music_box",
) -> dict[str, int | float | str]:
    """
    提取最高主旋律；**不量化起音**（减轻卡顿），仅连奏合并与尾部略延长。
    """
    _ = melody_voices
    mid = MidiFile(src)
    src_tpb = int(mid.ticks_per_beat or 480)
    tpb = int(ticks_per_beat)
    min_ticks = max(8, int(tpb * min_note_ms / 60000.0))
    legato_ticks = max(1, int(tpb * legato_gap_ms / 60000.0))
    overlap_ticks = max(1, int(tpb * legato_overlap_ms / 60000.0))

    raw = _collect_note_segments(mid)
    if not raw:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        return {"notes_in": 0, "notes_out": 0, "lead_instrument": lead_instrument}

    scaled_raw = _scale_segments(raw, src_tpb, tpb)
    melody = _extract_highest_voice_segments(scaled_raw)
    if not melody:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        return {"notes_in": len(raw), "notes_out": 0, "lead_instrument": lead_instrument}

    merged: list[tuple[int, int, int]] = []
    for pitch, st, en in sorted(melody, key=lambda x: (x[1], x[0])):
        en_ext = en + overlap_ticks
        if merged and merged[-1][0] == pitch and st <= merged[-1][2] + legato_ticks:
            prev = merged[-1]
            merged[-1] = (pitch, prev[1], max(prev[2], en_ext))
        else:
            if en_ext - st < min_ticks:
                en_ext = st + min_ticks
            merged.append((pitch, st, en_ext))

    prog = name_to_program(lead_instrument) or name_to_program("music_box") or 10

    out = MidiFile(ticks_per_beat=tpb)
    tempo_track = MidiTrack()
    tempo_track.append(MetaMessage("set_tempo", tempo=bpm2tempo(default_bpm), time=0))
    tempo_track.append(MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    melody_track = MidiTrack()
    melody_track.append(MetaMessage("track_name", name="bgm_melody", time=0))
    melody_track.append(Message("program_change", program=int(prog), channel=0, time=0))

    last = 0
    for pitch, st, en in merged:
        melody_track.append(
            Message("note_on", note=pitch, velocity=84, channel=0, time=max(0, st - last))
        )
        last = st
        melody_track.append(
            Message("note_off", note=pitch, velocity=0, channel=0, time=max(min_ticks, en - st))
        )
        last = en

    out.tracks = [tempo_track, melody_track]
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    stats: dict[str, int | float | str] = {
        "notes_in": len(raw),
        "notes_out": len(merged),
        "ticks_per_beat": tpb,
        "bpm": default_bpm,
        "lead_instrument": lead_instrument,
        "program": int(prog),
    }
    logger.info("midi_bgm_clean %s -> %s %s", src.name, dest.name, stats)
    return stats
