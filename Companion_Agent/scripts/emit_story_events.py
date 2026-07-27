# -*- coding: utf-8 -*-
"""Emit per-act story events from story_routes.json into data/events/story_*.yaml."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENTS = ROOT / "data" / "events"
ROUTES = ROOT / "data" / "story_routes.json"

# Affinity gates by act index (0-based)
AFFINITY = {
    "T0": [48, 62, 75, 85],
    "T1": [50, 68, 82],
    "T2": [55, 78],
    "N": [52, 70],
}
STAGE = {
    0: "friend",
    1: "close_friend",
    2: "crush",
    3: "dating",
}


def yaml_escape(s: str) -> str:
    return s.replace('"', '\\"')


def main() -> None:
    data = json.loads(ROUTES.read_text(encoding="utf-8"))
    chars = data.get("characters") or {}
    written = 0
    for cid, row in chars.items():
        tier = str(row.get("tier") or "T1")
        gates = AFFINITY.get(tier, AFFINITY["T1"])
        acts = row.get("acts") or []
        for i, act in enumerate(acts):
            flags = [str(f) for f in (act.get("flags") or []) if f]
            if not flags:
                continue
            primary = flags[0]
            eid = f"story_{cid}_{act.get('id') or i}"
            path = EVENTS / f"{eid}.yaml"
            aff = gates[i] if i < len(gates) else gates[-1]
            stage = STAGE.get(i, "dating")
            title = str(act.get("title") or primary)
            beat = str(act.get("beat") or "").strip()
            sprites = ", ".join(act.get("sprites") or [])
            # prior act flags soft-require via flags_any on previous primary
            prior = []
            if i > 0:
                prev_flags = (acts[i - 1].get("flags") or [])
                if prev_flags:
                    prior = [str(prev_flags[0])]

            absent = [primary]
            trigger_extra = ""
            if prior:
                trigger_extra = f"\n  flags_present: [{', '.join(prior)}]"

            body = f"""id: {eid}
label: {title}
priority: {5 + i}
once: true
chance: 1.0
scene_id: ""
trigger:
  character_ids: [{cid}]
  stage_min: {stage}
  affinity_min: {aff}
  flags_absent: [{', '.join(absent)}]{trigger_extra}
prompt_snippet: |
  【专属故事 · {row.get('route_title')} · 第{i + 1}幕 · {title}】
  {beat}
  立绘气质参考：{sprites or '日常'}。
  用角色口吻推进这一幕的情绪与选择；可给 2～3 个短选项。
  不要直接宣布结局名称；关系阶段由系统判定。
rewards:
  flags_set: [{', '.join(flags)}]
choice_effects:
  - {{ trust_delta: 3, affinity_delta: 3 }}
  - {{ trust_delta: 2, affinity_delta: 2 }}
  - {{ trust_delta: -2, affinity_delta: -1 }}
"""
            path.write_text(body, encoding="utf-8")
            written += 1
    print(f"wrote {written} story event yaml files")


if __name__ == "__main__":
    main()
