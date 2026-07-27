"""将 MIDI 渲染为立体声 WAV（FluidSynth + SF2）；可选 FFmpeg 转 MP3。"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path

from .config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# 与意图里的风格 key 一致，用于 FluidSynth 与 WAV 后处理
_ORCH_WAV_STYLES = frozenset({"orchestral", "chamber"})

# backend/ 目录（app 的上一级），兼容把 .sf2 误放在 backend/.data/soundfonts/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _subprocess_kw() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


def resolve_soundfont_sf2(soundfont_sf2_path: str) -> Path | None:
    """环境变量路径优先；否则在 Music_Agent/.data/soundfonts 与 backend/.data/soundfonts 中查找。"""
    raw = (soundfont_sf2_path or "").strip()
    if raw:
        p = Path(raw)
        return p if p.is_file() else None

    search_dirs = (
        PROJECT_ROOT / ".data" / "soundfonts",
        _BACKEND_ROOT / ".data" / "soundfonts",
    )
    preferred_names = (
        "GeneralUser-GS.sf2",
        "FluidR3_GM.sf2",
        "generaluser.sf2",
        "alex_gm.sf2",
    )
    for d in search_dirs:
        for name in preferred_names:
            cand = d / name
            if cand.is_file():
                return cand

    # 目录内任意 .sf2（按文件名排序取第一个，便于只放了一个自定义音色库时自动识别）
    for d in search_dirs:
        if not d.is_dir():
            continue
        found = sorted(d.glob("*.sf2"))
        if found:
            if len(found) > 1:
                logger.info(
                    "目录 %s 内有多个 .sf2，使用 %s（可在 SOUNDFONT_SF2_PATH 指定）",
                    d,
                    found[0].name,
                )
            return found[0]
    return None


def wav_flatten_dynamics(
    wav_path: Path,
    *,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 600,
    preset: str = "standard",
) -> bool:
    """
    对 FluidSynth 成片做轻度动态压平 + 限幅，减轻多声部叠置时的「忽大忽小、像断续」。
    preset=standard：较强压缩，适合多声部总谱；light：轻压，减轻旋律被「压进伴奏」与 pumping；
    release：发行向轻母带（高通 + 轻微临场感 EQ + 粘合压缩 + 限幅），配合 loudnorm -14 LUFS 类目标；
    off：跳过（保留 FluidSynth 原始动态，与浏览器 MIDI 试听更接近）。
    依赖 ffmpeg；失败时保留原 WAV。
    """
    wav_path = wav_path.resolve()
    if not wav_path.is_file() or wav_path.stat().st_size < 2000:
        return False
    ff = shutil.which((ffmpeg_bin or "ffmpeg").strip()) or ffmpeg_bin
    if not ff and Path(ffmpeg_bin).is_file():
        ff = str(Path(ffmpeg_bin))
    if not ff:
        return False
    mode = (preset or "standard").strip().lower()
    if mode == "off":
        return True
    tmp = wav_path.with_suffix(".dynflat.tmp.wav")
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
    # 避免 dynaudnorm 的抽吸感（易被听成断续）；用压缩 + 限幅稳定电平。
    if mode == "light":
        af = (
            "acompressor=threshold=-8dB:ratio=1.35:attack=40:release=320:makeup=0.4dB:knee=12dB,"
            "alimiter=limit=0.99:attack=25:release=120,aresample=44100"
        )
    elif mode == "release":
        af = (
            "highpass=f=22,"
            "equalizer=f=3000:width_type=o:width=2:g=0.85,"
            "acompressor=threshold=-15dB:ratio=1.55:attack=28:release=260:makeup=1.2dB:knee=14dB,"
            "alimiter=limit=0.992:attack=12:release=140,aresample=44100"
        )
    else:
        af = (
            "acompressor=threshold=-20dB:ratio=2.2:attack=25:release=220:makeup=3dB:knee=8dB,"
            "alimiter=limit=0.95:attack=5:release=50,aresample=44100"
        )
    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(wav_path),
        "-af",
        af,
        str(tmp),
    ]
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            **_subprocess_kw(),
        )
        if r.returncode != 0 or not tmp.is_file() or tmp.stat().st_size < 2000:
            logger.warning(
                "wav_flatten_dynamics ffmpeg rc=%s err=%s",
                r.returncode,
                (r.stderr or "")[:400],
            )
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return False
        wav_path.unlink(missing_ok=True)
        tmp.rename(wav_path)
        return True
    except FileNotFoundError:
        return False
    except Exception:
        logger.exception("wav_flatten_dynamics failed")
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return False


def wav_apply_loudnorm(
    wav_path: Path,
    *,
    integrated_lufs: float = -16.0,
    true_peak_db: float = -1.5,
    loudness_range: float = 11.0,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 600,
) -> bool:
    """
    EBU R128 单次 loudnorm，统一整曲感知响度，减轻段落间「忽高忽低」。
    需在 wav_flatten 之后调用（或 FluidSynth 直出后）。失败则保留输入 WAV。
    """
    wav_path = wav_path.resolve()
    if not wav_path.is_file() or wav_path.stat().st_size < 2000:
        return False
    ff = shutil.which((ffmpeg_bin or "ffmpeg").strip()) or ffmpeg_bin
    if not ff and Path(ffmpeg_bin).is_file():
        ff = str(Path(ffmpeg_bin))
    if not ff:
        return False
    tmp = wav_path.with_suffix(".loudnorm.tmp.wav")
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
    i = float(integrated_lufs)
    tp = float(true_peak_db)
    lra = float(loudness_range)
    af = f"loudnorm=I={i}:TP={tp}:LRA={lra}:print_format=summary"
    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(wav_path),
        "-af",
        af,
        str(tmp),
    ]
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            **_subprocess_kw(),
        )
        if r.returncode != 0 or not tmp.is_file() or tmp.stat().st_size < 2000:
            logger.warning(
                "wav_apply_loudnorm ffmpeg rc=%s err=%s",
                r.returncode,
                (r.stderr or "")[:500],
            )
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return False
        wav_path.unlink(missing_ok=True)
        tmp.rename(wav_path)
        return True
    except FileNotFoundError:
        return False
    except Exception:
        logger.exception("wav_apply_loudnorm failed")
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return False


def render_midi_to_wav(
    midi_path: Path,
    wav_path: Path,
    *,
    soundfont_path: Path,
    fluidsynth_bin: str = "fluidsynth",
    sample_rate: int = 44100,
    gain: float = 0.65,
    timeout_sec: int = 180,
    style_hint: str = "",
    wav_flatten: bool = True,
    wav_dyn_flat_preset: str = "standard",
    wav_loudnorm: bool = False,
    loudnorm_i: float = -16.0,
    loudnorm_tp: float = -1.5,
    loudnorm_lra: float = 11.0,
    ffmpeg_bin: str = "ffmpeg",
    post_steps_log: list[str] | None = None,
    use_reverb: bool | None = None,
) -> bool:
    if not midi_path.is_file() or not soundfont_path.is_file():
        return False
    wav_path = wav_path.resolve()
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        wav_path.unlink(missing_ok=True)
    except OSError:
        pass

    fs = shutil.which(fluidsynth_bin.strip() or "fluidsynth")
    if not fs and Path(fluidsynth_bin).is_file():
        fs = str(Path(fluidsynth_bin))
    if not fs:
        logger.warning("未找到 fluidsynth 可执行文件: %s", fluidsynth_bin)
        return False

    sh = (style_hint or "").strip().lower()
    g = float(gain)
    if sh in _ORCH_WAV_STYLES:
        g = min(0.68, g * 0.78)
    elif sh in ("electronic", "jazz"):
        g = min(0.74, g * 0.9)
    elif sh == "solo_piano":
        g = min(0.76, g * 0.92)

    reverb_on = use_reverb if use_reverb is not None else sh in _ORCH_WAV_STYLES

    cmd: list[str] = [
        fs,
        "-ni",
        "-g",
        str(round(g, 4)),
        "-r",
        str(int(sample_rate)),
    ]
    if reverb_on:
        cmd.extend(["-o", "synth.reverb.active=1", "-o", "synth.reverb.room-size=0.35"])
    else:
        cmd.extend(["-o", "synth.reverb.active=0"])
    cmd.extend(["-o", "synth.chorus.active=0"])
    cmd.extend(
        [
            "-F",
            str(wav_path),
            str(soundfont_path.resolve()),
            str(midi_path.resolve()),
        ]
    )
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            **_subprocess_kw(),
        )
        ok = r.returncode == 0 and wav_path.is_file() and wav_path.stat().st_size > 2000
        if not ok:
            logger.warning(
                "FluidSynth 退出码 %s；stderr 节选: %s",
                r.returncode,
                (r.stderr or r.stdout or "")[:800],
            )
            return False
        if wav_flatten and not wav_flatten_dynamics(
            wav_path,
            ffmpeg_bin=ffmpeg_bin,
            timeout_sec=timeout_sec,
            preset=wav_dyn_flat_preset,
        ):
            logger.info("WAV 动态压平跳过（ffmpeg 不可用或失败），保留 FluidSynth 原始输出")
        if wav_loudnorm:
            if wav_apply_loudnorm(
                wav_path,
                integrated_lufs=loudnorm_i,
                true_peak_db=loudnorm_tp,
                loudness_range=loudnorm_lra,
                ffmpeg_bin=ffmpeg_bin,
                timeout_sec=max(timeout_sec, 300),
            ):
                if post_steps_log is not None:
                    post_steps_log.append(
                        f"WAV 母带响度: loudnorm I={loudnorm_i} LUFS · TP={loudnorm_tp} dBFS · LRA={loudnorm_lra}"
                    )
            else:
                if post_steps_log is not None:
                    post_steps_log.append(
                        "WAV 母带响度: loudnorm 跳过（ffmpeg 失败或无 loudnorm 滤镜）"
                    )
                logger.info("WAV loudnorm 跳过，保留上一步 WAV")
        return True
    except FileNotFoundError:
        logger.warning("无法执行 FluidSynth，请安装并加入 PATH: %s", fs)
        return False
    except subprocess.TimeoutExpired:
        logger.warning("FluidSynth 渲染超时（%ss）", timeout_sec)
        return False
    except Exception:
        logger.exception("FluidSynth 渲染异常")
        return False


def wav_to_mp3(
    wav_path: Path,
    mp3_path: Path,
    *,
    ffmpeg_bin: str = "ffmpeg",
    timeout_sec: int = 300,
) -> bool:
    if not wav_path.is_file():
        return False
    mp3_path = mp3_path.resolve()
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        mp3_path.unlink(missing_ok=True)
    except OSError:
        pass

    ff = shutil.which((ffmpeg_bin or "ffmpeg").strip() or "ffmpeg")
    if not ff and Path(ffmpeg_bin).is_file():
        ff = str(Path(ffmpeg_bin))
    if not ff:
        logger.warning("未找到 ffmpeg，跳过 MP3")
        return False

    cmd = [
        ff,
        "-y",
        "-i",
        str(wav_path.resolve()),
        "-codec:a",
        "libmp3lame",
        "-qscale:a",
        "4",
        str(mp3_path),
    ]
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            **_subprocess_kw(),
        )
        ok = r.returncode == 0 and mp3_path.is_file() and mp3_path.stat().st_size > 500
        if not ok:
            logger.warning(
                "ffmpeg MP3 失败 rc=%s %s",
                r.returncode,
                (r.stderr or "")[:400],
            )
        return ok
    except FileNotFoundError:
        return False
    except Exception:
        logger.exception("ffmpeg MP3 异常")
        return False
