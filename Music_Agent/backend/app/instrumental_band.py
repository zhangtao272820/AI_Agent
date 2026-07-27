"""纯音乐乐队重演绎：other/bass 分轨转写 → 多通道 MIDI → 指挥式整理 → 换编制。"""
from __future__ import annotations

import logging
import shutil
import statistics
from pathlib import Path
from typing import Any

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

logger = logging.getLogger(__name__)

_DEFAULT_BPM = 72.0
CH_MELODY = 0
CH_BASS = 1
CH_HARMONY = 2
CH_PAD = 3


def is_instrumental_band_plan(plan: dict[str, Any] | None) -> bool:
    mode = str((plan or {}).get("remix_mode") or "").lower()
    if mode == "instrumental_band":
        return True
    return str((plan or {}).get("arrangement_mode") or "").lower() == "instrumental_band"


def _collect_notes_ch(mid: MidiFile) -> list[tuple[int, int, int, int, int]]:
    """(channel, start, end, pitch, velocity)"""
    raw: list[tuple[int, int, int, int, int]] = []
    for track in mid.tracks:
        t = 0
        open_n: dict[tuple[int, int], tuple[int, int]] = {}
        for msg in track:
            t += int(msg.time)
            ch = int(getattr(msg, "channel", 0))
            if ch == 9:
                continue
            if msg.type == "note_on" and int(getattr(msg, "velocity", 0)) > 0:
                open_n[(ch, int(msg.note))] = (t, int(getattr(msg, "velocity", 72) or 72))
            elif msg.type in ("note_off", "note_on") and (
                msg.type == "note_off" or int(getattr(msg, "velocity", 0)) == 0
            ):
                key = (ch, int(msg.note))
                st_vel = open_n.pop(key, None)
                if st_vel is not None:
                    st, vel = st_vel
                    raw.append((ch, st, max(st + 1, t), int(msg.note), vel))
    return raw


def _read_tempo_bpm(mid: MidiFile) -> float:
    tempos: list[float] = []
    for track in mid.tracks:
        for msg in track:
            if getattr(msg, "type", None) == "set_tempo":
                try:
                    us = int(msg.tempo)
                    if us > 0:
                        tempos.append(60_000_000.0 / us)
                except (TypeError, ValueError):
                    continue
    return float(statistics.median(tempos)) if tempos else _DEFAULT_BPM


def _triad_below(melody: int) -> list[int]:
    pc = melody % 12
    root = melody - pc
    return [root, root + 4, root + 7]


