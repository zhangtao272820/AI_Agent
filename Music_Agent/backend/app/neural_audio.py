"""神经音频生成统一路由：MusicGen | Stable Audio Open。"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from . import neural_music as musicgen
from . import stable_audio_gen as stable_audio
from .neural_music import NeuralGenerateResult, build_musicgen_prompt

NeuralEngine = Literal["musicgen", "stable_audio"]
ComposeBackend = Literal["rule", "neural", "auto"]


def resolve_neural_engine(settings: Any) -> NeuralEngine:
    raw = str(getattr(settings, "neural_engine", "musicgen") or "musicgen").strip().lower()
    if raw == "stable_audio" and stable_audio.is_stable_audio_available():
        return "stable_audio"
    if raw == "stable_audio" and not stable_audio.is_stable_audio_available():
        if musicgen.is_neural_available():
            return "musicgen"
    if raw == "musicgen" and musicgen.is_neural_available():
        return "musicgen"
    if stable_audio.is_stable_audio_available():
        return "stable_audio"
    return "musicgen"


def resolve_compose_backend(settings: Any) -> ComposeBackend:
    raw = str(getattr(settings, "compose_backend", "auto") or "auto").strip().lower()
    if raw not in ("rule", "neural", "auto"):
        raw = "auto"
    if raw == "auto":
        if getattr(settings, "neural_music_enabled", False) and is_any_neural_available():
            return "neural"
        return "rule"
    if raw == "neural" and not is_any_neural_available():
        return "rule"
    return raw  # type: ignore[return-value]


def is_any_neural_available() -> bool:
    return musicgen.is_neural_available() or stable_audio.is_stable_audio_available()


def should_use_neural_generation(settings: Any) -> tuple[bool, str]:
    engine = resolve_neural_engine(settings)
    if engine == "stable_audio":
        return stable_audio.should_use_stable_audio(settings)
    return musicgen.should_use_neural_generation(settings)


def build_neural_prompt(**kwargs: Any) -> str:
    return build_musicgen_prompt(**kwargs)


def generate_neural_wav(
    settings: Any,
    *,
    output_path: Path,
    prompt: str,
    duration_seconds: int,
    seed: int | None = None,
) -> NeuralGenerateResult:
    engine = resolve_neural_engine(settings)
    if engine == "stable_audio":
        return stable_audio.generate_stable_audio_wav(
            settings,
            output_path=output_path,
            prompt=prompt,
            duration_seconds=duration_seconds,
            seed=seed,
        )
    result = musicgen.generate_neural_wav(
        settings,
        output_path=output_path,
        prompt=prompt,
        duration_seconds=duration_seconds,
        seed=seed,
    )
    result.backend = "musicgen"
    return result


def warmup_neural_model(settings: Any) -> dict[str, Any]:
    engine = resolve_neural_engine(settings)
    if engine == "stable_audio":
        use, reason = stable_audio.should_use_stable_audio(settings)
        if not use:
            return {"warmed": False, "engine": engine, "reason": reason}
        try:
            stable_audio._load(settings)
            return {"warmed": True, "engine": engine}
        except Exception as ex:
            return {"warmed": False, "engine": engine, "error": str(ex)}
    info = musicgen.warmup_neural_model(settings)
    info["engine"] = "musicgen"
    return info


def neural_status(settings: Any) -> dict[str, Any]:
    engine = resolve_neural_engine(settings)
    base = musicgen.neural_status(settings)
    base["neural_engine"] = engine
    base["engines"] = {
        "musicgen": {
            "available": musicgen.is_neural_available(),
            "model_id": getattr(settings, "neural_model_id", "facebook/musicgen-small"),
        },
        "stable_audio": stable_audio.stable_audio_status(settings),
    }
    use, reason = should_use_neural_generation(settings)
    base["will_use_neural"] = use
    base["skip_reason"] = None if use else reason
    base["active_engine"] = engine
    return base
