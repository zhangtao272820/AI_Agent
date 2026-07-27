"""Demucs 分轨导出（仅 stems，不做重编配）。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

STEM_KEYS = ("vocals", "drums", "bass", "other")


@dataclass
class StemSeparateResult:
    ok: bool
    work_dir: Path | None = None
    stems: dict[str, Path] = field(default_factory=dict)
    model: str = "htdemucs"
    error: str = ""
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "model": self.model,
            "stems": {k: str(v.name) for k, v in self.stems.items()},
            "error": self.error,
            "warnings": self.warnings,
        }


def demucs_available() -> bool:
    if shutil.which("demucs"):
        return True
    try:
        import demucs  # noqa: F401

        return True
    except ImportError:
        return False


def _subprocess_kw() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


def separate_stems_demucs(
    src: Path,
    out_dir: Path,
    *,
    model: str = "htdemucs",
    ffmpeg_bin: str = "ffmpeg",
    max_seconds: float | None = None,
    two_stems: str | None = None,
) -> StemSeparateResult:
    """
    调用 Demucs CLI 分轨，输出 wav 到 out_dir/<model>/<trackname>/。
    two_stems: 可选 vocals|drums|bass|other 之一，仅输出「该轨 + 其余」两轨。
    """
    res = StemSeparateResult(ok=False, model=model)
    if not src.is_file():
        res.error = "源文件不存在"
        return res
    if not demucs_available():
        res.error = "未安装 demucs（Docker: INSTALL_DEMUCS=1）"
        return res

    work_input = src
    if max_seconds and max_seconds > 0:
        trimmed = out_dir / f"{src.stem}_trim.wav"
        try:
            trimmed.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-i",
                    str(src),
                    "-t",
                    f"{float(max_seconds):.3f}",
                    "-c:a",
                    "pcm_s16le",
                    str(trimmed),
                ],
                capture_output=True,
                text=True,
                timeout=180,
                **_subprocess_kw(),
            )
            if r.returncode == 0 and trimmed.is_file():
                work_input = trimmed
            else:
                res.warnings.append("时长裁剪失败，使用完整音频")
        except (OSError, subprocess.TimeoutExpired) as ex:
            res.warnings.append(f"裁剪跳过: {ex}")

    sep_root = out_dir / "demucs_out"
    sep_root.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "demucs",
        "-n",
        model,
        "-o",
        str(sep_root),
        str(work_input),
    ]
    if two_stems:
        cmd.insert(-1, "--two-stems")
        cmd.insert(-1, two_stems)

    logger.info("Demucs: %s", " ".join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900, **_subprocess_kw())
        if r.returncode != 0:
            res.error = (r.stderr or r.stdout or "demucs failed")[:800]
            return res
    except subprocess.TimeoutExpired:
        res.error = "demucs 超时（>900s）"
        return res
    except OSError as ex:
        res.error = str(ex)
        return res

    # demucs 输出：sep_root/model/trackname/{stem}.wav
    track_dirs = list((sep_root / model).glob("*")) if (sep_root / model).is_dir() else []
    stem_dir = None
    for d in track_dirs:
        if d.is_dir() and any((d / f"{k}.wav").is_file() for k in STEM_KEYS):
            stem_dir = d
            break
    if stem_dir is None:
        res.error = "未找到 demucs 输出目录"
        return res

    export_dir = out_dir / f"stems_{src.stem}_{model}"
    export_dir.mkdir(parents=True, exist_ok=True)
    for key in STEM_KEYS:
        p = stem_dir / f"{key}.wav"
        if p.is_file():
            dest = export_dir / f"{key}.wav"
            shutil.copy2(p, dest)
            res.stems[key] = dest
    if two_stems and len(res.stems) < 2:
        for p in stem_dir.glob("*.wav"):
            dest = export_dir / p.name
            shutil.copy2(p, dest)
            res.stems[p.stem] = dest

    if not res.stems:
        res.error = "分轨结果为空"
        return res

    res.work_dir = export_dir
    res.ok = True
    return res
