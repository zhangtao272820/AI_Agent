"""music21 乐理分析 + 旋律配和声（确定性工具，LLM 只编排参数）。"""
from __future__ import annotations

import logging
import random
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

from .harmony import dp_refine_degrees, init_progression
from .keys import degree_chords, midi_pitch_from_pc, parse_key
from .midi_analyze import analyze_midi_structure, enrich_analysis_with_midi

logger = logging.getLogger(__name__)

_ROMAN = ("I", "ii", "iii", "IV", "V", "vi", "vii°")


@dataclass
class TheoryAnalyzeResult:
    ok: bool
    key: str = "未知"
    mode: str = "major"
    time_signature: str = "4/4"
    tempo_bpm: float | None = None
    duration_quarters: float = 0.0
    duration_seconds: float | None = None
    parts: int = 0
    note_count: int = 0
    chord_progression: list[str] = field(default_factory=list)
    sections: list[dict[str, Any]] = field(default_factory=list)
    tracks: list[dict[str, Any]] = field(default_factory=list)
    summary_zh: str = ""
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "key": self.key,
            "mode": self.mode,
            "time_signature": self.time_signature,
            "tempo_bpm": self.tempo_bpm,
            "duration_quarters": round(self.duration_quarters, 2),
            "duration_seconds": round(self.duration_seconds, 2) if self.duration_seconds else None,
            "parts": self.parts,
            "note_count": self.note_count,
            "chord_progression": self.chord_progression,
            "sections": self.sections,
            "tracks": self.tracks,
            "summary_zh": self.summary_zh,
            "issues": self.issues,
        }


@dataclass
class HarmonizeResult:
    ok: bool
    output_path: Path | None = None
    key: str = ""
    harmony_style: str = "pop"
    bars: int = 0
    chord_degrees: list[int] = field(default_factory=list)
    chord_roman: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "output": self.output_path.name if self.output_path else None,
            "key": self.key,
            "harmony_style": self.harmony_style,
            "bars": self.bars,
            "chord_degrees": self.chord_degrees,
            "chord_roman": self.chord_roman,
            "issues": self.issues,
        }


def theory_catalog() -> dict[str, Any]:
    """内置乐理工具清单（对标 MCP tool catalog）。"""
    return {
        "version": "2.0.0",
        "tools": [
            {
                "id": "music_analyze",
                "method": "POST /api/music/analyze",
                "description": "MIDI 深度分析：调性、拍号、速度、和弦进行、声部结构",
            },
            {
                "id": "music_harmonize",
                "method": "POST /api/music/harmonize",
                "description": "为 MIDI 主旋律自动配和声（块和弦 + 贝斯），输出新 MIDI",
            },
            {
                "id": "music_compose",
                "method": "WS compose",
                "description": "自然语言 → 结构化意图 → MIDI + WAV",
            },
            {
                "id": "music_stems",
                "method": "POST /api/music/stems",
                "description": "Demucs 分轨导出 vocals/drums/bass/other（不重编配）",
            },
            {
                "id": "music_bgm",
                "method": "POST /api/music/generate-bgm",
                "description": "按时长/情绪生成短视频 BGM（rule MIDI 或神经引擎）",
            },
            {
                "id": "music_midi_swap",
                "method": "WS midi_swap",
                "description": "上传 MIDI 保留音符，仅换 GM 音色",
            },
            {
                "id": "music_score",
                "method": "compose exports / POST /api/music/export-score",
                "description": "MusicXML / PDF / ABC 导出",
            },
            {
                "id": "music_lyrics",
                "method": "POST /api/music/poetic-lyrics",
                "description": "Whisper 转写 + 诗意写词",
            },
        ],
    }


def _roman_for_degree(deg: int, minor: bool) -> str:
    d = int(deg) % 7
    label = _ROMAN[d]
    if minor and d in (0, 3, 4):
        return label.lower() if label[0].isupper() else label
    return label


def _extract_tempo_bpm(score: Any) -> float | None:
    try:
        mm = score.metronomeMarkBoundaries()
        if mm:
            return float(mm[0][2].number)
    except Exception:
        pass
    try:
        for el in score.recurse():
            if getattr(el, "number", None):
                return float(el.number)
    except Exception:
        pass
    return None


def _chord_progression_from_score(score: Any, max_bars: int = 32) -> list[str]:
    out: list[str] = []
    try:
        from music21 import chord, roman

        k = score.analyze("key")
        ch_score = score.chordify()
        bars_seen = 0
        for el in ch_score.recurse().getElementsByClass(chord.Chord):
            if bars_seen >= max_bars:
                break
            try:
                rn = roman.romanNumeralFromChord(el, k)
                out.append(str(rn.figure))
            except Exception:
                out.append(el.pitchedCommonName or "Ch")
            bars_seen += 1
    except Exception as ex:
        logger.info("chord progression skipped: %s", ex)
    return out[:max_bars]


