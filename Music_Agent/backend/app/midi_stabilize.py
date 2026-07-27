"""Basic Pitch 等转写 MIDI 的量化与去抖，减轻 FluidSynth 渲染时的断续、抖动。"""
from __future__ import annotations

import logging
from pathlib import Path

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

logger = logging.getLogger(__name__)

_DEFAULT_BPM = 120
_MIN_NOTE_TICKS = 80  # 过短音符合并或丢弃


def _ticks_per_grid(ticks_per_beat: int, *, divisions: int = 4) -> int:
    return max(1, ticks_per_beat // max(1, divisions))


def stabilize_midi(
    src: Path,
    dest: Path,
    *,
    grid_divisions: int = 4,
    min_note_ticks: int = _MIN_NOTE_TICKS,
    default_bpm: float = _DEFAULT_BPM,
) -> dict[str, int]:
    """
    量化音符起止、合并同音重复触发、丢弃过短音。返回统计信息。
    """
    mid = MidiFile(src)
    tpb = int(mid.ticks_per_beat or 480)
    grid = _ticks_per_grid(tpb, divisions=grid_divisions)

    raw_notes: list[tuple[int, int, int, int, int]] = []
    tempo_us = bpm2tempo(default_bpm)

    for ti, track in enumerate(mid.tracks):
        t = 0
        open_notes: dict[tuple[int, int, int], list[int]] = {}
        for msg in track:
            t += int(msg.time)
            if msg.type == "set_tempo":
                tempo_us = int(msg.tempo)
            elif msg.type == "note_on" and getattr(msg, "velocity", 0) > 0:
                ch = int(getattr(msg, "channel", 0))
                key = (ti, ch, int(msg.note))
                open_notes.setdefault(key, []).append(t)
            elif msg.type in ("note_off", "note_on") and (
                msg.type == "note_off" or int(getattr(msg, "velocity", 0)) == 0
            ):
                ch = int(getattr(msg, "channel", 0))
                key = (ti, ch, int(msg.note))
                starts = open_notes.get(key)
                if not starts:
                    continue
                st = starts.pop(0)
                if not starts:
                    open_notes.pop(key, None)
                en = max(st + min_note_ticks, t)
                raw_notes.append((ti, ch, int(msg.note), st, en))

    if not raw_notes:
        import shutil

        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        return {"notes_in": 0, "notes_out": 0, "merged": 0}

    def snap_tick(x: int) -> int:
        return max(0, round(x / grid) * grid)

    stabilized: list[tuple[int, int, int, int, int]] = []
    by_ch: dict[tuple[int, int], list[tuple[int, int, int]]] = {}
    for ti, ch, note, st, en in raw_notes:
        st_q = snap_tick(st)
        en_q = max(st_q + grid, snap_tick(en))
        if en_q - st_q < min_note_ticks:
            en_q = st_q + min_note_ticks
        by_ch.setdefault((ti, ch), []).append((note, st_q, en_q))

    merged_count = 0
    for key, items in by_ch.items():
        items.sort(key=lambda x: (x[1], x[0]))
        cur: tuple[int, int, int] | None = None
        for note, st, en in items:
            if cur and cur[0] == note and st <= cur[2] + grid:
                cur = (note, cur[1], max(cur[2], en))
                merged_count += 1
            else:
                if cur:
                    stabilized.append((key[0], key[1], cur[0], cur[1], cur[2]))
                cur = (note, st, en)
        if cur:
            stabilized.append((key[0], key[1], cur[0], cur[1], cur[2]))

    out = MidiFile(ticks_per_beat=tpb)
    track_count = max((ti for ti, *_ in stabilized), default=0) + 1
    tracks: list[MidiTrack] = []
    for _ in range(track_count):
        tr = MidiTrack()
        tr.append(MetaMessage("track_name", name="remix", time=0))
        tracks.append(tr)

    events_by_track: dict[int, list[tuple[int, Message]]] = {i: [] for i in range(track_count)}
    for ti, ch, note, st, en in stabilized:
        vel = 72
        events_by_track[ti].append((st, Message("note_on", note=note, velocity=vel, channel=ch, time=0)))
        events_by_track[ti].append((en, Message("note_off", note=note, velocity=0, channel=ch, time=0)))

    for ti, evs in events_by_track.items():
        if not evs:
            continue
        evs.sort(key=lambda x: (x[0], 0 if x[1].type == "note_on" else 1))
        last = 0
        for abs_t, msg in evs:
            msg.time = max(0, abs_t - last)
            last = abs_t
            tracks[ti].append(msg)

    tempo_track = MidiTrack()
    tempo_track.append(MetaMessage("set_tempo", tempo=tempo_us, time=0))
    tempo_track.append(MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    out.tracks = [tempo_track] + [t for t in tracks if len(t) > 1]

    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    stats = {
        "notes_in": len(raw_notes),
        "notes_out": len(stabilized),
        "merged": merged_count,
        "grid_ticks": grid,
    }
    logger.info("midi_stabilize %s -> %s %s", src.name, dest.name, stats)
    return stats
