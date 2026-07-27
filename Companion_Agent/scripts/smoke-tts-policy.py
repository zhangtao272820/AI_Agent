#!/usr/bin/env python3
"""Smoke: TTS 省额度策略（key_only + 预生成零 token）。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import Settings  # noqa: E402
from app.tts_cache import has_pregen_audio, is_key_tts_moment, should_synthesize_tts  # noqa: E402

MANIFEST = ROOT / "data" / "tts_pregen_manifest.json"


def main() -> int:
    errors: list[str] = []
    settings = Settings(companion_tts_mode="key_only", companion_tts_enabled=True)

    if settings.companion_tts_mode != "key_only":
        errors.append("显式 companion_tts_mode=key_only 应生效")

    full_settings = Settings(companion_tts_mode="full", companion_tts_enabled=True)
    if not should_synthesize_tts(
        full_settings,
        spoken="随便聊聊吧，今天天气不错，你有没有出门走走",
        voice="Serena",
    ):
        errors.append("full 模式下普通句应调 TTS")

    if not is_key_tts_moment(is_opening=True):
        errors.append("开场应视为关键句")
    if not is_key_tts_moment(stage_changed=True):
        errors.append("阶段变化应视为关键句")
    if not is_key_tts_moment(event_fired=True):
        errors.append("事件触发应视为关键句")
    if is_key_tts_moment():
        errors.append("普通回合不应视为关键句")

    if should_synthesize_tts(settings, spoken="随便聊聊", voice="Cherry"):
        errors.append("key_only 下普通句不应调 TTS")
    if not should_synthesize_tts(settings, spoken="阶段升级啦", voice="Cherry", stage_changed=True):
        errors.append("key_only 下阶段变化应调 TTS")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = manifest.get("entries") or []
    if len(entries) > 15:
        errors.append(f"预生成 manifest 应≤15 条（仅开场白），实际 {len(entries)}")
    if manifest.get("tier") != "opening_only":
        errors.append("manifest tier 应为 opening_only")

    if entries:
        sample = entries[0]
        voice = str(sample.get("voice") or "")
        text = str(sample.get("text") or "")
        if not voice or not text:
            errors.append("manifest 首条应有 voice/text")
        elif has_pregen_audio(voice, text):
            if not should_synthesize_tts(settings, spoken=text, voice=voice):
                errors.append("已有预生成文件时 key_only 应播放")

    if errors:
        print("FAIL smoke-tts-policy")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK smoke-tts-policy: mode=key_only manifest={len(entries)} tier={manifest.get('tier')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