def analyze_midi_file(path: Path) -> TheoryAnalyzeResult:
    """对 MIDI 做 music21 + mido 联合分析。"""
    res = TheoryAnalyzeResult(ok=False)
    if not path.is_file():
        res.issues.append("文件不存在")
        return res

    midi_meta: dict[str, Any] = {}
    try:
        midi_meta = enrich_analysis_with_midi({}, path)
    except Exception as ex:
        res.issues.append(f"mido 摘要失败: {ex}")

    try:
        from music21 import converter, meter, note

        score = converter.parse(str(path))
    except ImportError:
        res.issues.append("未安装 music21")
        if midi_meta:
            res.ok = True
            res.tracks = list(midi_meta.get("midi_tracks") or [])
            res.summary_zh = "仅 mido 摘要（music21 不可用）"
        return res
    except Exception as ex:
        res.issues.append(f"MIDI 解析失败: {ex}")
        return res

    res.ok = True
    try:
        k = score.analyze("key")
        res.key = f"{k.tonic.name}"
        res.mode = str(getattr(k, "mode", "major") or "major")
    except Exception:
        res.key = "未知"
        res.issues.append("调性分析不确定")

    try:
        ts = score.flat.getElementsByClass(meter.TimeSignature).first()
        if ts:
            res.time_signature = ts.ratioString
    except Exception:
        pass

    res.tempo_bpm = _extract_tempo_bpm(score)
    res.duration_quarters = float(score.duration.quarterLength or 0)
    if res.tempo_bpm and res.tempo_bpm > 0:
        res.duration_seconds = res.duration_quarters * 60.0 / res.tempo_bpm

    parts = list(score.parts) if getattr(score, "parts", None) else []
    res.parts = len(parts) if parts else 1
    res.note_count = sum(1 for n in score.flatten().notes if isinstance(n, note.Note))

    res.chord_progression = _chord_progression_from_score(score)
    try:
        struct = analyze_midi_structure(path)
        res.tracks = list(struct.get("midi_tracks") or [])
        if struct.get("sections"):
            res.sections = list(struct["sections"])
    except Exception as ex:
        logger.info("midi structure skipped: %s", ex)
        res.tracks = list(midi_meta.get("midi_tracks") or [])

    prog_brief = " → ".join(res.chord_progression[:8])
    if len(res.chord_progression) > 8:
        prog_brief += " …"
    res.summary_zh = (
        f"调性 {res.key} {res.mode}；{res.time_signature}；"
        f"约 {res.duration_quarters:.0f} 四分音符"
        + (f"（{res.duration_seconds:.0f}s @ {res.tempo_bpm:.0f}bpm）" if res.tempo_bpm else "")
        + f"；{res.parts} 声部、{res.note_count} 个音"
        + (f"；和弦进行 {prog_brief}" if prog_brief else "")
    )
    return res


def _melody_notes_from_midi(path: Path) -> tuple[list[tuple[int, int, int]], int, int]:
    """返回 (pitch, start_tick, dur_tick) 列表、ticks_per_beat、tempo_us。"""
    mid = MidiFile(path)
    tpb = mid.ticks_per_beat or 480
    tempo_us = int(bpm2tempo(120.0))
    best_track_idx = 0
    best_notes = 0
    for ti, track in enumerate(mid.tracks):
        n = sum(
            1
            for m in track
            if m.type == "note_on"
            and getattr(m, "velocity", 0) > 0
            and getattr(m, "channel", 0) != 9
        )
        if n > best_notes:
            best_notes = n
            best_track_idx = ti

    track = mid.tracks[best_track_idx]
    abs_tick = 0
    active: dict[tuple[int, int], int] = {}
    events: list[tuple[int, int, int]] = []
    for msg in track:
        abs_tick += msg.time
        ch = int(getattr(msg, "channel", 0))
        if ch == 9:
            continue
        if msg.type == "set_tempo":
            tempo_us = int(msg.tempo)
        elif msg.type == "note_on" and msg.velocity > 0:
            active[(ch, msg.note)] = abs_tick
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            note = int(msg.note)
            key = (ch, note)
            if key in active:
                start = active.pop(key)
                dur = max(1, abs_tick - start)
                events.append((note, start, dur))
    return events, tpb, tempo_us


