"""乐理校验：音阶合法性 + 最近邻修正；可选小节化（music21）。"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from .keys import parse_key

logger = logging.getLogger(__name__)


@dataclass
class ValidationReport:
    ok: bool
    issues: list[str] = field(default_factory=list)
    notes_snapped: int = 0


def validate_and_repair(
    midi_in: Path,
    midi_out: Path,
    key: str,
    bar_transpose_semitones: list[int] | None = None,
    beats_per_bar: int = 4,
) -> ValidationReport:
    """
    将不在调式内的音高吸附到最近合法半音级（架构 5.1「音阶合法性」）。
    bar_transpose_semitones：与 compose_midi 一致时每小节累积移调，按小节用移位后的调式音阶吸附。
    解析失败时回退为复制原文件并标注 issues。
    """
    midi_out.parent.mkdir(parents=True, exist_ok=True)
    try:
        from music21 import converter, note
    except ImportError:
        import shutil

        shutil.copyfile(midi_in, midi_out)
        return ValidationReport(
            ok=True,
            issues=["未安装 music21，已跳过校验（请 pip install music21）"],
        )

    _, scale_pcs, _minor = parse_key(key)

    try:
        score = converter.parse(str(midi_in))
    except Exception as e:
        logger.exception("music21 parse")
        import shutil

        shutil.copyfile(midi_in, midi_out)
        return ValidationReport(ok=False, issues=[f"MIDI 解析失败: {e}"])

    parts = list(score.parts) if getattr(score, "parts", None) else []
    target = score
    if parts:

        def _non_drum_note_count(p) -> int:
            return sum(
                1
                for n in p.flatten().notes
                if isinstance(n, note.Note)
                and getattr(n, "channel", None) not in (9, 10)
            )

        best = max(parts, key=_non_drum_note_count)
        if _non_drum_note_count(best) > 0:
            target = best
        else:
            target = max(parts, key=lambda p: len(list(p.flatten().notes)))

    bt = bar_transpose_semitones or []

    def _allowed_pcs_for_bar(bar_i: int) -> set[int]:
        ts = bt[bar_i] if 0 <= bar_i < len(bt) else 0
        return {(pc + ts) % 12 for pc in scale_pcs}

    snapped = 0
    for el in target.flatten().notes:
        if not isinstance(el, note.Note):
            continue
        ch = getattr(el, "channel", None)
        if ch == 10:
            continue
        off = float(getattr(el, "offset", 0) or 0)
        bar_i = max(0, int(off // beats_per_bar))
        allowed_pc = _allowed_pcs_for_bar(bar_i)
        if el.pitch.pitchClass in allowed_pc:
            continue
        old = el.pitch.midi
        new_m = old
        best_d = 10**9
        for delta in range(-48, 49):
            cand = old + delta
            if cand % 12 in allowed_pc and abs(delta) < best_d:
                best_d = abs(delta)
                new_m = cand
        if best_d < 10**8:
            el.pitch.midi = int(new_m)
            snapped += 1

    try:
        target.makeMeasures(inPlace=True)
    except Exception as ex:
        logger.info("makeMeasures: %s", ex)

    try:
        score.write("midi", fp=str(midi_out))
    except Exception as e:
        import shutil

        shutil.copyfile(midi_in, midi_out)
        return ValidationReport(ok=False, issues=[f"写入修正 MIDI 失败: {e}"])

    issues: list[str] = []
    if snapped:
        issues.append(f"已将 {snapped} 个音高修正到最近调内音")
    return ValidationReport(ok=True, issues=issues, notes_snapped=snapped)
