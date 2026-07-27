"""旋律：马尔可夫 + 和弦吸附 + 弱拍休止/连音；和声：模板 + DP；编曲：铺底 / 琶音 / 低音 / 鼓组(GM9) + swing + 段落转调。"""
from __future__ import annotations

import hashlib
import random
import time
from dataclasses import dataclass, field
from pathlib import Path

from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

from .algorithmic_melody import euclidean_drum_eighths, generate_motif_melody_eighths
from .compose_instruments import resolve_layer_programs
from .harmony import dp_refine_degrees
from .keys import degree_chords, midi_pitch_from_pc, parse_key, scale_midi_pitches
from .structure_plan import plan_sections


@dataclass(frozen=True)
class LayerPrograms:
    """GM program 号：旋律、铺底、分解伴奏、低音（各走独立 MIDI channel）。"""

    melody: int
    pad: int
    comp: int
    bass: int


@dataclass
class ComposeResult:
    path: Path
    bars: int
    ticks_per_beat: int
    section_plan: list[tuple[str, int]]
    chord_degrees: list[int]
    # 每小节累积半音转调（供 music21 按小节吸附）；与写入 MIDI 一致
    bar_transpose_semitones: list[int] = field(default_factory=list)


def _deg_distance(a: int, b: int) -> int:
    d = abs(a - b)
    return min(d, 7 - d)


def _build_transition_matrix(section_tag: str, emotion: str) -> list[list[float]]:
    """一阶马尔可夫：状态为调内音级索引 0..6，转移偏好级进。"""
    n = 7
    tag = section_tag.upper()
    contrast = tag in ("B", "CHORUS", "副歌", "CH")
    sad = emotion in ("sad", "忧伤", "melancholic", "blue")

    m: list[list[float]] = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            dist = _deg_distance(i, j)
            if dist == 0:
                w = 0.06
            elif dist == 1:
                w = 0.58
            elif dist == 2:
                w = 0.26
            else:
                w = 0.035
            if contrast:
                w *= 1.25 if dist >= 2 else 0.92
            if sad and dist >= 3:
                w *= 0.55
            # 主歌段略提高三度跳进占比，旋律更有「歌唱性」
            if not contrast and dist == 2:
                w *= 1.1
            m[i][j] = w
        s = sum(m[i])
        for j in range(n):
            m[i][j] /= s
    return m


def _sample_next_deg(cur: int, matrix: list[list[float]], rng: random.Random) -> int:
    row = matrix[cur % 7]
    r = rng.random()
    acc = 0.0
    for j, p in enumerate(row):
        acc += p
        if r <= acc:
            return j
    return 6


def _pick_midi_for_degree(
    deg: int,
    scale_pcs: list[int],
    scale_notes: list[int],
    last_pitch: int,
    rng: random.Random,
) -> int:
    pc = scale_pcs[deg % 7]
    candidates = [n for n in scale_notes if n % 12 == pc]
    if not candidates:
        return last_pitch
    best = min(candidates, key=lambda n: abs(n - last_pitch))
    if rng.random() < 0.08:
        alt = rng.choice(candidates)
        if abs(alt - last_pitch) <= 12:
            return alt
    return best


def _snap_to_chord_pcs(pitch: int, allowed: set[int], scale_notes: list[int], last_pitch: int) -> int:
    pc = pitch % 12
    if pc in allowed:
        return pitch
    candidates = [n for n in scale_notes if (n % 12) in allowed]
    if not candidates:
        return pitch
    return min(candidates, key=lambda n: abs(n - last_pitch))


def _nearest_in_scale(midi_n: int, scale_notes: list[int]) -> int:
    return min(scale_notes, key=lambda sn: abs(sn - midi_n))


def _weak_rest_probability(emotion: str) -> float:
    e = (emotion or "").lower()
    if e in ("calm", "安静", "轻柔", "gentle", "soft"):
        return 0.11
    if e in ("sad", "忧伤", "melancholic", "blue"):
        return 0.08
    if e in ("happy", "欢快", "bright", "energetic"):
        return 0.04
    return 0.06


