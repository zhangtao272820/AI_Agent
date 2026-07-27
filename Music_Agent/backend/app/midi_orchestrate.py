"""
将 Basic Pitch 等稠密 MIDI 整理为「统一节拍 + 多声部乐队」谱面（含鼓组）。

LLM 负责 band_parts 音色与曲风；音符与鼓型由此模块按网格生成。
"""
from __future__ import annotations

import logging
import statistics
from pathlib import Path

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

logger = logging.getLogger(__name__)

CH_MELODY = 0
CH_BASS = 1
CH_HARMONY = 2
CH_PAD = 3
CH_DRUMS = 9
_DEFAULT_BPM = 120.0

# GM 鼓映射（channel 9）
_DRUM_KICK = 36
_DRUM_SNARE = 38
_DRUM_HH = 42


def _collect_notes(mid: MidiFile) -> list[tuple[int, int, int, int]]:
    notes: list[tuple[int, int, int, int]] = []
    for ch, st, en, pitch, vel in _collect_notes_ch(mid):
        notes.append((st, en, pitch, vel))
    return notes


def _collect_notes_ch(mid: MidiFile) -> list[tuple[int, int, int, int, int]]:
    notes: list[tuple[int, int, int, int, int]] = []
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
                    notes.append((ch, st, max(st + 1, t), int(msg.note), vel))
    return notes


def _read_tempo_bpm_from_midi(mid: MidiFile) -> float | None:
    """读取 MIDI 内 set_tempo，用于避免重估 BPM 导致播放时长翻倍/减半。"""
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
    if not tempos:
        return None
    return float(statistics.median(tempos))


def _bpm_from_target_duration(max_tick: int, tpb: int, target_sec: float) -> float | None:
    if max_tick <= 0 or tpb <= 0 or target_sec <= 0:
        return None
    bpm = 60.0 * max_tick / (tpb * target_sec)
    return bpm if 40 <= bpm <= 220 else None


