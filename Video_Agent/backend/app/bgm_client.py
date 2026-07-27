import logging
from typing import Any

from .config import Settings

logger = logging.getLogger(__name__)


def _build_prompt(prompt: str, settings: Settings) -> str:
    base = prompt.strip()
    suffix = (settings.bgm_prompt_suffix or "").strip()
    if suffix and suffix not in base:
        return f"{base}{suffix}"
    return base


def derive_music_brief(text: str, settings: Settings | None = None) -> dict[str, Any]:
    t = (text or "").lower()
    mood = "warm, healing"
    energy = "low"
    tempo = "slow"
    instrumentation: list[str] = ["soft piano", "light pad", "gentle percussion"]
    if any(k in t for k in ("energ", "动感", "节奏", "快", "热血")):
        mood = "energetic, rhythmic"
        energy = "medium"
        tempo = "medium"
        instrumentation = ["synth", "tight drums", "bass"]
    if any(k in t for k in ("夜", "梦", "安静", "治愈", "睡", "猫", "温暖")):
        mood = "warm, healing"
        energy = "low"
        tempo = "slow"
        instrumentation = ["soft piano", "warm pad", "minimal percussion"]
    if any(k in t for k in ("piano", "钢琴")):
        instrumentation = ["piano", "soft pad", "light percussion"]
    if any(k in t for k in ("电子", "synth", "电子感")):
        instrumentation = ["synth", "pulse bass", "light drums"]
    if any(k in t for k in ("赛博", "科技", "未来")):
        mood = "cool, futuristic"
        energy = "medium"
        tempo = "medium"
        instrumentation = ["synth", "pulse bass", "glitch percussion"]
    if settings is not None and settings.bgm_prompt_suffix:
        prompt = _build_prompt(text, settings)
    else:
        prompt = text.strip()
    return {
        "prompt": prompt,
        "mood": mood,
        "energy": energy,
        "tempo": tempo,
        "instrumentation": instrumentation,
        "lyrics": False,
        "style_hint": "pop",
    }
