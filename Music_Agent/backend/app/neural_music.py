"""MusicGen 神经音频生成：适配低显存 GPU（如 GTX 1050 2GB），CUDA 不可用时快速回退。"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_model: Any = None
_processor: Any = None
_runtime_device: str = "cpu"
_runtime_dtype: Any = None
_cuda_probe_cache: bool | None = None

ComposeBackend = Literal["rule", "neural", "auto"]


@dataclass
class NeuralGenerateResult:
    ok: bool
    path: Path | None = None
    backend: str = "neural"
    device: str = "cpu"
    error: str = ""
    duration_seconds: float = 0.0
    prompt: str = ""


def is_neural_available() -> bool:
    """依赖是否已安装（不加载模型）。"""
    try:
        import torch  # noqa: F401
        from transformers import MusicgenForConditionalGeneration  # noqa: F401

        return True
    except ImportError:
        return False


def _cuda_ready() -> bool:
    """实测 CUDA 是否可用（驱动与 PyTorch CUDA 版本须匹配）。"""
    global _cuda_probe_cache
    if _cuda_probe_cache is not None:
        return _cuda_probe_cache
    try:
        import torch

        if not torch.cuda.is_available():
            _cuda_probe_cache = False
            return False
        torch.zeros(1, device="cuda")
        _cuda_probe_cache = True
        return True
    except Exception as ex:
        logger.warning("CUDA 探测失败（将不用 GPU MusicGen）: %s", ex)
        _cuda_probe_cache = False
        return False


def resolve_compose_backend(settings: Any) -> ComposeBackend:
    raw = str(getattr(settings, "compose_backend", "auto") or "auto").strip().lower()
    if raw not in ("rule", "neural", "auto"):
        raw = "auto"
    if raw == "auto":
        if getattr(settings, "neural_music_enabled", True) and is_neural_available():
            return "neural"
        return "rule"
    if raw == "neural" and not is_neural_available():
        logger.warning("compose_backend=neural 但未安装 torch/transformers，回退 rule")
        return "rule"
    return raw  # type: ignore[return-value]


def should_use_neural_generation(settings: Any) -> tuple[bool, str]:
    """是否应走 MusicGen（CUDA 不可且禁止 CPU 回退时返回 False）。"""
    if not getattr(settings, "neural_music_enabled", True) or not is_neural_available():
        return False, "neural disabled or deps missing"
    pref = str(getattr(settings, "neural_device", "auto") or "auto").strip().lower()
    cpu_ok = bool(getattr(settings, "neural_cpu_fallback", False))
    if pref == "cpu" or (pref == "auto" and not _cuda_ready() and cpu_ok):
        return True, "cpu"
    if pref in ("auto", "cuda") and _cuda_ready():
        return True, "cuda"
    if pref == "cuda" and not _cuda_ready():
        return False, "CUDA 不可用（PyTorch CUDA 版本与宿主驱动不匹配？请重建 cu124 镜像）"
    if not cpu_ok:
        return False, "CUDA 不可用且 NEURAL_CPU_FALLBACK=false，跳过 MusicGen 避免长时间阻塞"
    return True, "cpu"


def build_musicgen_prompt(
    *,
    emotion: str = "calm",
    style: str = "pop",
    instruments: list[str] | None = None,
    tempo_bpm: int = 100,
    harmony_style: str = "pop",
    user_prompt: str = "",
    instrumental: bool = True,
) -> str:
    """将结构化意图转为 MusicGen 英文 prompt。"""
    instr = ", ".join(instruments or ["piano", "strings"])
    mood = (emotion or "calm").strip()
    st = (style or harmony_style or "pop").strip()
    base = (
        f"{mood} {st} background music, {tempo_bpm} bpm, "
        f"featuring {instr}, rich arrangement, dynamic rhythm, professional mix"
    )
    if instrumental:
        base += ", instrumental, no vocals"
    up = (user_prompt or "").strip()
    if up:
        return f"{up[:220]}. {base}"
    return base


def _pick_device(settings: Any) -> tuple[str, Any]:
    import torch

    pref = str(getattr(settings, "neural_device", "auto") or "auto").strip().lower()
    fp16 = bool(getattr(settings, "neural_fp16", True))
    if pref == "cpu":
        return "cpu", torch.float32
    if _cuda_ready():
        return "cuda", torch.float16 if fp16 else torch.float32
    if pref == "cuda":
        logger.warning("NEURAL_DEVICE=cuda 但 CUDA 不可用，使用 CPU")
    return "cpu", torch.float32


def _effective_duration(requested: int, device: str, settings: Any) -> int:
    req = max(5, min(60, int(requested)))
    if device == "cuda":
        cap = int(getattr(settings, "neural_max_duration_gpu", 12))
    else:
        cap = int(getattr(settings, "neural_max_duration_cpu", 15))
    return max(5, min(req, cap))


def _duration_to_max_new_tokens(duration_sec: float, settings: Any) -> int:
    cap = int(getattr(settings, "neural_max_new_tokens", 768))
    est = max(128, min(cap, int(duration_sec * 50) + 32))
    return est


def _unload_model() -> None:
    global _model, _processor, _runtime_device, _runtime_dtype
    _model = None
    _processor = None
    _runtime_device = "cpu"
    _runtime_dtype = None
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def _load_model(settings: Any, *, force_device: str | None = None) -> tuple[Any, Any, str]:
    global _model, _processor, _runtime_device, _runtime_dtype

    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    model_id = str(getattr(settings, "neural_model_id", "facebook/musicgen-small") or "facebook/musicgen-small")

    with _lock:
        device, dtype = _pick_device(settings)
        if force_device:
            device = force_device
            dtype = torch.float32 if device == "cpu" else dtype

        if _model is not None and _processor is not None and _runtime_device == device:
            return _model, _processor, device

        _unload_model()
        logger.info("加载 MusicGen: %s device=%s dtype=%s", model_id, device, dtype)
        _processor = AutoProcessor.from_pretrained(model_id)
        _model = MusicgenForConditionalGeneration.from_pretrained(
            model_id,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        _model.to(device)
        _model.eval()
        _runtime_device = device
        _runtime_dtype = dtype
        return _model, _processor, device


def warmup_neural_model(settings: Any) -> dict[str, Any]:
    """启动时预加载模型，避免首次作曲长时间卡在 neural_generate。"""
    use, reason = should_use_neural_generation(settings)
    if not use:
        return {"warmed": False, "reason": reason}
    device, _ = _pick_device(settings)
    if device != "cuda":
        return {"warmed": False, "reason": reason, "device": device}
    try:
        _load_model(settings)
        return {"warmed": True, "device": device, "cuda": _cuda_ready()}
    except Exception as ex:
        logger.exception("MusicGen warmup failed")
        return {"warmed": False, "error": str(ex)}


def _write_wav(path: Path, audio_values: Any, sample_rate: int) -> None:
    import numpy as np
    from scipy.io import wavfile

    path.parent.mkdir(parents=True, exist_ok=True)
    arr = audio_values
    if hasattr(arr, "detach"):
        arr = arr.detach().cpu().numpy()
    arr = np.asarray(arr, dtype=np.float32).squeeze()
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    if peak > 1e-6:
        arr = arr / peak * 0.95
    pcm = (arr * 32767.0).clip(-32768, 32767).astype(np.int16)
    wavfile.write(str(path), sample_rate, pcm)


def _resample_to_44100(src: Path, dst: Path, ffmpeg_bin: str) -> bool:
    import subprocess

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(src),
        "-ar",
        "44100",
        "-ac",
        "2",
        str(dst),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        return dst.is_file()
    except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired) as ex:
        logger.warning("ffmpeg resample failed: %s", ex)
        return False


def _generate_once(
    settings: Any,
    *,
    prompt: str,
    duration_sec: int,
    seed: int | None,
    device: str,
) -> tuple[Any, int]:
    import torch

    model, processor, _ = _load_model(settings, force_device=device)
    max_new_tokens = _duration_to_max_new_tokens(duration_sec, settings)
    guidance = float(getattr(settings, "neural_guidance_scale", 3.0))

    inputs = processor(text=[prompt], padding=True, return_tensors="pt")
    inputs = {k: v.to(_runtime_device) for k, v in inputs.items()}

    gen_kw: dict[str, Any] = {
        "max_new_tokens": max_new_tokens,
        "do_sample": True,
        "guidance_scale": guidance,
    }
    if seed is not None:
        gen_kw["generator"] = torch.Generator(device=_runtime_device).manual_seed(int(seed))

    logger.info(
        "MusicGen generate device=%s duration=%ss max_new_tokens=%s",
        _runtime_device,
        duration_sec,
        max_new_tokens,
    )
    with torch.inference_mode():
        audio_values = model.generate(**inputs, **gen_kw)

    sample_rate = 32000
    enc_cfg = getattr(model.config, "audio_encoder", None)
    if enc_cfg is not None and getattr(enc_cfg, "sampling_rate", None):
        sample_rate = int(enc_cfg.sampling_rate)
    return audio_values[0, 0], sample_rate


def generate_neural_wav(
    settings: Any,
    *,
    output_path: Path,
    prompt: str,
    duration_seconds: int,
    seed: int | None = None,
) -> NeuralGenerateResult:
    """
    生成 WAV。GTX 1050 2GB：GPU FP16 ≤12s；默认禁止 CPU 回退（避免卡死）。
    """
    if not is_neural_available():
        return NeuralGenerateResult(ok=False, error="未安装 torch/transformers，见 requirements-neural.txt")

    use, reason = should_use_neural_generation(settings)
    if not use:
        return NeuralGenerateResult(ok=False, error=reason, prompt=prompt)

    prompt = (prompt or "instrumental background music").strip()[:500]
    device, _ = _pick_device(settings)
    dur = _effective_duration(duration_seconds, device, settings)
    cpu_fallback = bool(getattr(settings, "neural_cpu_fallback", False))

    try:
        audio, sample_rate = _generate_once(
            settings, prompt=prompt, duration_sec=dur, seed=seed, device=device
        )
    except RuntimeError as ex:
        msg = str(ex).lower()
        if device == "cuda" and cpu_fallback and ("out of memory" in msg or "cuda" in msg):
            logger.warning("GPU OOM，回退 CPU 重试: %s", ex)
            _unload_model()
            dur = _effective_duration(duration_seconds, "cpu", settings)
            try:
                audio, sample_rate = _generate_once(
                    settings, prompt=prompt, duration_sec=dur, seed=seed, device="cpu"
                )
                device = "cpu"
            except Exception as ex2:
                return NeuralGenerateResult(ok=False, error=str(ex2), prompt=prompt, device="cpu")
        else:
            return NeuralGenerateResult(ok=False, error=str(ex), prompt=prompt, device=device)
    except Exception as ex:
        return NeuralGenerateResult(ok=False, error=str(ex), prompt=prompt, device=device)

    tmp = output_path.with_suffix(".neural.tmp.wav")
    try:
        _write_wav(tmp, audio, sample_rate)
        if bool(getattr(settings, "neural_resample_44100", True)):
            ffmpeg = str(getattr(settings, "ffmpeg_path", "ffmpeg") or "ffmpeg")
            if _resample_to_44100(tmp, output_path, ffmpeg):
                tmp.unlink(missing_ok=True)
            else:
                tmp.rename(output_path)
        else:
            tmp.rename(output_path)
    except Exception as ex:
        tmp.unlink(missing_ok=True)
        return NeuralGenerateResult(ok=False, error=str(ex), prompt=prompt, device=device)
    finally:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    return NeuralGenerateResult(
        ok=output_path.is_file(),
        path=output_path if output_path.is_file() else None,
        device=device,
        duration_seconds=float(dur),
        prompt=prompt,
    )


def neural_status(settings: Any) -> dict[str, Any]:
    """供 /api/music/neural-status 返回运行环境摘要。"""
    use, reason = should_use_neural_generation(settings)
    info: dict[str, Any] = {
        "available": is_neural_available(),
        "compose_backend": resolve_compose_backend(settings),
        "model_id": getattr(settings, "neural_model_id", "facebook/musicgen-small"),
        "cuda": _cuda_ready(),
        "cuda_ready": _cuda_ready(),
        "will_use_neural": use,
        "skip_reason": None if use else reason,
        "gpu_name": None,
        "vram_gb": None,
        "torch_version": None,
        "torch_cuda": None,
    }
    try:
        import torch

        info["torch_version"] = torch.__version__
        info["torch_cuda"] = torch.version.cuda
        if _cuda_ready():
            props = torch.cuda.get_device_properties(0)
            info["gpu_name"] = props.name
            info["vram_gb"] = round(props.total_memory / (1024**3), 2)
    except ImportError:
        pass
    info["max_duration_gpu"] = int(getattr(settings, "neural_max_duration_gpu", 12))
    info["max_duration_cpu"] = int(getattr(settings, "neural_max_duration_cpu", 15))
    info["max_new_tokens"] = int(getattr(settings, "neural_max_new_tokens", 768))
    info["cpu_fallback"] = bool(getattr(settings, "neural_cpu_fallback", False))
    return info
