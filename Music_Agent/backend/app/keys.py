"""调性解析与和弦音级（供旋律 / 和声 / 校验共用）。"""
from __future__ import annotations

_MAJOR = [0, 2, 4, 5, 7, 9, 11]
_NAT_MINOR = [0, 2, 3, 5, 7, 8, 10]

_NAME_TO_PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def parse_key(key_str: str) -> tuple[int, list[int], bool]:
    s = key_str.strip().lower().replace("调", "")
    minor = "小" in key_str or "minor" in s or "min" in s
    root_char = s[0] if s else "c"
    root = _NAME_TO_PC.get(root_char, 0)
    if "#" in key_str or "升" in key_str:
        root = (root + 1) % 12
    if "b" in s[1:3] or "降" in key_str:
        root = (root - 1) % 12
    scale = _NAT_MINOR if minor else _MAJOR
    tones = [(root + x) % 12 for x in scale]
    return root % 12, tones, minor


def degree_chords(root_pc: int, minor: bool) -> list[list[int]]:
    """七个自然三和弦的 pitch class（根音为调式主音）。"""
    if minor:
        rel = [[0, 3, 7], [2, 5, 10], [3, 7, 10], [5, 8, 0], [7, 10, 2], [8, 0, 3], [10, 2, 5]]
    else:
        rel = [[0, 4, 7], [2, 5, 9], [4, 7, 11], [5, 9, 0], [7, 11, 2], [9, 0, 4], [11, 2, 5]]
    return [[(root_pc + x) % 12 for x in triad] for triad in rel]


def midi_pitch_from_pc(pc: int, octave: int) -> int:
    base = 12 * (octave + 1)
    for off in range(12):
        if (base + off) % 12 == pc:
            return base + off
    return 60 + pc


def scale_midi_pitches(scale_pcs: list[int], octave_lo: int = 3, octave_hi: int = 6) -> list[int]:
    out: list[int] = []
    for oc in range(octave_lo, octave_hi + 1):
        for pc in scale_pcs:
            out.append(midi_pitch_from_pc(pc, oc))
    out.sort()
    return out
