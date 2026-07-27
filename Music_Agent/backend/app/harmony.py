"""和声模板库 + 简易动态规划：按风格挑选每小节和弦级数，使强拍旋律音尽可能落在和弦音内。"""
from __future__ import annotations

import random
from typing import Sequence

# 罗马级数在七和弦体系下的索引：0=I, 1=ii ... 6=vii°
StyleKey = str


def _rotate(seq: Sequence[int], start: int) -> list[int]:
    if not seq:
        return []
    start %= len(seq)
    return list(seq[start:] + seq[:start])


def template_degrees(style: str, minor: bool) -> list[int]:
    """返回一小节循环使用的和弦级数序列（0..6）。"""
    st = (style or "pop").lower()
    if minor:
        if st == "jazz":
            return [1, 4, 0, 5]  # ii V i vi (简易爵士进行)
        if st == "classical":
            return [0, 3, 4, 0]
        return [0, 5, 3, 4]  # i VI iv V 近似
    # major
    if st == "jazz":
        return [1, 4, 0, 5]
    if st == "classical":
        return [0, 3, 4, 0]
    if st in ("folk", "民谣"):
        return [0, 3, 4, 5]
    if st in ("chinese", "中国风", "民族"):
        return [0, 2, 5, 3]  # 五声友好：I iii V IV
    return [0, 4, 5, 3]  # I V vi IV 流行


def init_progression(bars: int, style: str, minor: bool, rng: random.Random) -> list[int]:
    """先生成按模板重复的粗序列，长度 bars。"""
    tpl = template_degrees(style, minor)
    if not tpl:
        tpl = [0, 4, 5, 3]
    rot = rng.randint(0, len(tpl) - 1)
    cyc = _rotate(tpl, rot)
    return [cyc[i % len(cyc)] for i in range(bars)]


def triad_pitch_classes(root_degree: int, minor_key: bool, root_pc: int) -> set[int]:
    """大三/小三和弦的三个 pitch class。"""
    from .keys import degree_chords

    chords = degree_chords(root_pc, minor_key)
    deg = root_degree % 7
    return set(chords[deg])


def dp_refine_degrees(
    *,
    bars: int,
    style: str,
    minor: bool,
    root_pc: int,
    melody_strong_pc_per_bar: list[list[int]],
    rng: random.Random,
) -> list[int]:
    """
    动态规划：状态为前一小节选用的模板索引偏移，转移代价为「强拍音不在和弦内」的计数。
    melody_strong_pc_per_bar: 每小节若干强拍位置的 pitch class（0..11）。
    """
    tpl = template_degrees(style, minor)
    if bars <= 0 or not tpl:
        return init_progression(max(1, bars), style, minor, rng)

    ms = list(melody_strong_pc_per_bar)
    while len(ms) < bars:
        ms.append([])

    # 候选：旋转模板 + 少量相邻小节替换
    candidates: list[list[int]] = []
    for rot in range(len(tpl)):
        candidates.append(_rotate(tpl, rot))
    # 额外爵士 ii-V 局部
    if style.lower() == "jazz":
        candidates.append([1, 4, 0, 5])
        candidates.append([1, 4, 5, 0])

    best_deg: list[int] | None = None
    best_cost = 10**9

    for cand in candidates:
        seq = [cand[i % len(cand)] for i in range(bars)]
        cost = 0
        for bi in range(bars):
            tri = triad_pitch_classes(seq[bi], minor, root_pc)
            for pc in ms[bi]:
                if pc not in tri:
                    cost += 1
        if cost < best_cost:
            best_cost = cost
            best_deg = seq

    assert best_deg is not None
    return best_deg
