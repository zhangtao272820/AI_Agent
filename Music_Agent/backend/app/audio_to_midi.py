"""音频 → MIDI（Basic Pitch CLI / Python 模块，可选）。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def basic_pitch_available() -> bool:
    if shutil.which("basic-pitch"):
        return True
    try:
        import basic_pitch  # noqa: F401

        return True
    except ImportError:
        return False


def _subprocess_kw() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


def audio_to_midi(
    wav_path: Path,
    output_midi: Path,
    *,
    timeout_sec: int = 600,
    onset_threshold: float | None = None,
    frame_threshold: float | None = None,
    minimum_note_length_ms: float | None = None,
) -> Path:
    """将 WAV 转为 MIDI，返回 output_midi 路径。"""
    if not wav_path.is_file():
        raise FileNotFoundError(str(wav_path))
    output_midi.parent.mkdir(parents=True, exist_ok=True)

    cli = shutil.which("basic-pitch")
    if cli:
        out_dir = output_midi.parent
        cmd = [cli, str(out_dir.resolve()), str(wav_path.resolve()), "--save-midi"]
        if onset_threshold is not None:
            cmd.extend(["--onset-threshold", str(onset_threshold)])
        if frame_threshold is not None:
            cmd.extend(["--frame-threshold", str(frame_threshold)])
        if minimum_note_length_ms is not None:
            cmd.extend(["--minimum-note-length", str(minimum_note_length_ms)])
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            **_subprocess_kw(),
        )
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "basic-pitch failed")[:600])
        candidates = sorted(out_dir.glob("*.mid"), key=lambda p: p.stat().st_mtime, reverse=True)
        candidates += sorted(out_dir.glob("*.midi"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            raise RuntimeError("basic-pitch 未生成 .mid 文件")
        if candidates[0].resolve() != output_midi.resolve():
            shutil.copy2(candidates[0], output_midi)
        return output_midi

    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except ImportError as e:
        raise RuntimeError(
            "未安装 basic-pitch（pip install basic-pitch 或安装 basic-pitch CLI）"
        ) from e

    kw: dict = {}
    if onset_threshold is not None:
        kw["onset_threshold"] = float(onset_threshold)
    if frame_threshold is not None:
        kw["frame_threshold"] = float(frame_threshold)
    if minimum_note_length_ms is not None:
        kw["minimum_note_length"] = float(minimum_note_length_ms)

    _, midi_data, _ = predict(str(wav_path), ICASSP_2022_MODEL_PATH, **kw)
    midi_data.write(str(output_midi))
    return output_midi


def audio_to_midi_bgm(wav_path: Path, output_midi: Path, **kwargs: object) -> Path:
    """BGM 转写：略提高 onset 门槛、延长最短音符，减少碎音与误检。"""
    return audio_to_midi(
        wav_path,
        output_midi,
        onset_threshold=0.55,
        frame_threshold=0.35,
        minimum_note_length_ms=110.0,
        **{k: v for k, v in kwargs.items() if k in ("timeout_sec",)},
    )


def ensure_wav_for_pitch(
    src: Path,
    dest_wav: Path,
    *,
    ffmpeg_bin: str = "ffmpeg",
    max_seconds: float | None = None,
    sample_rate: int = 44100,
) -> Path:
    """非 WAV 时用 ffmpeg 转 mono WAV（Basic Pitch 友好）。"""
    if src.suffix.lower() == ".wav" and src.resolve() != dest_wav.resolve():
        shutil.copy2(src, dest_wav)
        return dest_wav
    if src.suffix.lower() == ".wav":
        return src

    ff = shutil.which(ffmpeg_bin) or ffmpeg_bin
    dest_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if max_seconds and max_seconds > 0:
        cmd.extend(["-t", str(max_seconds)])
    cmd.extend(["-ac", "1", "-ar", str(int(sample_rate)), str(dest_wav)])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, **_subprocess_kw())
    if r.returncode != 0 or not dest_wav.is_file():
        raise RuntimeError(f"ffmpeg 转 WAV 失败: {(r.stderr or '')[:400]}")
    return dest_wav
