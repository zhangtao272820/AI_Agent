"""纯算法旋律：动机生成 + 段落发展（无 ML / GPU）。参考 L-system / 动机变奏思路。"""
from __future__ import annotations

import random
from typing import Sequence


def euclidean_hits(steps: int, pulses: int) -> list[bool]:
    """Bjorklund 欧几里得节奏分布（开源算法，常用于鼓型）。"""
    if steps <= 0:
        return []
    pulses = max(0, min(steps, int(pulses)))
    if pulses == 0:
        return [False] * steps
    pattern: list[list[bool]] = [[True]] * pulses + [[False]] * (steps - pulses)
    while len(pattern) > 1:
        first = pattern[0]
        second = pattern[1]
        merged = [first[i] + second[i] for i in range(min(len(first), len(second)))]
        rest = first[len(second) :] + second[len(first) :]
        pattern = [merged] + rest[1:]
    flat: list[bool] = []
    for group in pattern:
        flat.extend(group)
    return flat[:steps]


def _deg_to_pitch(
    deg: int,
    scale_pcs: list[int],
    scale_notes: list[int],
    octave_hint: int,
    last_pitch: int,
) -> int:
    pc = scale_pcs[deg % 7]
    candidates = [n for n in scale_notes if n % 12 == pc and abs(n - last_pitch) <= 14]
    if not candidates:
        candidates = [n for n in scale_notes if n % 12 == pc]
    if not candidates:
        return last_pitch
    target = 12 * (octave_hint + 1) + pc
    return min(candidates, key=lambda n: abs(n - target))


def _make_motif(
    rng: random.Random,
    scale_pcs: list[int],
    scale_notes: list[int],
    emotion: str,
    style: str = "",
) -> list[tuple[int, int]]:
    """(degree, duration_eighths) 动机，4～8 个音。"""
    em = (emotion or "").lower()
    st = (style or "").lower()
    length = rng.randint(4, 7)
    motif: list[tuple[int, int]] = []
    pent_deg = [0, 2, 4, 5, 6]
    if st in ("chinese", "folk", "中国风"):
        cur = rng.choice(pent_deg)
    else:
        cur = rng.choice([0, 2, 4, 5])
    last = _deg_to_pitch(cur, scale_pcs, scale_notes, 5, 67)
    for _ in range(length):
        if st in ("chinese", "folk", "中国风"):
            step = rng.choice([-1, 0, 1])
            idx = pent_deg.index(cur) if cur in pent_deg else rng.randint(0, len(pent_deg) - 1)
            cur = pent_deg[(idx + step) % len(pent_deg)]
        else:
            step = rng.choice([-1, 0, 1, 2] if em in ("happy", "energetic", "欢快") else [-2, -1, 0, 1])
            cur = max(0, min(6, cur + step))
        dur = rng.choice([1, 1, 1, 2] if em in ("calm", "sad", "安静", "忧伤") else [1, 1, 2, 2])
        last = _deg_to_pitch(cur, scale_pcs, scale_notes, 5, last)
        motif.append((cur, dur))
    return motif


def _develop_motif(
    motif: list[tuple[int, int]],
    mode: str,
    rng: random.Random,
) -> list[tuple[int, int]]:
    """段落变奏：repeat / sequence_up / invert / sparse。"""
    m = mode.lower()
    if m in ("b", "chorus", "ch", "副歌", "verse", "主歌"):
        mode = "sequence_up" if m in ("b", "chorus", "ch", "副歌") else "repeat"
    if mode == "repeat":
        return list(motif)
    if mode == "sequence_up":
        return [(min(6, d + 1), dur) for d, dur in motif]
    if mode == "sequence_down":
        return [(max(0, d - 1), dur) for d, dur in motif]
    if mode == "invert":
        mid = sum(d for d, _ in motif) // max(1, len(motif))
        return [(max(0, min(6, mid - (d - mid))), dur) for d, dur in motif]
    if mode == "sparse":
        return [(d, dur + 1) for i, (d, dur) in enumerate(motif) if i % 2 == 0]
    if mode == "dense":
        out: list[tuple[int, int]] = []
        for d, dur in motif:
            out.append((d, 1))
            if rng.random() < 0.45:
                out.append((max(0, min(6, d + rng.choice([-1, 1]))), 1))
        return out
    return list(motif)


