"""人声/伴奏分离（Spleeter Python API 优先，CLI 兜底）。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def spleeter_available() -> bool:
    try:
        from spleeter.separator import Separator  # noqa: F401

        return True
    except ImportError:
        return bool(shutil.which("spleeter"))


def _subprocess_kw() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


def _collect_stems_from_dir(base: Path, mode: str) -> dict[str, Path]:
    out: dict[str, Path] = {}
    if not base.is_dir():
        return out
    if mode in ("2stems", "spleeter:2stems"):
        for name, key in (("vocals.wav", "vocals"), ("accompaniment.wav", "accompaniment")):
            p = base / name
            if p.is_file():
                out[key] = p
    elif mode in ("4stems", "spleeter:4stems"):
        for name, key in (
            ("vocals.wav", "vocals"),
            ("drums.wav", "drums"),
            ("bass.wav", "bass"),
            ("other.wav", "other"),
        ):
            p = base / name
            if p.is_file():
                out[key] = p
    else:
        for p in base.rglob("*.wav"):
            out[p.stem] = p
    return out


def _separate_via_python_api(
    input_path: Path,
    output_dir: Path,
    *,
    mode: str = "2stems",
) -> dict[str, Path]:
    from spleeter.separator import Separator

    preset = f"spleeter:{mode}" if not str(mode).startswith("spleeter:") else mode
    output_dir.mkdir(parents=True, exist_ok=True)
    separator = Separator(preset)
    # separate_to_file 写入 output_dir/<文件名无扩展>/
    separator.separate_to_file(str(input_path.resolve()), str(output_dir.resolve()))
    base = output_dir / input_path.stem
    out = _collect_stems_from_dir(base, mode)
    if not out:
        # 部分版本目录名不同，扫描一级子目录
        for sub in output_dir.iterdir():
            if sub.is_dir():
                found = _collect_stems_from_dir(sub, mode)
                if found:
                    out = found
                    break
    if not out:
        raise RuntimeError(f"spleeter API 未产出 wav：{output_dir}")
    return out


def _separate_via_cli(
    input_path: Path,
    output_dir: Path,
    *,
    mode: str = "2stems",
    timeout_sec: int = 600,
) -> dict[str, Path]:
    if not shutil.which("spleeter"):
        raise RuntimeError("未找到 spleeter 可执行文件")
    output_dir.mkdir(parents=True, exist_ok=True)
    preset = f"spleeter:{mode}" if not mode.startswith("spleeter:") else mode
    # Spleeter 2.x：FILES 为位置参数，不用 -i
    cmd = [
        "spleeter",
        "separate",
        "-p",
        preset,
        "-o",
        str(output_dir.resolve()),
        str(input_path.resolve()),
    ]
    r = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        **_subprocess_kw(),
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "")[:800]
        raise RuntimeError(f"spleeter CLI 失败 (rc={r.returncode}): {err}")
    base = output_dir / input_path.stem
    out = _collect_stems_from_dir(base, mode)
    if not out:
        raise RuntimeError(f"spleeter CLI 未产出 wav：{base}")
    return out


def separate_stems(
    input_path: Path,
    output_dir: Path,
    *,
    mode: str = "2stems",
    timeout_sec: int = 600,
) -> dict[str, Path]:
    """
    人声/伴奏分离。优先 Python API（与 Docker 内 tensorflow 一致），失败再试 CLI。
    """
    if not input_path.is_file():
        raise FileNotFoundError(str(input_path))
    if not spleeter_available():
        raise RuntimeError("未安装 spleeter（Docker 镜像应已包含）")

    norm_mode = mode.replace("spleeter:", "") if mode.startswith("spleeter:") else mode
    try:
        return _separate_via_python_api(input_path, output_dir, mode=norm_mode)
    except Exception as ex_api:
        logger.warning("spleeter API failed, try CLI: %s", ex_api)
        try:
            return _separate_via_cli(
                input_path, output_dir, mode=norm_mode, timeout_sec=timeout_sec
            )
        except Exception as ex_cli:
            raise RuntimeError(f"spleeter 分离失败：API={ex_api}; CLI={ex_cli}") from ex_cli


def merge_stem_wavs(
    paths: list[Path],
    dest: Path,
    *,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 300,
) -> bool:
    """将多轨 stem 混成一条伴奏 WAV。"""
    paths = [p for p in paths if p.is_file()]
    if not paths:
        return False
    if len(paths) == 1:
        shutil.copy2(paths[0], dest)
        return dest.is_file()
    ff = shutil.which(ffmpeg_bin) or ffmpeg_bin
    dest.parent.mkdir(parents=True, exist_ok=True)
    inputs: list[str] = []
    for p in paths:
        inputs.extend(["-i", str(p)])
    filt = "".join(f"[{i}:a]" for i in range(len(paths))) + f"amix=inputs={len(paths)}:duration=longest[a]"
    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        *inputs,
        "-filter_complex",
        filt,
        "-map",
        "[a]",
        str(dest),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, **_subprocess_kw())
        return r.returncode == 0 and dest.is_file()
    except (OSError, subprocess.TimeoutExpired):
        return False
