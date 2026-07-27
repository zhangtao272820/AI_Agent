"""重演绎成品：人声轨 + 新伴奏混音。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _subprocess_kw() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


def mix_vocal_and_instrumental(
    vocal_wav: Path,
    instrumental_wav: Path,
    output_wav: Path,
    *,
    vocal_gain_db: float = 0.0,
    instrumental_gain_db: float = -2.0,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 600,
) -> bool:
    if not vocal_wav.is_file() or not instrumental_wav.is_file():
        return False
    ff = shutil.which(ffmpeg_bin) or ffmpeg_bin
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    try:
        output_wav.unlink(missing_ok=True)
    except OSError:
        pass

    vg = float(vocal_gain_db)
    ig = float(instrumental_gain_db)
    af = (
        f"[0:a]volume={vg}dB[v];[1:a]volume={ig}dB[i];"
        f"[v][i]amix=inputs=2:duration=longest:dropout_transition=2,alimiter=limit=0.98"
    )
    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(vocal_wav.resolve()),
        "-i",
        str(instrumental_wav.resolve()),
        "-filter_complex",
        af,
        str(output_wav.resolve()),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, **_subprocess_kw())
        ok = r.returncode == 0 and output_wav.is_file() and output_wav.stat().st_size > 2000
        if not ok:
            logger.warning("mix failed rc=%s %s", r.returncode, (r.stderr or "")[:400])
        return ok
    except (OSError, subprocess.TimeoutExpired):
        return False


def mix_instrumental_hybrid(
    *,
    lead_wav: Path,
    output_wav: Path,
    drums_wav: Path | None = None,
    bass_wav: Path | None = None,
    bed_wav: Path | None = None,
    lead_gain_db: float = 0.0,
    drums_gain_db: float = -1.0,
    bass_gain_db: float = -2.5,
    bed_gain_db: float = -10.0,
    bed_filter: str = "light",
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 900,
) -> bool:
    """
    纯音乐混合：原曲鼓 + 贝斯 + 铺底 + 新渲染主旋律（FluidSynth）。
    保留原曲节奏与和声床，仅替换主旋律音色。
    """
    if not lead_wav.is_file():
        return False
    stems: list[tuple[Path, str]] = [(lead_wav, f"volume={float(lead_gain_db)}dB,highpass=f=90")]
    if drums_wav and drums_wav.is_file():
        stems.append((drums_wav, f"volume={float(drums_gain_db)}dB"))
    if bass_wav and bass_wav.is_file():
        stems.append((bass_wav, f"volume={float(bass_gain_db)}dB"))
    if bed_wav and bed_wav.is_file():
        bf = (bed_filter or "light").strip().lower()
        if bf == "highpass":
            bed_af = f"highpass=f=1600,volume={float(bed_gain_db)}dB,lowpass=f=12000"
        elif bf == "light":
            bed_af = (
                f"volume={float(bed_gain_db)}dB,lowpass=f=12000,"
                "acompressor=threshold=-18dB:ratio=1.2:attack=40:release=200"
            )
        else:
            bed_af = f"volume={float(bed_gain_db)}dB"
        stems.append((bed_wav, bed_af))
    if len(stems) < 2:
        return False

    ff = shutil.which(ffmpeg_bin) or ffmpeg_bin
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    try:
        output_wav.unlink(missing_ok=True)
    except OSError:
        pass

    inputs: list[str] = []
    vols: list[str] = []
    for i, (_p, filt) in enumerate(stems):
        inputs.extend(["-i", str(_p.resolve())])
        vols.append(f"[{i}:a]{filt}[s{i}]")
    mix_in = "".join(f"[s{i}]" for i in range(len(stems)))
    af = (
        ";".join(vols)
        + f";{mix_in}amix=inputs={len(stems)}:duration=longest:dropout_transition=2,"
        "alimiter=limit=0.98"
    )

    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        *inputs,
        "-filter_complex",
        af,
        str(output_wav.resolve()),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, **_subprocess_kw())
        ok = r.returncode == 0 and output_wav.is_file() and output_wav.stat().st_size > 2000
        if not ok:
            logger.warning("instrumental hybrid mix failed rc=%s %s", r.returncode, (r.stderr or "")[:400])
        return ok
    except (OSError, subprocess.TimeoutExpired):
        return False


def mix_anchor_remix(
    *,
    anchor_wav: Path,
    output_wav: Path,
    drums_wav: Path | None = None,
    bass_wav: Path | None = None,
    anchor_gain_db: float = 0.0,
    drums_gain_db: float = -3.0,
    bass_gain_db: float = -6.0,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 900,
) -> bool:
    """
    音频锚定重演绎：以原曲 other 分轨（经 DSP）为主旋律，叠原曲鼓/贝斯。
    不依赖 FluidSynth 主旋律，旋律可辨认性最佳。
    """
    if not anchor_wav.is_file():
        return False
    stems: list[tuple[Path, str]] = [
        (anchor_wav, f"volume={float(anchor_gain_db)}dB,highpass=f=80"),
    ]
    if drums_wav and drums_wav.is_file():
        stems.append(
            (
                drums_wav,
                f"volume={float(drums_gain_db)}dB,highpass=f=120,lowpass=f=12000",
            )
        )
    if bass_wav and bass_wav.is_file():
        stems.append((bass_wav, f"volume={float(bass_gain_db)}dB,lowpass=f=280"))
    if len(stems) < 1:
        return False

    ff = shutil.which(ffmpeg_bin) or ffmpeg_bin
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    try:
        output_wav.unlink(missing_ok=True)
    except OSError:
        pass

    if len(stems) == 1:
        af = f"[0:a]{stems[0][1]},alimiter=limit=0.98"
        cmd = [
            ff,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(anchor_wav.resolve()),
            "-filter_complex",
            af,
            str(output_wav.resolve()),
        ]
    else:
        inputs: list[str] = []
        vols: list[str] = []
        for i, (_p, filt) in enumerate(stems):
            inputs.extend(["-i", str(_p.resolve())])
            vols.append(f"[{i}:a]{filt}[s{i}]")
        mix_in = "".join(f"[s{i}]" for i in range(len(stems)))
        af = (
            ";".join(vols)
            + f";{mix_in}amix=inputs={len(stems)}:duration=longest:dropout_transition=2,"
            "alimiter=limit=0.98"
        )
        cmd = [
            ff,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            *inputs,
            "-filter_complex",
            af,
            str(output_wav.resolve()),
        ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, **_subprocess_kw())
        ok = r.returncode == 0 and output_wav.is_file() and output_wav.stat().st_size > 2000
        if not ok:
            logger.warning("anchor mix failed rc=%s %s", r.returncode, (r.stderr or "")[:400])
        return ok
    except (OSError, subprocess.TimeoutExpired):
        return False
