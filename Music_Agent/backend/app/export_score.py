"""乐谱导出：MusicXML（必选）；PDF 依赖本机 LilyPond / MuseScore 等 converter（可能不可用）。"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def export_notation(midi_path: Path, stem: str, out_dir: Path) -> dict[str, str | None]:
    """
    返回相对 api 路径的文件名：musicxml / pdf（pdf 失败则为 None）。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    mx = out_dir / f"{stem}.musicxml"
    pdf = out_dir / f"{stem}.pdf"
    out: dict[str, str | None] = {"musicxml": None, "pdf": None}

    try:
        from music21 import converter
    except ImportError:
        logger.warning("music21 未安装，无法导出乐谱")
        return out

    try:
        score = converter.parse(str(midi_path))
        score.write("musicxml", fp=str(mx))
        out["musicxml"] = mx.name
    except Exception as e:
        logger.warning("musicxml export failed: %s", e)
        return out

    try:
        score.write("pdf", fp=str(pdf))
        if pdf.is_file():
            out["pdf"] = pdf.name
    except Exception as e:
        logger.info("pdf export skipped (需要 LilyPond/MuseScore 等): %s", e)

    return out
