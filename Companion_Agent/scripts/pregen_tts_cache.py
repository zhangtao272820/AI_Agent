#!/usr/bin/env python3
"""预生成 TTS：默认仅 12 角色开场白（省免费额度）。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.config import get_settings, api_key  # noqa: E402
from app.tts import synthesize_tts  # noqa: E402
from app.text_speech import sanitize_for_speech  # noqa: E402

ROLES_PATH = ROOT / "data" / "model_roles.json"
MANIFEST_PATH = ROOT / "data" / "tts_pregen_manifest.json"
OUT_DIR = ROOT / "data" / "tts_pregen"

STAGE_LINES = [
    {"key": "friend", "text": "我们算是朋友了呢。"},
    {"key": "crush", "text": "笨蛋……你怎么突然这样。"},
    {"key": "dating", "text": "亲爱的，以后也请多指教。"},
]


def load_roles() -> list[dict]:
    data = json.loads(ROLES_PATH.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for base in data.get("bases") or []:
        for c in base.get("characters") or []:
            prof = c.get("profile") or {}
            rows.append(
                {
                    "id": c.get("id"),
                    "voice": c.get("voice_id") or prof.get("tts_voice") or "",
                    "opening": prof.get("opening_line") or "",
                }
            )
    return rows


def build_manifest(*, include_stages: bool = False) -> list[dict]:
    entries: list[dict] = []
    idx = 0
    for row in load_roles():
        texts_with_tier: list[tuple[str, str]] = [(row["opening"], "opening")]
        if include_stages:
            texts_with_tier.extend((s["text"], "stage") for s in STAGE_LINES)
        for text, tier in texts_with_tier:
            spoken = sanitize_for_speech(text)
            if not spoken:
                continue
            file = f"data/tts_pregen/{row['id']}_{idx}.mp3"
            entries.append(
                {
                    "character_id": row["id"],
                    "voice": row["voice"],
                    "text": spoken,
                    "file": file,
                    "tier": tier,
                }
            )
            idx += 1
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description="Companion TTS pregen（默认仅开场白）")
    parser.add_argument("--dry-run", action="store_true", help="只写 manifest，不合成")
    parser.add_argument("--manifest-only", action="store_true", help="同 --dry-run")
    parser.add_argument(
        "--with-stages",
        action="store_true",
        help="额外生成阶段晋升句（+36 条 API，耗 token）",
    )
    parser.add_argument("--force", action="store_true", help="覆盖已有文件")
    args = parser.parse_args()

    entries = build_manifest(include_stages=args.with_stages)
    manifest = {
        "version": 2,
        "tier": "opening_only" if not args.with_stages else "opening_and_stages",
        "entries": entries,
    }

    if args.dry_run or args.manifest_only:
        print(f"[dry-run] {len(entries)} entries ({manifest['tier']}) -> {MANIFEST_PATH}")
        MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 0

    settings = get_settings()
    if not api_key(settings):
        print("FAIL: 未配置 DASHSCOPE_API_KEY / OPENAI_API_KEY")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ok = 0
    skip = 0
    fail = 0
    for entry in entries:
        rel = entry["file"]
        out = ROOT / rel
        if out.is_file() and not args.force:
            skip += 1
            continue
        voice = entry["voice"]
        text = entry["text"]
        try:
            raw, _mime = synthesize_tts(settings, text=text, voice=voice)
            out.write_bytes(raw)
            ok += 1
            print(f"OK {rel} [{entry.get('tier', '')}]")
        except Exception as ex:
            fail += 1
            print(f"FAIL {rel}: {ex}")

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Done: ok={ok} skip={skip} fail={fail} manifest={MANIFEST_PATH}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
