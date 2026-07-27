# -*- coding: utf-8 -*-
"""Demote playable NPCs (moxi/luli) to nameless background extras.

- Remove from social_graph / model_roles / route_catalog / sprite_catalog / story_routes
- Move data/sprites/npc/{id}/ → _quarantine/named_npc_demoted/{id}/
- Rebuild background_extras from quarantine pools (no live npc roster)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SPRITES = DATA / "sprites"
DEMOTE_IDS = ("moxi", "luli")
QUAR = SPRITES / "_quarantine" / "named_npc_demoted"


def _load(name: str) -> dict | list:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def _dump(name: str, data: object) -> None:
    (DATA / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def move_sprites() -> None:
    QUAR.mkdir(parents=True, exist_ok=True)
    for cid in DEMOTE_IDS:
        src = SPRITES / "npc" / cid
        if not src.is_dir():
            print(f"skip move (missing): {src}")
            continue
        dest = QUAR / cid
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(src), str(dest))
        print(f"moved {src.relative_to(ROOT)} → {dest.relative_to(ROOT)}")
    npc_root = SPRITES / "npc"
    if npc_root.is_dir() and not any(npc_root.iterdir()):
        npc_root.rmdir()
        print("removed empty sprites/npc/")


def patch_social_graph() -> None:
    data = _load("social_graph.json")
    chars = data.get("characters") or {}
    for cid in DEMOTE_IDS:
        chars.pop(cid, None)
    data["characters"] = chars
    drop = set(DEMOTE_IDS)
    data["edges"] = [
        e
        for e in (data.get("edges") or [])
        if e.get("a") not in drop and e.get("b") not in drop
    ]
    pc = data.get("pc") or {}
    summary = str(pc.get("summary") or "")
    summary = summary.replace(
        "恋爱只发生在 romance 线；中立是家人/守门人/同盟，NPC 只提供传闻与支线线索。",
        "恋爱只发生在 romance 线；中立是家人/守门人/同盟。地点路人立绘为无名背景装饰，无对话角色。",
    )
    pc["summary"] = summary
    pc["npc_note"] = "无有名 NPC；路人立绘仅作地点背景装饰（_background），与场景底图同类。"
    data["pc"] = pc
    _dump("social_graph.json", data)
    print(f"social_graph: characters={len(chars)} edges={len(data['edges'])}")


def patch_model_roles() -> None:
    data = _load("model_roles.json")
    drop = set(DEMOTE_IDS)
    n = 0
    for base in data.get("bases") or []:
        before = len(base.get("characters") or [])
        base["characters"] = [c for c in (base.get("characters") or []) if c.get("id") not in drop]
        n += before - len(base["characters"])
    _dump("model_roles.json", data)
    print(f"model_roles: removed {n} characters")


def patch_route_catalog() -> None:
    data = _load("route_catalog.json")
    drop = set(DEMOTE_IDS)
    data["routes"] = [r for r in (data.get("routes") or []) if r.get("character_id") not in drop]
    _dump("route_catalog.json", data)
    print(f"route_catalog: routes={len(data['routes'])}")


def patch_sprite_catalog() -> None:
    data = _load("sprite_catalog.json")
    data["note"] = (
        "玩法 romance×18 + neutral×6；无有名 NPC。"
        "正式立绘：romance/{id}、neutral/{id}；"
        "路人装饰：_background/{loc}/（与场景底图同类，不可对话）；"
        "旧 named npc 归档 _quarantine/named_npc_demoted/。"
    )
    data["cast_policy"]["npc_live"] = (
        "无玩法 NPC；旧 npc/{id} 已迁 _quarantine/named_npc_demoted/，抽样进 _background/"
    )
    packs = data.get("packs") or {}
    if "npc_live" in packs:
        packs["npc_live"] = {
            "label": "已降格·无名背景原料",
            "local_dir": "data/sprites/_quarantine/named_npc_demoted/{id}",
            "note": "不进可玩名单；仅背景装饰抽样源",
        }
    spin = data.get("spinoff_2026_07_16") or {}
    spin["ids"] = [i for i in (spin.get("ids") or []) if i not in DEMOTE_IDS]
    spin["note"] = (
        "2026-07-18 neutral kinship cast; "
        "moxi/luli demoted to nameless background; "
        "old heqing/xiaoke/lele/anran → passerby_pool"
    )
    data["spinoff_2026_07_16"] = spin
    data["roster_spinoff"] = [i for i in (data.get("roster_spinoff") or []) if i not in DEMOTE_IDS]
    data["roster_npc"] = []
    data["characters"] = [
        c for c in (data.get("characters") or []) if c.get("id") not in DEMOTE_IDS
    ]
    _dump("sprite_catalog.json", data)
    print(f"sprite_catalog: characters={len(data['characters'])} roster_npc=[]")


def patch_story_routes() -> None:
    path = DATA / "story_routes.json"
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    data["npc_policy"] = {
        "ids": [],
        "allowed_endings": [],
        "story_branches": False,
        "note": "无有名 NPC；路人立绘仅地点背景装饰，不参与结局与分支",
    }
    _dump("story_routes.json", data)
    print("story_routes: npc_policy.ids=[]")


def patch_cast_pick_draft() -> None:
    path = DATA / "cast_pick_draft.json"
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    picks = data.get("picks") or {}
    for cid in DEMOTE_IDS:
        picks.pop(cid, None)
    data["picks"] = picks
    _dump("cast_pick_draft.json", data)
    print(f"cast_pick_draft: picks={len(picks)}")


def rebuild_background() -> None:
    script = ROOT / "scripts" / "organize_background_extras.py"
    r = subprocess.run([sys.executable, str(script)], cwd=str(ROOT), check=False)
    if r.returncode != 0:
        raise SystemExit(f"organize_background_extras failed: {r.returncode}")


def main() -> None:
    # Flush prints so subprocess output cannot reorder past move confirmation.
    move_sprites()
    sys.stdout.flush()
    patch_social_graph()
    patch_model_roles()
    patch_route_catalog()
    patch_sprite_catalog()
    patch_story_routes()
    patch_cast_pick_draft()
    sys.stdout.flush()
    rebuild_background()
    print("done: named NPCs demoted to nameless background")


if __name__ == "__main__":
    main()