def _events_to_bars(
    events: list[tuple[int, int, int]],
    tpb: int,
    beats_per_bar: int = 4,
) -> tuple[int, list[list[int]]]:
    bar_ticks = tpb * beats_per_bar
    if not events:
        return 1, [[]]
    max_tick = max(s + d for _, s, d in events)
    bars = max(1, (max_tick + bar_ticks - 1) // bar_ticks)
    strong_pcs: list[list[int]] = [[] for _ in range(bars)]
    for pitch, start, _dur in events:
        bar_i = min(bars - 1, start // bar_ticks)
        pos_in_bar = (start % bar_ticks) / max(1, tpb)
        if pos_in_bar < 0.25 or abs(pos_in_bar - 2.0) < 0.35:
            strong_pcs[bar_i].append(pitch % 12)
    return bars, strong_pcs


def harmonize_midi_file(
    src: Path,
    dest: Path,
    *,
    harmony_style: str = "pop",
    key_override: str | None = None,
    tempo_bpm: float | None = None,
    seed: int | None = None,
) -> HarmonizeResult:
    """提取主旋律 → DP 选和弦 → 写 melody + 块和弦 + 贝斯 MIDI。"""
    res = HarmonizeResult(ok=False, harmony_style=harmony_style)
    if not src.is_file():
        res.issues.append("源 MIDI 不存在")
        return res

    events, tpb, tempo_us = _melody_notes_from_midi(src)
    if not events:
        res.issues.append("未找到可配和声的旋律音符")
        return res

    key_str = key_override or "C大调"
    minor = "小" in key_str or "minor" in key_str.lower()
    if not key_override:
        try:
            from music21 import converter

            score = converter.parse(str(src))
            k = score.analyze("key")
            key_str = f"{k.tonic.name}{'小调' if k.mode == 'minor' else '大调'}"
            minor = k.mode == "minor"
        except Exception as ex:
            logger.info("key detect fallback C: %s", ex)
            key_str = "C大调"

    root_pc, scale_pcs, minor = parse_key(key_str)
    res.key = key_str
    bars, strong_pcs = _events_to_bars(events, tpb)
    res.bars = bars
    rng = random.Random(seed if seed is not None else uuid.uuid4().int & 0xFFFF)
    chord_degrees = dp_refine_degrees(
        bars=bars,
        style=harmony_style,
        minor=minor,
        root_pc=root_pc,
        melody_strong_pc_per_bar=strong_pcs,
        rng=rng,
    )
    if len(chord_degrees) < bars:
        chord_degrees = init_progression(bars, harmony_style, minor, rng)
    res.chord_degrees = chord_degrees[:bars]
    res.chord_roman = [_roman_for_degree(d, minor) for d in res.chord_degrees]

    chords_all = degree_chords(root_pc, minor)
    bpm = float(tempo_bpm or 120.0)
    tempo_us = int(bpm2tempo(bpm))
    bar_ticks = tpb * 4

    mid = MidiFile(ticks_per_beat=tpb)
    meta = MidiTrack()
    meta.append(MetaMessage("set_tempo", tempo=tempo_us, time=0))
    meta.append(MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    mid.tracks.append(meta)

    mel_tr = MidiTrack()
    mel_tr.append(Message("program_change", channel=0, program=0, time=0))
    cur_tick = 0
    for pitch, start, dur in sorted(events, key=lambda x: x[1]):
        delta_on = max(0, start - cur_tick)
        mel_tr.append(Message("note_on", channel=0, note=pitch, velocity=82, time=delta_on))
        mel_tr.append(Message("note_off", channel=0, note=pitch, velocity=0, time=max(1, dur)))
        cur_tick = start + dur
    mid.tracks.append(mel_tr)

    harm_tr = MidiTrack()
    harm_tr.append(Message("program_change", channel=1, program=48, time=0))
    tick_cursor = 0
    for bar in range(bars):
        bar_start = bar * bar_ticks
        delta = max(0, bar_start - tick_cursor)
        deg = chord_degrees[bar] % 7
        triad = chords_all[deg]
        cps = [midi_pitch_from_pc(triad[i], 4) for i in range(3)]
        harm_tr.append(Message("note_on", channel=1, note=cps[0], velocity=58, time=delta))
        tick_cursor = bar_start
        for p in cps[1:]:
            harm_tr.append(Message("note_on", channel=1, note=p, velocity=54, time=0))
        harm_tr.append(Message("note_off", channel=1, note=cps[0], velocity=0, time=bar_ticks))
        tick_cursor += bar_ticks
        for p in cps[1:]:
            harm_tr.append(Message("note_off", channel=1, note=p, velocity=0, time=0))
    mid.tracks.append(harm_tr)

    bass_tr = MidiTrack()
    bass_tr.append(Message("program_change", channel=2, program=33, time=0))
    tick_cursor = 0
    for bar in range(bars):
        bar_start = bar * bar_ticks
        delta = max(0, bar_start - tick_cursor)
        deg = chord_degrees[bar] % 7
        triad = chords_all[deg]
        root_m = midi_pitch_from_pc(triad[0], 2)
        fifth_m = midi_pitch_from_pc(triad[2], 2)
        half = max(1, bar_ticks // 2)
        bass_tr.append(Message("note_on", channel=2, note=root_m, velocity=72, time=delta))
        tick_cursor = bar_start
        bass_tr.append(Message("note_off", channel=2, note=root_m, velocity=0, time=half))
        bass_tr.append(Message("note_on", channel=2, note=fifth_m, velocity=68, time=0))
        bass_tr.append(Message("note_off", channel=2, note=fifth_m, velocity=0, time=half))
        tick_cursor += bar_ticks
    mid.tracks.append(bass_tr)

    dest.parent.mkdir(parents=True, exist_ok=True)
    mid.save(dest)
    res.output_path = dest
    res.ok = True
    return res


def export_abc_from_midi(path: Path, dest: Path) -> bool:
    """MIDI → ABC 记谱（music21）。"""
    try:
        from music21 import converter, abc

        score = converter.parse(str(path))
        dest.parent.mkdir(parents=True, exist_ok=True)
        score.write("abc", fp=str(dest))
        return dest.is_file()
    except Exception as ex:
        logger.warning("abc export failed: %s", ex)
        return False
