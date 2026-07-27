"""MuseTalk 对口型（子进程调用官方 inference 脚本）。"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

from audio_util import prepare_subprocess_env

logger = logging.getLogger(__name__)

_REQUIRED_WEIGHTS = (
    "models/musetalkV15/unet.pth",
    "models/musetalkV15/musetalk.json",
    "models/sd-vae/diffusion_pytorch_model.bin",
    "models/whisper/pytorch_model.bin",
)


def _resolve_python() -> str:
    custom = os.environ.get("MUSETALK_PYTHON", "").strip()
    if custom and Path(custom).is_file():
        return custom
    return sys.executable


def musetalk_ready(musetalk_root: str) -> bool:
    root = Path(musetalk_root)
    if not (root / "scripts" / "inference.py").is_file():
        return False
    return all((root / p).is_file() for p in _REQUIRED_WEIGHTS)


def _ffmpeg_path(musetalk_root: Path) -> str:
    custom = os.environ.get("MUSETALK_FFMPEG_PATH", "").strip()
    if custom:
        return custom
    bundled = musetalk_root / "ffmpeg-master-latest-win64-gpl-shared" / "bin"
    if bundled.is_dir():
        return str(bundled)
    return "ffmpeg"


def _write_inference_config(
    *,
    video_path: Path,
    audio_path: Path,
    bbox_shift: int,
) -> Path:
    cfg = {
        "task_0": {
            "video_path": str(video_path),
            "audio_path": str(audio_path),
            "bbox_shift": bbox_shift,
        }
    }
    fd, name = tempfile.mkstemp(suffix=".yaml", prefix="musetalk_cfg_")
    os.close(fd)
    out = Path(name)
    out.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    return out


def generate_mp4(
    *,
    musetalk_root: str,
    face_path: Path,
    wav_path: Path,
    out_path: Path,
) -> None:
    root = Path(musetalk_root).resolve()
    if not musetalk_ready(str(root)):
        raise RuntimeError(
            f"MuseTalk 未就绪：需克隆 TMElyralab/MuseTalk 到 {root} 并下载 models/ 权重"
        )

    python_exe = _resolve_python()
    version = os.environ.get("MUSETALK_VERSION", "v15").strip() or "v15"
    if version in ("v15", "1.5"):
        unet_model = root / "models" / "musetalkV15" / "unet.pth"
        unet_config = root / "models" / "musetalkV15" / "musetalk.json"
        version_flag = "v15"
    else:
        unet_model = root / "models" / "musetalk" / "pytorch_model.bin"
        unet_config = root / "models" / "musetalk" / "musetalk.json"
        version_flag = "v1"

    bbox_shift = int(os.environ.get("MUSETALK_BBOX_SHIFT", "0"))
    result_dir = out_path.parent / f"_musetalk_{out_path.stem}"
    result_dir.mkdir(parents=True, exist_ok=True)

    cfg_path = _write_inference_config(
        video_path=face_path,
        audio_path=wav_path,
        bbox_shift=bbox_shift,
    )
    try:
        cmd = [
            python_exe,
            "-m",
            "scripts.inference",
            "--inference_config",
            str(cfg_path),
            "--result_dir",
            str(result_dir),
            "--unet_model_path",
            str(unet_model),
            "--unet_config",
            str(unet_config),
            "--version",
            version_flag,
            "--ffmpeg_path",
            _ffmpeg_path(root),
        ]
        if os.environ.get("MUSETALK_USE_FLOAT16", "true").lower() in ("1", "true", "yes"):
            cmd.append("--use_float16")

        logger.info("MuseTalk: %s", " ".join(cmd))
        env = os.environ.copy()
        env.update(prepare_subprocess_env())
        env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")

        proc = subprocess.run(
            cmd,
            cwd=str(root),
            env=env,
            capture_output=True,
            text=True,
            timeout=int(os.environ.get("MUSETALK_TIMEOUT_SEC", "1800")),
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "")[-800:]
            raise RuntimeError(f"MuseTalk 失败: {tail}")

        candidates = sorted(result_dir.rglob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            raise RuntimeError("MuseTalk 未生成 MP4")
        latest = candidates[0]
        out_path.write_bytes(latest.read_bytes())
        logger.info("MuseTalk 输出 %s -> %s", latest, out_path)
    finally:
        cfg_path.unlink(missing_ok=True)