def _write_events(
    dest: Path,
    events: list[tuple[int, int, int, int, int]],
    *,
    tpb: int,
    bpm: float,
    track_name: str = "instrumental_band",
) -> None:
    out = MidiFile(ticks_per_beat=tpb)
    tempo_tr = MidiTrack()
    tempo_tr.append(MetaMessage("set_tempo", tempo=int(bpm2tempo(bpm)), time=0))
    tempo_tr.append(MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    perf = MidiTrack()
    perf.append(MetaMessage("track_name", name=track_name, time=0))
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


def merge_instrumental_band_midi(
    other_mid: Path,
    bass_mid: Path | None,
    dest: Path,
    *,
    melody_ch: int = CH_MELODY,
    bass_ch: int = CH_BASS,
    harmony_ch: int = CH_HARMONY,
    pad_ch: int = CH_PAD,
    bass_max_below_melody: int = 14,
) -> dict[str, int]:
    """
    other 轨转写 → 主旋律/和声/铺底（按音高分层，稀疏网格）；
    bass 轨转写 → 每小节根音贝斯。避免各声部同密度叠在一起。
    """
    o_mid = MidiFile(other_mid)
    tpb = int(o_mid.ticks_per_beat or 480)
    o_raw = [(st, en, pitch, vel) for _ch, st, en, pitch, vel in _collect_notes_ch(o_mid)]
    if not o_raw:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if bass_mid and bass_mid.is_file():
            shutil.copy2(bass_mid, dest)
            return {"melody_notes": 0, "bass_notes": 0, "harmony_notes": 0, "fallback": 1}
        raise RuntimeError("other 轨转写 MIDI 无音符")

    grid = max(1, tpb // 4)

    def snap(t: int) -> int:
        return max(0, round(t / grid) * grid)

    slots: dict[int, list[tuple[int, int]]] = {}
    for st, en, pitch, vel in o_raw:
        slot = snap(st)
        slots.setdefault(slot, []).append((int(pitch), int(vel)))

    events: list[tuple[int, int, int, int, int]] = []
    sustain = grid * 2

    for slot, pitches in sorted(slots.items()):
        if not pitches:
            continue
        end = slot + sustain
        uniq = sorted({p for p, _ in pitches}, reverse=True)
        max_vel = max(v for _, v in pitches)
        melody_pitch = uniq[0]
        events.append((melody_ch, melody_pitch, slot, end, min(108, max_vel + 4)))

        if slot % (grid * 2) == 0:
            harmony_candidates = [p for p in uniq[1:4] if melody_pitch - 22 <= p < melody_pitch - 3]
            if harmony_candidates:
                events.append((harmony_ch, harmony_candidates[0], slot, end, min(72, max_vel - 10)))

        if slot % (grid * 4) == 0:
            pad_candidates = [p for p in uniq if melody_pitch - 16 <= p <= melody_pitch - 5]
            if pad_candidates:
                events.append((pad_ch, pad_candidates[-1], slot, end, min(58, max_vel - 18)))
            elif slot % tpb == 0:
                triad = _triad_below(melody_pitch)
                if triad:
                    events.append((pad_ch, triad[0], slot, end, 52))

    bass_notes = 0
    bar_grid = tpb

    if bass_mid and bass_mid.is_file():
        b_mid = MidiFile(bass_mid)
        tpb = max(tpb, int(b_mid.ticks_per_beat or tpb))
        bar_grid = tpb
        b_raw = [(st, en, pitch, vel) for _ch, st, en, pitch, vel in _collect_notes_ch(b_mid)]
        bar_slots: dict[int, list[int]] = {}
        for st, en, pitch, vel in b_raw:
            bar = (snap(st) // bar_grid) * bar_grid
            bar_slots.setdefault(bar, []).append(int(pitch))
        for bar, pitches in sorted(bar_slots.items()):
            if not pitches or bar % bar_grid != 0:
                continue
            end = bar + bar_grid
            events.append((bass_ch, min(pitches), bar, end, 74))
            bass_notes += 1
    else:
        for slot, pitches in sorted(slots.items()):
            if slot % bar_grid != 0:
                continue
            uniq = sorted({p for p, _ in pitches})
            if not uniq:
                continue
            melody_pitch = max(uniq)
            lows = [p for p in uniq if p <= melody_pitch - bass_max_below_melody]
            if lows:
                end = slot + bar_grid
                events.append((bass_ch, min(lows), slot, end, 68))
                bass_notes += 1

    bpm = _read_tempo_bpm(o_mid)
    _write_events(dest, events, tpb=tpb, bpm=bpm)

    stats = {
        "melody_notes": sum(1 for e in events if e[0] == melody_ch),
        "harmony_notes": sum(1 for e in events if e[0] == harmony_ch),
        "pad_notes": sum(1 for e in events if e[0] == pad_ch),
        "bass_notes": bass_notes,
    }
    logger.info("instrumental_band merge %s -> %s %s", other_mid.name, dest.name, stats)
    return stats


def conduct_instrumental_band_midi(
    src: Path,
    dest: Path,
    *,
    style_id: str = "classical",
    divisions_per_beat: int = 2,
    melody_priority: float = 0.94,
    target_duration_sec: float | None = None,
) -> dict[str, int | float | str]:
    """
    指挥式整理：各声部对齐节拍网格、削薄密度、统一句长，像乐团排练后合奏。
    """
    mid = MidiFile(src)
    tpb = int(mid.ticks_per_beat or 480)
    raw = _collect_notes_ch(mid)
    if not raw:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        return {"notes_in": 0, "notes_out": 0, "mode": "conduct_band"}

    grid = max(1, tpb // max(1, divisions_per_beat))
    bpm = _read_tempo_bpm(mid)
    melody_priority = max(0.0, min(1.0, float(melody_priority)))
    sustain_mul = 3 if style_id in ("classical", "bgm", "folk") else 2

    by_ch: dict[int, dict[int, list[tuple[int, int]]]] = {
        CH_MELODY: {},
        CH_BASS: {},
        CH_HARMONY: {},
        CH_PAD: {},
    }
    for ch, st, en, pitch, vel in raw:
        if ch not in by_ch:
            continue
        slot = round(st / grid) * grid
        by_ch[ch].setdefault(slot, []).append((pitch, vel))

    # merge all channels into melody slots if melody empty
    if not by_ch[CH_MELODY]:
        for ch, slots in by_ch.items():
            if ch == CH_MELODY:
                continue
            for slot, items in slots.items():
                by_ch[CH_MELODY].setdefault(slot, []).extend(items)

    events: list[tuple[int, int, int, int, int]] = []
    melody_slots = sorted(by_ch[CH_MELODY].keys())
    if not melody_slots:
        shutil.copy2(src, dest)
        return {"notes_in": len(raw), "notes_out": 0, "mode": "conduct_band"}

    lead_boost = 1.0 + (melody_priority - 0.5) * 0.35

    for slot in melody_slots:
        items = by_ch[CH_MELODY].get(slot, [])
        if not items:
            continue
        pitches = sorted({p for p, _ in items}, reverse=True)
        melody = pitches[0]
        max_vel = max(v for _, v in items)
        is_downbeat = slot % tpb == 0
        sustain = grid * (sustain_mul + (1 if is_downbeat else 0))
        end = slot + sustain
        lead_vel = min(115, int((96 if melody_priority >= 0.9 else 88) * lead_boost))
        events.append((CH_MELODY, melody, slot, end, lead_vel))

        bass_items = by_ch[CH_BASS].get(slot) or by_ch[CH_BASS].get(slot - grid) or []
        bass_pitch: int | None = None
        if bass_items and (is_downbeat or slot % (grid * 2) == 0):
            bass_pitch = min(p for p, _ in bass_items)
        elif is_downbeat or slot % (grid * 4) == 0:
            lows = [p for p in pitches if p <= melody - 10]
            bass_pitch = min(lows) if lows else None
        if bass_pitch is not None and bass_pitch < melody - 4:
            events.append((CH_BASS, bass_pitch, slot, slot + tpb, 70))

        if is_downbeat or slot % (grid * 4) == 0:
            harm_items = by_ch[CH_HARMONY].get(slot, [])
            harm_pitch: int | None = None
            if harm_items:
                candidates = sorted({p for p, _ in harm_items if p < melody - 2})
                harm_pitch = candidates[0] if candidates else None
            if harm_pitch is None:
                mids = [p for p in pitches if melody - 16 <= p < melody - 2]
                harm_pitch = mids[0] if mids else None
            if harm_pitch is not None and harm_pitch != melody and harm_pitch != bass_pitch:
                events.append((CH_HARMONY, harm_pitch, slot, end, 58))

        if is_downbeat:
            pad_items = by_ch[CH_PAD].get(slot, [])
            pad_pitch: int | None = None
            if pad_items:
                pad_pitch = min(p for p, _ in pad_items)
            if pad_pitch is None:
                triad = _triad_below(melody)
                pad_pitch = triad[0] if triad else None
            if pad_pitch is not None and pad_pitch < melody - 2:
                events.append((CH_PAD, pad_pitch, slot, slot + tpb * 2, 46))

    deduped: list[tuple[int, int, int, int, int]] = []
    seen: set[tuple[int, int, int]] = set()
    for ch, pitch, st, en, vel in sorted(events, key=lambda x: (x[2], x[0], -x[4])):
        key = (ch, st, pitch)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((ch, pitch, st, en, vel))

    _write_events(dest, deduped, tpb=tpb, bpm=bpm, track_name="conducted_band")
    stats: dict[str, int | float | str] = {
        "notes_in": len(raw),
        "notes_out": len(deduped),
        "bpm": round(bpm, 1),
        "grid_ticks": grid,
        "mode": "conduct_band",
        "melody_notes": sum(1 for e in deduped if e[0] == CH_MELODY),
        "bass_notes": sum(1 for e in deduped if e[0] == CH_BASS),
        "harmony_notes": sum(1 for e in deduped if e[0] == CH_HARMONY),
        "pad_notes": sum(1 for e in deduped if e[0] == CH_PAD),
    }
    logger.info("conduct_instrumental_band %s -> %s %s", src.name, dest.name, stats)
    return stats
