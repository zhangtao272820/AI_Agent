"""纯音乐重演绎：保留原曲分轨音频，用 DSP 重塑听感（不经过 MIDI 再合成）。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 目标主奏 → FFmpeg 滤镜链（叠加在基础链之后）
_CHARACTER_FILTERS: dict[str, str] = {
    "flute": (
        "equalizer=f=2800:width_type=h:width=1800:g=2.5,"
        "equalizer=f=400:width_type=h:width=500:g=-2,"
        "aecho=0.55:0.45:35|55:0.22"
    ),
    "violin": (
        "equalizer=f=1200:width_type=h:width=900:g=2,"
        "equalizer=f=3500:width_type=h:width=2000:g=1.5,"
        "aecho=0.5:0.4:25|40:0.18"
    ),
    "harp": (
        "equalizer=f=800:width_type=h:width=600:g=1.5,"
        "equalizer=f=5000:width_type=h:width=3000:g=2,"
        "aecho=0.65:0.5:50|80:0.28"
    ),
    "oboe": (
        "equalizer=f=1500:width_type=h:width=800:g=2.5,"
        "equalizer=f=6000:width_type=h:width=2500:g=-1,"
        "aecho=0.45:0.35:30|45:0.2"
    ),
    "cello": (
        "equalizer=f=250:width_type=h:width=200:g=2,"
        "equalizer=f=900:width_type=h:width=500:g=1,"
        "aecho=0.4:0.3:40|60:0.15"
    ),
    "strings": (
        "equalizer=f=600:width_type=h:width=500:g=1.5,"
        "equalizer=f=2200:width_type=h:width=1500:g=2,"
        "aecho=0.6:0.5:45|70:0.25"
    ),
    "piano": (
        "equalizer=f=1000:width_type=h:width=800:g=1,"
        "equalizer=f=4000:width_type=h:width=2500:g=-1,"
        "aecho=0.35:0.3:20|35:0.12"
    ),
}

_BASE_CHAIN = (
    "highpass=f=90,lowpass=f=15000,"
    "afftdn=nf=-22,"
    "acompressor=threshold=-22dB:ratio=2.2:attack=20:release=160:makeup=2,"
    "alimiter=limit=0.97"
)


def _subprocess_kw() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


def process_anchor_stem(
    src_wav: Path,
    dest_wav: Path,
    *,
    lead_instrument: str = "flute",
    source_instrument: str = "piano",
    gain_db: float = 0.0,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 600,
) -> dict[str, Any]:
    """
    对 Spleeter other 轨做清晰度增强 + 性格化 EQ/空间。
    保留原录音旋律与音色质感，避免 MIDI 再合成导致的「电子味」和旋律丢失。
    """
    if not src_wav.is_file():
        return {"ok": False, "error": "source missing"}

    lead = (lead_instrument or "flute").strip().lower()
    character = _CHARACTER_FILTERS.get(lead) or _CHARACTER_FILTERS["flute"]
    g = float(gain_db)
    af = f"{_BASE_CHAIN},{character},volume={g}dB"

    ff = shutil.which(ffmpeg_bin) or ffmpeg_bin
    dest_wav.parent.mkdir(parents=True, exist_ok=True)
    try:
        dest_wav.unlink(missing_ok=True)
    except OSError:
        pass

    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src_wav.resolve()),
        "-af",
        af,
        str(dest_wav.resolve()),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, **_subprocess_kw())
        ok = r.returncode == 0 and dest_wav.is_file() and dest_wav.stat().st_size > 2000
        if not ok:
            logger.warning("anchor stem process failed rc=%s %s", r.returncode, (r.stderr or "")[:300])
            return {"ok": False, "error": (r.stderr or "")[:200]}
        logger.info("anchor stem %s -> %s lead=%s src=%s", src_wav.name, dest_wav.name, lead, source_instrument)
        return {
            "ok": True,
            "lead_instrument": lead,
            "source_instrument": source_instrument,
            "strategy": "instrumental_anchor",
        }
    except (OSError, subprocess.TimeoutExpired) as ex:
        return {"ok": False, "error": str(ex)}
