#!/usr/bin/env python3
"""冒烟：ensemble 会话装配 + speaker/guest 解析（不调 LLM、不绑问句）。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.emotions import parse_character_reply  # noqa: E402
from app.ensemble import (  # noqa: E402
    apply_speaker_to_parsed,
    build_ensemble,
    empty_ensemble,
    ensemble_prompt_block,
    public_ensemble,
)
from app.scenes import resolve_scene  # noqa: E402


def main() -> None:
    errors: list[str] = []

    # --- empty ---
    empty = empty_ensemble()
    if empty.enabled or public_ensemble(empty) is not None:
        errors.append("empty_ensemble 不应 enabled/public")

    # --- build ---
    cast = [
        {"character_id": "aili", "name": "艾莉", "theme_color": "#6a8", "sprite_outfit": "casual"},
        {"character_id": "linxi", "name": "凛汐", "theme_color": "#88a", "sprite_outfit": "work"},
    ]
    ens = build_ensemble(focus_id="aili", guest_id="linxi", cast=cast)
    if not ens.enabled or ens.cast_ids != ["aili", "linxi"]:
        errors.append(f"build_ensemble cast_ids 异常: {ens.cast_ids}")
    if ens.speaking_id != "aili" or ens.focus_id != "aili":
        errors.append("默认 speaking/focus 应为 aili")
    pub = public_ensemble(ens)
    if not pub or not pub.get("enabled"):
        errors.append("public_ensemble 应返回 enabled 快照")

    # --- prompt ---
    block = ensemble_prompt_block(ens)
    if "【speaker:" not in block or "aili" not in block or "linxi" not in block:
        errors.append(f"ensemble_prompt_block 缺契约: {block[:120]}")

    # --- parse speaker switch ---
    raw = "【speaker:linxi】（轻轻点头）那份表…我先看一眼。\n【guest:艾莉在一旁整理花茎。】"
    parsed = parse_character_reply(raw)
    if parsed.get("speaker_id") != "linxi":
        errors.append(f"speaker_id 应为 linxi，得 {parsed.get('speaker_id')}")
    if "艾莉" not in (parsed.get("guest_reaction") or ""):
        errors.append(f"guest_reaction 丢失: {parsed.get('guest_reaction')}")
    if "【speaker" in (parsed.get("spoken") or ""):
        errors.append("spoken 未剥离 speaker 标记")

    parsed2, ens2 = apply_speaker_to_parsed(parsed, ens=ens)
    if not ens2 or ens2.speaking_id != "linxi":
        errors.append(f"apply_speaker 后 speaking 应为 linxi，得 {ens2}")
    if not (ens2.guest_reaction or "").strip():
        errors.append("guest_reaction 未写回 ensemble")

    # invalid speaker ignored
    bad = parse_character_reply("【speaker:nobody】你好")
    _, ens3 = apply_speaker_to_parsed(bad, ens=ens2)
    if ens3 and ens3.speaking_id == "nobody":
        errors.append("非法 speaker 不应写入")

    # --- season scene resolve (no throw) ---
    sc = resolve_scene(scene_id="campus", season="winter")
    if not isinstance(sc, dict) or not sc.get("id"):
        errors.append("resolve_scene campus winter 失败")
    # if winter file missing, still returns base image url or css
    if "image" not in sc and "css" not in sc:
        errors.append("scene 应有 image 或 css")

    if errors:
        print("FAIL")
        for e in errors:
            print(" -", e)
        raise SystemExit(1)
    print("OK smoke-ensemble-dialogue")
    print(f"  speaking={ens2.speaking_id} guest={ens2.guest_reaction[:24]!r}")
    print(f"  scene_image={sc.get('image')}")


if __name__ == "__main__":
    main()