def _section_develop_mode(section_tag: str, bar_in_section: int, total_bars_sec: int) -> str:
    t = section_tag.upper()
    if t in ("B", "CHORUS", "CH", "副歌"):
        return "dense" if bar_in_section >= total_bars_sec // 2 else "sequence_up"
    if t in ("A'", "A2", "CODA", "OUTRO"):
        return "sparse"
    if bar_in_section == 0:
        return "repeat"
    return "sequence_up" if bar_in_section % 2 == 1 else "invert"


def generate_motif_melody_eighths(
    *,
    total_eighths: int,
    eighths_per_bar: int,
    section_at_eighth: list[str],
    scale_pcs: list[int],
    scale_notes: list[int],
    emotion: str,
    style: str = "",
    rng: random.Random,
) -> list[int | None]:
    """
    按小节展开动机，输出每八分一格的音高（None=休止）。
    比纯马尔可夫更有乐句与重复感。
    """
    motif = _make_motif(rng, scale_pcs, scale_notes, emotion, style)
    alt_motif = _develop_motif(motif, "sequence_up", rng)
    third_motif = _develop_motif(motif, "invert", rng)

    pitches: list[int | None] = []
    last_pitch = _deg_to_pitch(motif[0][0], scale_pcs, scale_notes, 5, 67)

    bar = 0
    while len(pitches) < total_eighths:
        sec = section_at_eighth[bar * eighths_per_bar] if bar * eighths_per_bar < len(section_at_eighth) else "A"
        sec_bars = 0
        b0 = bar
        while b0 < len(section_at_eighth) // eighths_per_bar:
            if section_at_eighth[b0 * eighths_per_bar] != sec:
                break
            sec_bars += 1
            b0 += 1
        bar_in_sec = bar - (b0 - sec_bars)
        dev = _section_develop_mode(sec, bar_in_sec, max(1, sec_bars))
        if dev in ("sequence_up", "invert") and rng.random() < 0.5:
            pool = alt_motif if dev == "sequence_up" else third_motif
            use = pool
        else:
            use = motif
        developed = _develop_motif(use, dev, rng)

        pos_in_bar = 0
        mi = 0
        while pos_in_bar < eighths_per_bar and len(pitches) < total_eighths:
            deg, dur = developed[mi % len(developed)]
            mi += 1
            rest_p = 0.07 if emotion in ("calm", "sad", "安静", "忧伤") else 0.03
            if pos_in_bar not in (0, 4) and rng.random() < rest_p:
                pitches.append(None)
                pos_in_bar += 1
                continue
            last_pitch = _deg_to_pitch(deg, scale_pcs, scale_notes, 5, last_pitch)
            for _ in range(min(dur, eighths_per_bar - pos_in_bar)):
                if len(pitches) >= total_eighths:
                    break
                pitches.append(last_pitch)
                pos_in_bar += 1
            if pos_in_bar >= eighths_per_bar:
                break
        bar += 1

    while len(pitches) < total_eighths:
        pitches.append(None)
    return pitches[:total_eighths]


def euclidean_drum_eighths(steps: int, style: str, rng: random.Random) -> tuple[list[bool], list[bool]]:
    """返回 (kick 网格, snare 网格) 各 steps 个八分。"""
    st = (style or "pop").lower()
    if st == "jazz":
        kick = euclidean_hits(steps, max(2, steps // 4))
        snare = [i % 4 == 2 for i in range(steps)]
    elif st == "classical":
        kick = [i == 0 for i in range(steps)]
        snare = [False] * steps
    elif st in ("folk", "民谣"):
        kick = euclidean_hits(steps, max(2, steps // 3))
        snare = [i % 4 == 2 for i in range(steps)]
    else:
        kick = euclidean_hits(steps, max(3, steps // 2))
        snare = [i % 4 == 2 or (i % 8 == 6 and rng.random() < 0.4) for i in range(steps)]
    return kick, snare