def _section_energy_multiplier(section_tag: str) -> float:
    t = section_tag.upper()
    if t in ("B", "CHORUS", "CH") or "副歌" in section_tag:
        return 1.12
    if t in ("A", "VERSE", "主歌"):
        return 1.0
    return 1.04


def _build_melody_events(
    melody_pitches: list[int],
    section_at_eighth: list[str],
    emotion: str,
    rng: random.Random,
    eighths_per_bar: int,
) -> list[tuple[int | None, int]]:
    """
    将每格一音的序列变为 (音高或休止, 持续八分音个数) 事件列，总时值与输入等长。
    弱拍可休止；同音可合并为更长音（乐句感）。
    """
    n = len(melody_pitches)
    events: list[tuple[int | None, int]] = []
    rest_p = _weak_rest_probability(emotion)
    i = 0
    while i < n:
        pos = i % eighths_per_bar
        is_strong = pos in (0, 4)
        p = melody_pitches[i]

        sec = section_at_eighth[i] if i < len(section_at_eighth) else "A"
        rp = rest_p * (0.65 if _section_energy_multiplier(sec) > 1.08 else 1.0)
        if not is_strong and rng.random() < rp:
            events.append((None, 1))
            i += 1
            continue

        run = 1
        max_run = min(4, n - i)
        while run < max_run and melody_pitches[i + run] == p:
            run += 1
        while run > 1 and rng.random() < 0.24:
            run -= 1
        events.append((p, run))
        i += run

    return events


class _MelodyCursor:
    """按八分格子从 melody 事件流取当前音高（None=休止）。"""

    def __init__(self, events: list[tuple[int | None, int]]):
        self._ev = events
        self._ei = 0
        self._left = 0
        self._cur: int | None = None

    def _snapshot(self) -> tuple[int, int, int | None]:
        return (self._ei, self._left, self._cur)

    def _restore(self, s: tuple[int, int, int | None]) -> None:
        self._ei, self._left, self._cur = s

    def next_eighth_pitch(self) -> int | None:
        if self._left == 0:
            if self._ei >= len(self._ev):
                return None
            self._cur, self._left = self._ev[self._ei]
            self._ei += 1
        self._left -= 1
        return self._cur


def _melody_velocity(
    pitch: int | None,
    pos_in_bar: int,
    section_tag: str,
    emotion: str,
    rng: random.Random,
) -> int:
    if pitch is None:
        return 0
    sec_m = _section_energy_multiplier(section_tag)
    v = int(72 * sec_m)
    if pos_in_bar == 0:
        v += 14
    elif pos_in_bar == 4:
        v += 9
    elif pos_in_bar in (2, 6):
        v += 3
    v += rng.randint(-7, 7)
    e = (emotion or "").lower()
    if e in ("sad", "忧伤", "melancholic", "blue"):
        v -= 12
    if e in ("calm", "轻柔", "gentle", "安静"):
        v -= 6
    return max(34, min(120, v))


def _bass_note_for_beat(
    beat: int,
    root_m: int,
    fifth_m: int,
    harmony_style: str,
    rng: random.Random,
) -> int:
    st = (harmony_style or "pop").lower()
    if st == "jazz":
        return root_m if beat in (0, 2) else (fifth_m if rng.random() < 0.72 else root_m)
    if st in ("folk", "民谣"):
        return root_m if beat in (0, 3) else (fifth_m if rng.random() < 0.65 else root_m)
    return root_m if beat in (0, 2) else (fifth_m if rng.random() < 0.78 else root_m)


