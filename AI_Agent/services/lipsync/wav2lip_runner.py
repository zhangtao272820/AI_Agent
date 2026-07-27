"""Wav2Lip 离线对口型（GTX 1050 2GB 友好参数）。"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

from audio_util import prepare_subprocess_env

logger = logging.getLogger(__name__)

_WAV2LIP_IMPORTS = ("librosa", "torch", "cv2", "tqdm", "scipy", "numpy")


def _resolve_python() -> str:
    """优先 WAV2LIP_PYTHON，否则用当前 lipsync 服务解释器。"""
    custom = os.environ.get("WAV2LIP_PYTHON", "").strip()
    if custom and Path(custom).is_file():
        return custom
    return sys.executable


def _python_import_check(python_exe: str) -> list[str]:
    code = (
        "import importlib.util as u; mods="
        + repr(list(_WAV2LIP_IMPORTS))
        + "; print(','.join(m for m in mods if u.find_spec(m) is None))"
    )
    proc = subprocess.run(
        [python_exe, "-c", code],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise RuntimeError(f"Wav2Lip Python 检查失败: {tail}")
    missing = [m for m in (proc.stdout or "").strip().split(",") if m]
    return missing


def wav2lip_ready(wav2lip_root: str) -> bool:
    root = Path(wav2lip_root)
    inf = root / "inference.py"
    ckpt = root / "checkpoints" / "wav2lip_gan.pth"
    if not ckpt.is_file():
        ckpt = root / "checkpoints" / "wav2lip.pth"
    if not (inf.is_file() and ckpt.is_file()):
        return False
    try:
        return not _python_import_check(_resolve_python())
    except Exception as ex:
        logger.warning("Wav2Lip 依赖未就绪: %s", ex)
        return False


def _ensure_wav2lip_deps() -> str:
    python_exe = _resolve_python()
    missing = _python_import_check(python_exe)
    if missing:
        raise RuntimeError(
            "Wav2Lip 依赖缺失: "
            + ", ".join(missing)
            + f"。请在 lipsync venv 执行: pip install -r requirements.txt"
            + (f"，或设置 WAV2LIP_PYTHON 指向已安装依赖的 Python" if python_exe == sys.executable else "")
        )
    return python_exe


def generate_mp4(
    *,
    wav2lip_root: str,
    face_path: Path,
    wav_path: Path,
    out_path: Path,
    resize_factor: int | None = None,
    static_face: bool = True,
) -> None:
    root = Path(wav2lip_root).resolve()
    inf = root / "inference.py"
    ckpt_gan = root / "checkpoints" / "wav2lip_gan.pth"
    ckpt = ckpt_gan if ckpt_gan.is_file() else root / "checkpoints" / "wav2lip.pth"
    if not inf.is_file() or not ckpt.is_file():
        raise RuntimeError(
            f"Wav2Lip 未就绪：需要 {inf} 与 checkpoints/wav2lip_gan.pth"
        )

    python_exe = _ensure_wav2lip_deps()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = out_path.with_suffix(".raw.mp4")

    if resize_factor is None:
        prefer_cuda = os.environ.get("LIPSYNC_PREFER_CUDA", "true").lower() in (
            "1",
            "true",
            "yes",
        )
        resize_factor = 2 if prefer_cuda else 3

    cmd = [
        python_exe,
        str(inf),
        "--checkpoint_path",
        str(ckpt),
        "--face",
        str(face_path),
        "--audio",
        str(wav_path),
        "--outfile",
        str(tmp_out),
        "--face_det_batch_size",
        "1",
        "--wav2lip_batch_size",
        "1",
        "--resize_factor",
        str(resize_factor),
        "--nosmooth",
    ]
    if static_face:
        cmd.extend(["--static", "True"])
    logger.info("Wav2Lip: %s", " ".join(cmd))
    env = prepare_subprocess_env()
    env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")
    if os.environ.get("LIPSYNC_PREFER_CUDA", "true").lower() in ("0", "false", "no"):
        env["CUDA_VISIBLE_DEVICES"] = ""
    proc = subprocess.run(
        cmd,
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=int(os.environ.get("WAV2LIP_TIMEOUT_SEC", "1800")),
        env=env,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-1200:]
        raise RuntimeError(f"Wav2Lip 失败: {tail}")
    if proc.stdout:
        for line in proc.stdout.splitlines()[-6:]:
            logger.info("Wav2Lip: %s", line.strip())

    if not tmp_out.is_file() or tmp_out.stat().st_size == 0:
        raise RuntimeError("Wav2Lip 未生成输出文件")

    if tmp_out != out_path:
        tmp_out.replace(out_path)
