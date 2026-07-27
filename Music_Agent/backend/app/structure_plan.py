"""曲式结构规划：根据 structure 与总小节数分配各段小节数（对齐架构「步骤2」）。"""
from __future__ import annotations

import re


def _labels_from_string(structure: str) -> list[str]:
    s = structure.strip()
    if not s:
        return ["A", "B", "A"]

    low = s.lower()
    if "主歌" in s and "副歌" in s:
        return ["verse", "chorus", "verse"]
    if "verse" in low and "chorus" in low:
        return ["verse", "chorus", "verse"]

    compact = re.sub(r"\s+", "", s)
    tok = re.split(r"[-–—]+", compact)
    tok = [t for t in tok if t]
    if len(tok) >= 2:
        return [t[:12] for t in tok]

    letters = re.findall(r"[A-Za-z]", compact)
    if letters:
        return [x.upper() for x in letters]

    return ["A", "B", "A"]


def plan_sections(structure: str, total_bars: int) -> list[tuple[str, int]]:
    """
    将「A-B-A」「AABA」「verse-chorus」等映射为 (段落标签, 小节数) 列表，
    所有段落小节数之和等于 total_bars（至少为 1）。
    """
    total_bars = max(1, int(total_bars))
    labels = _labels_from_string(structure)
    if len(labels) > total_bars:
        labels = labels[:total_bars]
    if not labels:
        labels = ["A"]
    n = len(labels)
    base = total_bars // n
    rem = total_bars % n
    parts: list[tuple[str, int]] = []
    for i, lab in enumerate(labels):
        b = base + (1 if i < rem else 0)
        parts.append((lab, max(1, b)))

    ssum = sum(b for _, b in parts)
    if ssum != total_bars:
        diff = total_bars - ssum
        last_lab, last_b = parts[-1]
        parts[-1] = (last_lab, max(1, last_b + diff))
    return parts