def _estimate_bpm(
    onsets: list[int],
    tpb: int,
    *,
    hint_bpm: float | None = None,
    target_duration_sec: float | None = None,
    max_tick: int | None = None,
) -> float:
    if hint_bpm and 40 <= hint_bpm <= 220:
        return float(hint_bpm)
    if max_tick and target_duration_sec and target_duration_sec > 0:
        dur_bpm = _bpm_from_target_duration(max_tick, tpb, target_duration_sec)
        if dur_bpm is not None:
            return dur_bpm
    if len(onsets) < 6:
        return _DEFAULT_BPM
    uniq = sorted(set(onsets))
    iois = [uniq[i + 1] - uniq[i] for i in range(len(uniq) - 1) if uniq[i + 1] - uniq[i] > max(8, tpb // 32)]
    if not iois:
        return _DEFAULT_BPM
    med = float(statistics.median(iois))
    candidates: list[float] = []
    for mult in (1, 2, 4, 8):
        q_ticks = med * mult
        if q_ticks < tpb * 0.25 or q_ticks > tpb * 4:
            continue
        bpm = 60.0 * tpb / q_ticks
        if 50 <= bpm <= 200:
            candidates.append(bpm)
    if not candidates:
        return _DEFAULT_BPM
    if hint_bpm and hint_bpm > 0:
        return min(candidates, key=lambda b: abs(b - hint_bpm))
    # 常见流行曲速带，减少把四分误估成八分导致时长翻倍
    return min(candidates, key=lambda b: abs(b - 108.0))


def _grid_ticks(tpb: int, divisions_per_beat: int) -> int:
    return max(1, tpb // max(1, divisions_per_beat))


def _triad_below(melody: int, style_id: str = "mandopop") -> list[int]:
    """强拍铺底：按风格偏好的和声骨架回填。"""
    pc = melody % 12
    root = melody - pc
    sid = (style_id or "mandopop").lower()
    if sid == "jazz":
        return [root, root + 3, root + 10]
    if sid == "classical":
        return [root, root + 4, root + 7]
    if sid == "folk":
        return [root, root + 5, root + 7]
    if sid == "electronic":
        return [root, root + 7, root + 12]
    if sid == "jpop":
        return [root, root + 4, root + 9]
    return [root, root + 4, root + 7]


def _append_drums(
    out: list[tuple[int, int, int, int, int]],
    slot: int,
    grid: int,
    tpb: int,
    *,
    style_id: str = "mandopop",
) -> None:
    eighth = (slot // grid) % 8
    dense = style_id in ("electronic", "jpop")
    swing = style_id == "jazz"
    if eighth in (0, 4):
        out.append((CH_DRUMS, _DRUM_KICK, slot, slot + grid, 102 if dense else 98))
    if eighth in (2, 6):
        out.append((CH_DRUMS, _DRUM_SNARE, slot, slot + grid, 90 if not swing else 76))
    if style_id == "folk":
        if eighth % 2 == 0:
            out.append((CH_DRUMS, _DRUM_HH, slot, slot + grid, 40))
        if eighth in (1, 5):
            out.append((CH_DRUMS, _DRUM_KICK, slot, slot + grid, 52))
    elif dense:
        out.append((CH_DRUMS, _DRUM_HH, slot, slot + grid, 54))
        if eighth in (1, 3, 5, 7):
            out.append((CH_DRUMS, _DRUM_HH, slot, slot + grid, 40))
    elif swing:
        if eighth % 2 == 0:
            out.append((CH_DRUMS, _DRUM_HH, slot, slot + grid, 52))
        if eighth in (1, 3, 5, 7):
            out.append((CH_DRUMS, _DRUM_HH, slot, slot + grid, 34))
    elif style_id == "classical":
        if eighth % 4 == 0:
            out.append((CH_DRUMS, _DRUM_KICK, slot, slot + grid, 72))
    elif eighth % 2 == 0:
        out.append((CH_DRUMS, _DRUM_HH, slot, slot + grid, 48))


def orchestrate_midi(
    src: Path,
    dest: Path,
    *,
    mode: str = "band",
    style_id: str = "mandopop",
    bpm_override: float | None = None,
    divisions_per_beat: int = 2,
    max_harmony: int = 3,
    melody_priority: float = 0.88,
    style_hint: str | None = None,
    target_duration_sec: float | None = None,
    tpb: int = 480,
) -> dict[str, int | float | str]:
    """
    band：主旋律+贝斯+和声+铺底和弦+鼓组，齐奏网格。
    conducted：同 band（兼容旧名）。
    light：仅网格对齐，保留更多复音。
    melody_only：每格只保留最高音作主旋律。
    vocal_band：保留主旋律轨音符，并补鼓/贝斯/和声/铺底（人声流行）。
    """
    mid = MidiFile(src)
    tpb = int(mid.ticks_per_beat or tpb)
    raw_ch = _collect_notes_ch(mid)
    raw = [(st, en, pitch, vel) for _ch, st, en, pitch, vel in raw_ch]
    if not raw:
        import shutil

        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        return {"notes_in": 0, "notes_out": 0, "bpm": _DEFAULT_BPM, "mode": mode}

    grid = _grid_ticks(tpb, divisions_per_beat)
    onsets = [st for st, _, _, _ in raw]
    max_tick = max(en for _, en, _, _ in raw)
    file_bpm = _read_tempo_bpm_from_midi(mid)
    if bpm_override and bpm_override > 0:
        bpm = float(bpm_override)
    else:
        bpm = _estimate_bpm(
            onsets,
            tpb,
            hint_bpm=file_bpm,
            target_duration_sec=target_duration_sec,
            max_tick=max_tick,
        )
    melody_priority = max(0.0, min(1.0, float(melody_priority)))
    melody_focus = melody_priority >= 0.9
    style_hint_l = (style_hint or style_id or "mandopop").strip().lower()
    lead_boost = 1.0 + (melody_priority - 0.5) * 0.45
    tempo_us = int(bpm2tempo(bpm))
    slot_end = (max_tick // grid + 2) * grid

    slots: dict[int, list[tuple[int, int]]] = {}
    tol = max(1, grid // 4)
    for st, _en, pitch, vel in raw:
        slot = round(st / grid) * grid
        slots.setdefault(slot, []).append((pitch, vel))

    out_notes: list[tuple[int, int, int, int, int]] = []
    preserved_melody: set[tuple[int, int, int]] = set()

    def snap_tick(t: int) -> int:
        return max(0, round(t / grid) * grid)
    mode_l = (mode or "band").strip().lower()
    if mode_l == "conducted":
        mode_l = "band"
    style_l = (style_id or "mandopop").strip().lower()
    if style_hint_l in ("jpop", "jazz", "classical", "folk", "electronic"):
        style_l = style_hint_l if style_hint_l != "jpop" else "jpop"
    if style_l == "mandopop" and style_hint_l == "jpop":
        style_l = "jpop"
    if style_l == "jpop":
        lead_boost += 0.08
    elif style_l == "jazz":
        lead_boost -= 0.04
    elif style_l == "classical":
        lead_boost -= 0.02
    elif style_l == "electronic":
        lead_boost += 0.05

    if mode_l == "vocal_band":
        for ch, st, en, pitch, vel in raw_ch:
            if ch != CH_MELODY:
                continue
            st_q = snap_tick(st)
            en_q = max(st_q + grid, snap_tick(en))
            key = (CH_MELODY, st_q, int(pitch))
            if key in preserved_melody:
                continue
            preserved_melody.add(key)
            lead_vel = min(127, int((104 if melody_focus else 96) * lead_boost))
            out_notes.append((CH_MELODY, int(pitch), st_q, en_q, lead_vel))

    for slot in range(0, slot_end, grid):
        items = slots.get(slot)
        if not items:
            for delta in (-tol, tol):
                items = slots.get(slot + delta)
                if items:
                    break

        is_downbeat = slot % tpb == 0
        sustain = grid * (4 if is_downbeat else 2)
        end = slot + sustain

        if mode_l == "band" and not melody_focus:
            _append_drums(out_notes, slot, grid, tpb, style_id=style_l)
        elif mode_l == "band" and melody_focus and is_downbeat:
            _append_drums(out_notes, slot, grid, tpb, style_id=style_l)

        if not items:
            continue

        pitches = sorted({p for p, _ in items})
        if not pitches:
            continue

        if mode_l in ("melody_only", "melody"):
            melody = max(pitches)
            lead_vel = min(127, int((104 if melody_focus else 96) * lead_boost))
            out_notes.append((CH_MELODY, melody, slot, end, lead_vel))
            continue

        if mode_l == "vocal_band":
            _append_drums(out_notes, slot, grid, tpb, style_id=style_l)
            if not items:
                continue
            slot_pitches = sorted({p for p, _ in items}, reverse=True)
            melody_top = slot_pitches[0]
            lows = [p for p in slot_pitches if p <= melody_top - 8]
            if lows and not any(n[0] == CH_BASS and n[1] == min(lows) for n in out_notes if n[2] == slot):
                out_notes.append((CH_BASS, min(lows), slot, end, 70 if melody_focus else 76))
            mids = [p for p in slot_pitches if melody_top - 14 <= p < melody_top - 2]
            if mids and slot % (grid * 2) == 0:
                out_notes.append((CH_HARMONY, mids[0], slot, end, 52 if melody_focus else 58))
            if is_downbeat:
                for p in _triad_below(melody_top, style_l):
                    if p < melody_top - 2:
                        out_notes.append((CH_PAD, p, slot, end, 46 if melody_focus else 50))
            continue

        if mode_l == "light":
            ordered = sorted(pitches, reverse=True)
            cap = 2 if melody_focus else 4
            for i, p in enumerate(ordered[:cap]):
                ch = (CH_MELODY, CH_BASS)[i] if melody_focus else (CH_MELODY, CH_BASS, CH_HARMONY, CH_PAD)[i % 4]
                vel = int((98 if ch == CH_MELODY else 52) * lead_boost)
                if ch != CH_MELODY:
                    vel = max(36, vel - (16 if melody_focus else 8))
                out_notes.append((ch, p, slot, end, min(120, vel)))
            continue

        melody = max(pitches)
        lead_vel = min(120, int((98 if melody_focus else 92) * lead_boost))
        out_notes.append((CH_MELODY, melody, slot, end, lead_vel))

        lows = [p for p in pitches if p < melody - 5]
        if lows and (is_downbeat or slot % (grid * 2) == 0):
            bass = min(lows)
            if bass <= melody - 8:
                bass_vel = 68 if melody_focus else (74 if style_l != "jazz" else 66)
                out_notes.append((CH_BASS, bass, slot, end, bass_vel))

        harm_cap = 1 if melody_focus else max_harmony
        mids = [p for p in pitches if melody - 14 <= p < melody - 1]
        mids_sorted = sorted(mids, reverse=True)[:harm_cap]
        if style_l == "jazz" and not melody_focus:
            mids_sorted = mids_sorted[: max(1, max_harmony - 1)]
        for idx, p in enumerate(mids_sorted):
            vel = (48 if melody_focus else 60) - idx * 4
            out_notes.append((CH_HARMONY, p, slot, end, max(38, vel)))

        if is_downbeat and not melody_focus:
            for p in _triad_below(melody, style_l):
                if p < melody - 2:
                    out_notes.append((CH_PAD, p, slot, end, 52 if style_l != "jazz" else 48))

    out = MidiFile(ticks_per_beat=tpb)
    tempo_tr = MidiTrack()
    tempo_tr.append(MetaMessage("set_tempo", tempo=tempo_us, time=0))
    tempo_tr.append(MetaMessage("time_signature", numerator=4, denominator=4, time=0))

    perf = MidiTrack()
    perf.append(MetaMessage("track_name", name="band", time=0))

    events: list[tuple[int, Message]] = []
    for ch, pitch, st, en, vel in out_notes:
        events.append(
            (st, Message("note_on", note=pitch, velocity=vel, channel=ch, time=0))
        )
        events.append(
            (en, Message("note_off", note=pitch, velocity=0, channel=ch, time=0))
        )
    events.sort(key=lambda x: (x[0], 0 if x[1].type == "note_on" else 1))
    last = 0
    for abs_t, msg in events:
        msg.time = max(0, abs_t - last)
        last = abs_t
        perf.append(msg)

    out.tracks = [tempo_tr, perf]
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    stats: dict[str, int | float | str] = {
        "notes_in": len(raw),
        "notes_out": len(out_notes),
        "bpm": round(bpm, 1),
        "grid_ticks": grid,
        "mode": mode_l,
        "style_id": style_l,
    }
    logger.info("midi_orchestrate %s -> %s %s", src.name, dest.name, stats)
    return stats
