"""Stable Audio Open 神经 BGM（Apache 2.0，diffusers）。"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from .neural_music import NeuralGenerateResult, _cuda_ready, _resample_to_44100, _write_wav

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_pipe: Any = None
_runtime_device: str = "cpu"


def is_stable_audio_available() -> bool:
    try:
        import torch  # noqa: F401
        from diffusers import StableAudioPipeline  # noqa: F401

        return True
    except ImportError:
        return False


def _pick_device(settings: Any) -> str:
    pref = str(getattr(settings, "neural_device", "auto") or "auto").strip().lower()
    if pref == "cpu":
        return "cpu"
    if _cuda_ready():
        return "cuda"
    return "cpu"


def _unload() -> None:
    global _pipe, _runtime_device
    _pipe = None
    _runtime_device = "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def _load(settings: Any) -> tuple[Any, str]:
    global _pipe, _runtime_device
    import torch
    from diffusers import StableAudioPipeline

    model_id = str(
        getattr(settings, "stable_audio_model_id", "stabilityai/stable-audio-open-1.0")
        or "stabilityai/stable-audio-open-1.0"
    )
    device = _pick_device(settings)
    fp16 = bool(getattr(settings, "neural_fp16", True)) and device == "cuda"
    dtype = torch.float16 if fp16 else torch.float32

    with _lock:
        if _pipe is not None and _runtime_device == device:
            return _pipe, device
        _unload()
        logger.info("加载 Stable Audio Open: %s device=%s", model_id, device)
        _pipe = StableAudioPipeline.from_pretrained(model_id, torch_dtype=dtype)
        _pipe = _pipe.to(device)
        _runtime_device = device
        return _pipe, device


def should_use_stable_audio(settings: Any) -> tuple[bool, str]:
    if not getattr(settings, "neural_music_enabled", True) or not is_stable_audio_available():
        return False, "stable_audio disabled or deps missing"
    device = _pick_device(settings)
    if device == "cuda":
        return True, "cuda"
    if bool(getattr(settings, "neural_cpu_fallback", False)):
        return True, "cpu"
    return False, "CUDA 不可用且 NEURAL_CPU_FALLBACK=false"


def _cap_duration(requested: int, device: str, settings: Any) -> float:
    req = max(5.0, min(47.0, float(requested)))
    if device == "cuda":
        cap = float(getattr(settings, "stable_audio_max_duration_gpu", 30))
    else:
        cap = float(getattr(settings, "stable_audio_max_duration_cpu", 12))
    return max(5.0, min(req, cap))


def generate_stable_audio_wav(
    settings: Any,
    *,
    output_path: Path,
    prompt: str,
    duration_seconds: int,
    seed: int | None = None,
) -> NeuralGenerateResult:
    use, reason = should_use_stable_audio(settings)
    if not use:
        return NeuralGenerateResult(ok=False, error=reason, backend="stable_audio", prompt=prompt)

    prompt = (prompt or "instrumental background music, no vocals").strip()[:500]
    try:
        pipe, device = _load(settings)
        dur = _cap_duration(duration_seconds, device, settings)
        steps = int(getattr(settings, "stable_audio_inference_steps", 100))
        gen_kw: dict[str, Any] = {
            "prompt": prompt,
            "num_inference_steps": max(20, min(200, steps)),
            "audio_end_in_s": dur,
            "num_waveforms_per_prompt": 1,
        }
        if seed is not None:
            import torch

            gen_kw["generator"] = torch.Generator(device=device).manual_seed(int(seed))

        logger.info("Stable Audio generate device=%s duration=%ss steps=%s", device, dur, steps)
        out = pipe(**gen_kw)
        audio = out.audios[0]
        sr = int(getattr(pipe, "vae", None) and getattr(pipe.vae, "sampling_rate", 44100) or 44100)
        if hasattr(out, "sample_rate") and out.sample_rate:
            sr = int(out.sample_rate)

        tmp = output_path.with_suffix(".sa.tmp.wav")
        _write_wav(tmp, audio, sr)
        if bool(getattr(settings, "neural_resample_44100", True)):
            ffmpeg = str(getattr(settings, "ffmpeg_path", "ffmpeg") or "ffmpeg")
            if _resample_to_44100(tmp, output_path, ffmpeg):
                tmp.unlink(missing_ok=True)
            else:
                tmp.rename(output_path)
        else:
            tmp.rename(output_path)
        _unload()
        return NeuralGenerateResult(
            ok=output_path.is_file(),
            path=output_path if output_path.is_file() else None,
            backend="stable_audio",
            device=device,
            duration_seconds=dur,
            prompt=prompt,
        )
    except Exception as ex:
        logger.exception("Stable Audio generate failed")
        _unload()
        return NeuralGenerateResult(ok=False, error=str(ex), backend="stable_audio", prompt=prompt)


def stable_audio_status(settings: Any) -> dict[str, Any]:
    use, reason = should_use_stable_audio(settings)
    return {
        "available": is_stable_audio_available(),
        "model_id": getattr(settings, "stable_audio_model_id", "stabilityai/stable-audio-open-1.0"),
        "will_use": use,
        "skip_reason": None if use else reason,
        "max_duration_gpu": int(getattr(settings, "stable_audio_max_duration_gpu", 30)),
        "inference_steps": int(getattr(settings, "stable_audio_inference_steps", 100)),
    }
