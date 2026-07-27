"""根据角色参数解析 TTS 音色（qwen3-tts-flash / CosyVoice）。"""

from __future__ import annotations

import json
from pathlib import Path

from .character import CharacterProfile, PROJECT_ROOT

# 旧版 qwen-tts 音色名 → qwen3-tts-flash 兼容名
_LEGACY_VOICE_MAP: dict[str, str] = {
    "longxiaochun": "Cherry",
    "longwan": "Chelsie",
    "longyuan": "Maia",
    "longxiaobai": "Kai",
    "qianxue": "Chelsie",
}


def _catalog_path() -> Path:
    return PROJECT_ROOT / "data" / "voice_catalog.json"


def load_voice_catalog() -> dict:
    path = _catalog_path()
    if not path.is_file():
        return {"voices": [], "default_voice": "Cherry", "default_model": "qwen3-tts-flash"}
    return json.loads(path.read_text(encoding="utf-8"))


def list_voices() -> list[dict[str, str]]:
    catalog = load_voice_catalog()
    return catalog.get("voices") or []


def voice_catalog_index() -> dict[str, dict]:
    return {str(v.get("id") or ""): v for v in list_voices() if v.get("id")}


def known_voice_ids() -> set[str]:
    return set(voice_catalog_index().keys())


def default_voice() -> str:
    catalog = load_voice_catalog()
    return str(catalog.get("default_voice") or "Cherry")


def default_tts_model() -> str:
    catalog = load_voice_catalog()
    return str(catalog.get("default_model") or "qwen3-tts-flash")


def resolve_tts_model(voice_id: str) -> str:
    row = voice_catalog_index().get(voice_id)
    if row and row.get("tts_model"):
        return str(row["tts_model"])
    if voice_id.startswith("long"):
        if voice_id.endswith("_v3"):
            return "cosyvoice-v3-flash"
        if voice_id.endswith("_v2"):
            return "cosyvoice-v2"
        return "cosyvoice-v1"
    return default_tts_model()


def is_cosyvoice_model(model: str) -> bool:
    return model.lower().startswith("cosyvoice")


def normalize_voice(voice: str) -> str:
    v = (voice or "").strip()
    if not v:
        return default_voice()
    mapped = _LEGACY_VOICE_MAP.get(v, v)
    if mapped in known_voice_ids():
        return mapped
    if mapped.startswith("long"):
        return mapped
    return default_voice()


def resolve_voice(profile: CharacterProfile) -> str:
    manual = (profile.tts_voice or "").strip()
    if manual:
        return normalize_voice(manual)

    traits = profile.traits
    style = profile.speaking_style
    scores: dict[str, float] = {}

    def bump(voice_id: str, amount: float) -> None:
        if voice_id in known_voice_ids() or voice_id.startswith("long"):
            scores[voice_id] = scores.get(voice_id, 0.0) + amount

    if traits.gentle >= 0.6:
        bump("Cherry", traits.gentle)
        bump("Serena", traits.gentle * 0.85)
        bump("longyingtian", traits.gentle * 0.8)
    if traits.cheerful >= 0.6:
        bump("Chelsie", traits.cheerful)
        bump("Momo", traits.cheerful * 0.95)
        bump("longanhuan", traits.cheerful * 0.9)
    if traits.cheerful >= 0.75 and traits.mature < 0.35:
        bump("Momo", 0.45)
        bump("Bella", 0.35)
    if traits.mature >= 0.6:
        bump("Maia", traits.mature)
        bump("longxiaoxia_v3", traits.mature * 0.85)
        bump("longgangmei", traits.mature * 0.75)
    if traits.tsundere >= 0.55:
        bump("Vivian", traits.tsundere)
        bump("longjixin", traits.tsundere * 0.9)
    if traits.shy >= 0.55:
        bump("Seren", traits.shy)
        bump("longwanjun_v3", traits.shy * 0.85)
    if traits.clingy >= 0.6:
        bump("Nini", traits.clingy * 0.9)
        bump("longanrou_v3", traits.clingy * 0.85)

    if style == "cute":
        bump("Momo", 0.45)
        bump("Bella", 0.35)
    if style == "formal":
        bump("Maia", 0.35)
        bump("longgangmei", 0.3)
    if style == "sharp":
        bump("Vivian", 0.55)
        bump("longyingbing", 0.5)
        bump("longjixin", 0.45)

    if not scores:
        return default_voice()
    return max(scores.items(), key=lambda x: x[1])[0]