def _arp_pattern_for_bar(
    chord_pitches_hi: list[int],
    prev_last: int | None,
    rng: random.Random,
    harmony_style: str,
) -> tuple[int, ...]:
    r, t, f = chord_pitches_hi[0], chord_pitches_hi[1], chord_pitches_hi[2]
    pats: tuple[tuple[int, ...], ...] = (
        (r, f, t, f, r, f, t, f),
        (r, t, f, t, r, t, f, t),
        (t, r, f, r, t, r, f, r),
        (r, r, f, f, t, t, f, f),
    )
    st = (harmony_style or "pop").lower()
    if st == "classical":
        pats = ((r, t, f, t, r, t, f, t), (t, r, f, r, t, r, f, r))
    if st in ("folk", "民谣"):
        pats = ((r, f, r, f, t, f, t, f), (r, t, r, t, f, t, f, t))

    if prev_last is None:
        return pats[rng.randint(0, len(pats) - 1)]
    best = min(pats, key=lambda pat: abs(pat[0] - prev_last))
    if rng.random() < 0.22:
        return pats[rng.randint(0, len(pats) - 1)]
    return best


def _swing_shift_ticks(eighth: int, harmony_style: str, emotion: str) -> int:
    """八分音符摇摆：每拍内第一个八分略长、第二个略短（ticks）。"""
    st = (harmony_style or "pop").lower()
    em = (emotion or "").lower()
    cap = min(80, max(8, eighth // 2))
    if st == "classical":
        return 0
    if st == "jazz" or "爵士" in em:
        return min(eighth // 3, cap)
    if st in ("swing", "布鲁斯", "蓝调", "blues"):
        return min((eighth * 9) // 25, cap)
    if st in ("folk", "民谣"):
        return min(eighth // 7, cap // 2)
    return min(eighth // 10, cap // 3)


def _eighth_duration_ticks(hi: int, eighth: int, swing_shift: int) -> int:
    if swing_shift <= 0:
        return eighth
    return eighth + swing_shift if hi % 2 == 0 else eighth - swing_shift


def _bar_eighth_start_ticks(hi: int, eighth: int, swing_shift: int) -> int:
    t = 0
    for k in range(hi):
        t += _eighth_duration_ticks(k, eighth, swing_shift)
    return t


def _plan_bar_transpose(
    bars: int,
    eighths_per_bar: int,
    section_at_eighth: list[str],
    rng: random.Random,
) -> list[int]:
    """段落切换时迈半步转调，累积半音限制在 [-7, 7]。"""
    out = [0] * bars
    cum = 0
    for bar in range(bars):
        if bar > 0:
            cur = section_at_eighth[bar * eighths_per_bar]
            prev = section_at_eighth[(bar - 1) * eighths_per_bar]
            if cur != prev:
                step = rng.choice([0, 0, 7, -5, 5, -7, 2, -2])
                cum += step
                cum = max(-7, min(7, cum))
        out[bar] = cum
    return out


def _ensemble_use_drums(
    harmony_style: str, instruments: list[str], rng: random.Random
) -> bool:
    st = (harmony_style or "").lower()
    joined = " ".join(instruments).lower()
    if "无鼓" in joined or "no drum" in joined or "不要鼓" in joined:
        return False
    if st == "classical":
        return rng.random() < 0.2
    return True


def _drum_bar_to_messages(
    bar: int,
    bar_ticks: int,
    eighth: int,
    swing_shift: int,
    harmony_style: str,
    rng: random.Random,
    *,
    kick_pattern: list[bool] | None = None,
    snare_pattern: list[bool] | None = None,
) -> list[tuple[int, bool, int, int]]:
    """
    鼓组 GM 通道；返回 (绝对 tick, is_note_on, note, velocity)。
    is_note_on False 表示 note_off（velocity 忽略）。
    """
    base = bar * bar_ticks
    st = (harmony_style or "pop").lower()
    jazz = st == "jazz"
    out: list[tuple[int, bool, int, int]] = []
    for hi in range(8):
        st_rel = _bar_eighth_start_ticks(hi, eighth, swing_shift)
        T = base + st_rel
        d_hit = max(28, min(120, eighth // 5))
        if jazz and hi == 0 and rng.random() < 0.55:
            out.append((T, True, 51, 58 + rng.randint(-10, 10)))
            out.append((T + d_hit + 40, False, 51, 0))
        hh = 42 if rng.random() < 0.82 else 44
        v_hh = 46 + rng.randint(-14, 14) if hi % 2 == 0 else 36 + rng.randint(-12, 12)
        out.append((T, True, hh, max(28, min(100, v_hh))))
        out.append((T + d_hit, False, hh, 0))
        use_kick = kick_pattern[hi] if kick_pattern and hi < len(kick_pattern) else hi in (0, 4)
        use_snare = snare_pattern[hi] if snare_pattern and hi < len(snare_pattern) else hi in (2, 6)
        if not jazz:
            if use_kick and rng.random() < 0.92:
                vk = 100 + rng.randint(-14, 12)
                out.append((T, True, 36, vk))
                out.append((T + d_hit + 45, False, 36, 0))
            if use_snare:
                out.append((T, True, 38, 86 + rng.randint(-16, 14)))
                out.append((T + d_hit + 38, False, 38, 0))
        else:
            if hi in (2, 6) and rng.random() < 0.88:
                out.append((T, True, 38, 72 + rng.randint(-12, 12)))
                out.append((T + d_hit + 32, False, 38, 0))
            if hi in (0, 4) and rng.random() < 0.5:
                out.append((T, True, 36, 82 + rng.randint(-12, 10)))
                out.append((T + d_hit + 42, False, 36, 0))
    return out


def _flush_drum_messages_to_track(
    drum_track: MidiTrack, messages: list[tuple[int, bool, int, int]]
) -> None:
    """按绝对 tick 排序，写入 channel 9（GM 鼓）。"""
    messages.sort(key=lambda x: (x[0], not x[1]))
    prev = 0
    for abs_t, is_on, n, vel in messages:
        dt = max(0, abs_t - prev)
        if is_on:
            drum_track.append(
                Message("note_on", channel=9, note=n, velocity=vel, time=dt)
            )
        else:
            drum_track.append(
                Message("note_off", channel=9, note=n, velocity=0, time=dt)
            )
        prev = abs_t


def _apply_leap_rule(pitches: list[int], scale_notes: list[int]) -> None:
    """大跳进（≥6 半音）之后，下一音用反向级进落到最近调内音（架构 5.1 近似）。"""
    for i in range(1, len(pitches) - 1):
        a, b = pitches[i - 1], pitches[i]
        inter = b - a
        if abs(inter) < 6:
            continue
        up = inter > 0
        target = b + (-2 if up else 2)
        pitches[i + 1] = _nearest_in_scale(target, scale_notes)


def _layer_programs(instruments: list[str], harmony_style: str) -> LayerPrograms:
    """根据意图乐器与和声风格分配四层音色（乐队感）。"""
    joined = " ".join(instruments).lower()
    hm = (harmony_style or "pop").lower()

    # 旋律主奏
    mel = 0
    if any(k in joined for k in ("萨克斯", "sax")):
        mel = 65
    elif any(k in joined for k in ("铜管", "brass", "小号", "trumpet")):
        mel = 56
    elif any(k in joined for k in ("小提琴", "violin", "弦乐主奏")):
        mel = 40
    elif any(k in joined for k in ("长笛", "flute")):
        mel = 73
    elif "吉他" in joined or "guitar" in joined:
        mel = 25

    # 铺底：弦乐 / 合唱 / 铜管长音
    pad = 49  # strings ensemble
    if any(k in joined for k in ("弦", "string", "小提琴", "cello", "大提琴")):
        pad = 49
    elif any(k in joined for k in ("铜管", "brass")):
        pad = 61
    elif any(k in joined for k in ("合成", "synth", "pad", "铺底")):
        pad = 89
    elif hm in ("classical",):
        pad = 49
    elif hm in ("jazz",):
        pad = 17  # drawbar organ pad

    # 若主奏已是弦乐，铺底换成弱合成或竖琴，避免完全糊在一起
    if mel in (40, 48, 49) and pad == 49:
        pad = 91

    # 分解和弦层：吉他或电钢
    comp = 5  # electric piano 1
    if "吉他" in joined or "guitar" in joined:
        comp = 25
    elif hm in ("classical",):
        comp = 46  # harp arpeggio feel
    elif hm in ("folk",):
        comp = 22  # accordion

    # 低音
    bass = 33  # fingered bass
    if hm in ("classical", "folk"):
        bass = 32  # acoustic bass
    if any(k in joined for k in ("摇滚", "rock", "funk", "电贝", "bass guitar")):
        bass = 34

    return LayerPrograms(melody=mel, pad=pad, comp=comp, bass=bass)


def _instrument_programs_legacy(instruments: list[str]) -> tuple[int, int, int]:
    """旧版三轨：旋律、柱式和弦层、低音。"""
    joined = " ".join(instruments).lower()
    mel = 0
    acc = 48 if any(k in joined for k in ("弦", "string", "小提琴")) else 0
    if "吉他" in joined or "guitar" in joined:
        acc = 24
    if "萨克斯" in joined or "sax" in joined:
        mel = 65
    if "铜管" in joined or "brass" in joined:
        mel = 56
        acc = 56
    return mel, acc, 32


def compose_midi(
    *,
    output_path: Path,
    key: str,
    tempo_bpm: int,
    duration_seconds: int,
    emotion: str,
    structure: str,
    instruments: list[str],
    harmony_style: str = "pop",
    ensemble: bool = True,
    seed: int | None = None,
    user_text: str = "",
    style: str = "",
) -> ComposeResult:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    root_pc, scale_pcs, minor = parse_key(key)
    if seed is None:
        seed = int.from_bytes(
            hashlib.sha256(
                f"{key}|{tempo_bpm}|{emotion}|{time.time_ns()}|{user_text[:80]}".encode()
            ).digest()[:4],
            "big",
        ) & 0x7fffffff
    rng = random.Random(seed)

    ticks_per_beat = 480
    beats_per_bar = 4
    bpm = max(40, min(200, tempo_bpm))
    sec_per_beat = 60.0 / bpm
    target_beats = max(8, min(128, int(duration_seconds / sec_per_beat)))
    bars_down = max(2, target_beats // beats_per_bar)
    bars_up = max(2, (target_beats + beats_per_bar - 1) // beats_per_bar)
    dur_down = bars_down * beats_per_bar * sec_per_beat
    dur_up = bars_up * beats_per_bar * sec_per_beat
    bars = bars_down if abs(dur_down - duration_seconds) <= abs(dur_up - duration_seconds) else bars_up
    bars = min(bars, 64)

    sections = plan_sections(structure, bars)

    scale_notes = scale_midi_pitches(scale_pcs, 3, 6)
    chords_all = degree_chords(root_pc, minor)

    eighths_per_bar = 8
    total_eighths = bars * eighths_per_bar
    melody_pitches: list[int | None] = []

    # 段落映射：每个 eighth 属于哪一段（决定马尔可夫矩阵）
    section_at_eighth: list[str] = []
    for lab, nb in sections:
        section_at_eighth.extend([lab] * (nb * eighths_per_bar))
    if len(section_at_eighth) < total_eighths:
        section_at_eighth.extend([sections[-1][0]] * (total_eighths - len(section_at_eighth)))
    section_at_eighth = section_at_eighth[:total_eighths]

    cur_deg = rng.choice([0, 2, 4])
    last_pitch = rng.choice([n for n in scale_notes if 59 <= n <= 76])

    use_motif = True
    if use_motif:
        raw_melody = generate_motif_melody_eighths(
            total_eighths=total_eighths,
            eighths_per_bar=eighths_per_bar,
            section_at_eighth=section_at_eighth,
            scale_pcs=scale_pcs,
            scale_notes=scale_notes,
            emotion=emotion,
            style=style or harmony_style,
            rng=rng,
        )
        melody_pitches = list(raw_melody)
        for p in melody_pitches:
            if p is not None:
                last_pitch = p
    else:
        for ei in range(total_eighths):
            sec_tag = section_at_eighth[ei]
            tm = _build_transition_matrix(sec_tag, emotion)
            cur_deg = _sample_next_deg(cur_deg, tm, rng)
            nxt = _pick_midi_for_degree(cur_deg, scale_pcs, scale_notes, last_pitch, rng)
            melody_pitches.append(nxt)
            last_pitch = nxt

    drum_kick, drum_snare = euclidean_drum_eighths(8, harmony_style or "pop", rng)

    strong_pc_by_bar: list[list[int]] = []
    for bar in range(bars):
        i0 = bar * eighths_per_bar
        pcs = []
        for off in (0, 4):
            idx = i0 + off
            if idx < len(melody_pitches) and melody_pitches[idx] is not None:
                pcs.append(melody_pitches[idx] % 12)
        if not pcs and i0 < len(melody_pitches) and melody_pitches[i0] is not None:
            pcs = [melody_pitches[i0] % 12]
        strong_pc_by_bar.append(pcs or [scale_pcs[0]])

    piece_style = (style or harmony_style or "pop").lower()
    chord_template_style = (
        piece_style if piece_style in ("chinese", "folk", "jazz", "classical") else harmony_style
    )
    chord_degrees = dp_refine_degrees(
        bars=bars,
        style=chord_template_style,
        minor=minor,
        root_pc=root_pc,
        melody_strong_pc_per_bar=strong_pc_by_bar,
        rng=rng,
    )

    for bar in range(bars):
        tri = set(chords_all[chord_degrees[bar] % 7])
        i0 = bar * eighths_per_bar
        for off in (0, 4):
            idx = i0 + off
            if idx >= len(melody_pitches) or melody_pitches[idx] is None:
                continue
            prev_p = melody_pitches[idx - 1] if idx > 0 and melody_pitches[idx - 1] is not None else melody_pitches[idx]
            melody_pitches[idx] = _snap_to_chord_pcs(melody_pitches[idx], tri, scale_notes, prev_p)

    filled: list[int] = []
    lp = last_pitch
    for p in melody_pitches:
        if p is None:
            filled.append(lp)
        else:
            filled.append(p)
            lp = p
    melody_pitches = filled

    _apply_leap_rule(melody_pitches, scale_notes)

    bar_transpose = _plan_bar_transpose(
        bars, eighths_per_bar, section_at_eighth, rng
    )

    midi = MidiFile(ticks_per_beat=ticks_per_beat)
    meta = MidiTrack()
    meta.append(MetaMessage("set_tempo", tempo=bpm2tempo(bpm), time=0))
    meta.append(
        MetaMessage(
            "time_signature",
            numerator=4,
            denominator=4,
            clocks_per_click=24,
            notated_32nd_notes_per_beat=8,
            time=0,
        )
    )
    midi.tracks.append(meta)

    eighth = ticks_per_beat // 2
    swing_shift = _swing_shift_ticks(eighth, harmony_style, emotion)

    if ensemble:
        resolved = resolve_layer_programs(
            instruments,
            harmony_style,
            user_text=user_text,
            style=piece_style,
        )
        layers = LayerPrograms(
            melody=resolved.melody,
            pad=resolved.pad,
            comp=resolved.comp,
            bass=resolved.bass,
        )
        mel_track = MidiTrack()
        pad_track = MidiTrack()
        comp_track = MidiTrack()
        bass_track = MidiTrack()
        drum_track = MidiTrack()
        mel_track.append(Message("program_change", channel=0, program=layers.melody, time=0))
        pad_track.append(Message("program_change", channel=1, program=layers.pad, time=0))
        comp_track.append(Message("program_change", channel=2, program=layers.comp, time=0))
        bass_track.append(Message("program_change", channel=3, program=layers.bass, time=0))
        drum_track.append(Message("program_change", channel=9, program=0, time=0))

        melody_events = _build_melody_events(
            melody_pitches, section_at_eighth, emotion, rng, eighths_per_bar
        )
        mel_cursor = _MelodyCursor(melody_events)
        prev_comp_last: int | None = None
        mel_pending = 0
        use_drums = resolved.use_drums and _ensemble_use_drums(harmony_style, instruments, rng)
        drum_accum: list[tuple[int, bool, int, int]] = []

        for bar in range(bars):
            ts = bar_transpose[bar] if bar < len(bar_transpose) else 0
            deg = chord_degrees[bar] % 7
            triad = chords_all[deg]
            chord_pitches_hi = [
                midi_pitch_from_pc(triad[i], 4) + ts for i in range(3)
            ]
            chord_pitches_pad = [
                midi_pitch_from_pc(triad[i], 3) + ts for i in range(3)
            ]
            bass_root = midi_pitch_from_pc(triad[0], 2) + ts
            bass_fifth = midi_pitch_from_pc(triad[2], 2) + ts
            bar_ticks = beats_per_bar * ticks_per_beat

            gidx = bar * eighths_per_bar
            sec0 = section_at_eighth[gidx] if gidx < len(section_at_eighth) else "A"
            pad_vel = int((40 + rng.randint(-6, 6)) * _section_energy_multiplier(sec0))
            if emotion in ("sad", "忧伤", "melancholic", "blue"):
                pad_vel -= 8
            pad_vel = max(22, min(78, pad_vel))
            for i, p in enumerate(chord_pitches_pad):
                pad_track.append(
                    Message("note_on", channel=1, note=p, velocity=pad_vel, time=0 if i == 0 else 0)
                )
            pad_track.append(
                Message("note_off", channel=1, note=chord_pitches_pad[0], velocity=0, time=bar_ticks)
            )
            for p in chord_pitches_pad[1:]:
                pad_track.append(Message("note_off", channel=1, note=p, velocity=0, time=0))

            arp_pattern = _arp_pattern_for_bar(
                chord_pitches_hi, prev_comp_last, rng, harmony_style
            )
            prev_comp_last = arp_pattern[-1]
            for hi in range(eighths_per_bar):
                pit = arp_pattern[hi]
                d_hi = _eighth_duration_ticks(hi, eighth, swing_shift)
                cv = 52 + rng.randint(-8, 8)
                if hi in (0, 4):
                    cv += 6
                if emotion in ("sad", "忧伤", "melancholic", "blue"):
                    cv -= 8
                comp_track.append(
                    Message(
                        "note_on",
                        channel=2,
                        note=pit,
                        velocity=max(30, min(102, cv)),
                        time=0,
                    )
                )
                comp_track.append(Message("note_off", channel=2, note=pit, velocity=0, time=d_hi))

            for beat in range(beats_per_bar):
                bnote = _bass_note_for_beat(beat, bass_root, bass_fifth, harmony_style, rng)
                bv = int((74 + rng.randint(-10, 8)) * _section_energy_multiplier(sec0))
                bass_track.append(Message("note_on", channel=3, note=bnote, velocity=bv, time=0))
                bass_track.append(
                    Message("note_off", channel=3, note=bnote, velocity=0, time=ticks_per_beat)
                )

            pending = mel_pending
            hi = 0
            while hi < eighths_per_bar:
                g = bar * eighths_per_bar + hi
                pitch_m = mel_cursor.next_eighth_pitch()
                d0 = _eighth_duration_ticks(hi, eighth, swing_shift)
                sec_tag = section_at_eighth[g] if g < len(section_at_eighth) else "A"
                if pitch_m is None:
                    pending += d0
                    hi += 1
                    continue
                total_d = d0
                j = hi + 1
                while j < eighths_per_bar:
                    st = mel_cursor._snapshot()
                    pn = mel_cursor.next_eighth_pitch()
                    mel_cursor._restore(st)
                    if pn != pitch_m:
                        break
                    total_d += _eighth_duration_ticks(j, eighth, swing_shift)
                    j += 1
                for _ in range(j - hi - 1):
                    mel_cursor.next_eighth_pitch()
                vel_m = _melody_velocity(pitch_m, hi, sec_tag, emotion, rng)
                pm = pitch_m + ts
                mel_track.append(
                    Message(
                        "note_on",
                        channel=0,
                        note=pm,
                        velocity=vel_m,
                        time=pending,
                    )
                )
                mel_track.append(
                    Message("note_off", channel=0, note=pm, velocity=0, time=total_d)
                )
                pending = 0
                hi = j
            mel_pending = pending

            if use_drums:
                drum_accum.extend(
                    _drum_bar_to_messages(
                        bar,
                        bar_ticks,
                        eighth,
                        swing_shift,
                        harmony_style,
                        rng,
                        kick_pattern=drum_kick,
                        snare_pattern=drum_snare,
                    )
                )

        midi.tracks.append(mel_track)
        midi.tracks.append(pad_track)
        midi.tracks.append(comp_track)
        midi.tracks.append(bass_track)
        if use_drums and drum_accum:
            _flush_drum_messages_to_track(drum_track, drum_accum)
            midi.tracks.append(drum_track)
    else:
        mel_prog, acc_prog, bass_prog = _instrument_programs_legacy(instruments)
        mel_track = MidiTrack()
        chord_track = MidiTrack()
        bass_track = MidiTrack()
        mel_track.append(Message("program_change", channel=0, program=mel_prog, time=0))
        chord_track.append(Message("program_change", channel=1, program=acc_prog, time=0))
        bass_track.append(Message("program_change", channel=2, program=bass_prog, time=0))

        for bar in range(bars):
            deg = chord_degrees[bar] % 7
            triad = chords_all[deg]
            chord_pitches = [midi_pitch_from_pc(triad[i], 4) for i in range(3)]
            bass_note = midi_pitch_from_pc(triad[0], 2)
            bar_ticks = beats_per_bar * ticks_per_beat

            for i, p in enumerate(chord_pitches):
                chord_track.append(
                    Message("note_on", channel=1, note=p, velocity=52, time=0 if i == 0 else 0)
                )
            chord_track.append(
                Message("note_off", channel=1, note=chord_pitches[0], velocity=0, time=bar_ticks)
            )
            for p in chord_pitches[1:]:
                chord_track.append(Message("note_off", channel=1, note=p, velocity=0, time=0))

            for beat in range(beats_per_bar):
                bass_track.append(Message("note_on", channel=2, note=bass_note, velocity=78, time=0))
                bass_track.append(
                    Message("note_off", channel=2, note=bass_note, velocity=0, time=ticks_per_beat)
                )
                for _h in range(2):
                    idx = bar * eighths_per_bar + beat * 2 + _h
                    pitch = melody_pitches[idx]
                    vel = 72 + rng.randint(-12, 12)
                    if emotion in ("sad", "忧伤"):
                        vel -= 10
                    mel_track.append(
                        Message(
                            "note_on",
                            channel=0,
                            note=pitch,
                            velocity=max(28, min(120, vel)),
                            time=0,
                        )
                    )
                    mel_track.append(Message("note_off", channel=0, note=pitch, velocity=0, time=eighth))

        midi.tracks.append(mel_track)
        midi.tracks.append(chord_track)
        midi.tracks.append(bass_track)
    midi.save(str(output_path))
    return ComposeResult(
        path=output_path,
        bars=bars,
        ticks_per_beat=ticks_per_beat,
        section_plan=sections,
        chord_degrees=chord_degrees,
        bar_transpose_semitones=bar_transpose if ensemble else [0] * bars,
    )


def _seed_from_key(key: str, tempo: int, emotion: str) -> int:
    h = hashlib.sha256(f"{key}|{tempo}|{emotion}".encode()).digest()
    return int.from_bytes(h[:4], "big")
