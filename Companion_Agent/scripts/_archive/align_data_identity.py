"""Align Companion_Agent/data identity catalogs (one-shot cleanup)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def dump(name: str, obj) -> None:
    (DATA / name).write_text(
        json.dumps(obj, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def iter_model_chars(mr: dict):
    for base in mr.get("bases") or []:
        for ch in base.get("characters") or []:
            yield base, ch


def main() -> None:
    mr = load("model_roles.json")
    routes = load("route_catalog.json")
    sg = load("social_graph.json")
    weights = load("cast_weights.json")
    caps = load("archetype_caps.json")

    route_by_id = {r["character_id"]: r for r in routes.get("routes") or []}
    name_by_id = {}
    for _base, ch in iter_model_chars(mr):
        cid = ch.get("id")
        prof = ch.get("profile") or {}
        if cid and prof.get("name"):
            name_by_id[cid] = prof["name"]

    # --- 1) Sync model_roles.route from route_catalog (SSOT) ---
    synced_routes = 0
    for _base, ch in iter_model_chars(mr):
        cid = ch.get("id")
        rt = route_by_id.get(cid)
        if not rt:
            continue
        # store a slim embedded copy for tooling/UI that still reads model_roles.route
        ch["route"] = {
            "character_id": rt.get("character_id"),
            "base_id": rt.get("base_id"),
            "growth_mode": rt.get("growth_mode"),
            "start_stage_id": rt.get("start_stage_id"),
            "target_stage_id": rt.get("target_stage_id"),
            "max_stage_id": rt.get("max_stage_id"),
            "allowed_endings": list(rt.get("allowed_endings") or []),
            "route_label": rt.get("route_label"),
            "cast_role": rt.get("cast_role"),
        }
        synced_routes += 1
        # keep profile stage/growth aligned with route when present
        prof = ch.setdefault("profile", {})
        if rt.get("growth_mode"):
            prof["growth_mode"] = rt["growth_mode"]
        if rt.get("target_stage_id"):
            prof["target_stage_id"] = rt["target_stage_id"]
        if rt.get("cast_role"):
            prof["cast_role"] = rt["cast_role"]
        # relationship label: prefer social_graph.role_to_pc
        social = (sg.get("characters") or {}).get(cid) or {}
        if social.get("role_to_pc"):
            prof["relationship"] = social["role_to_pc"]
        if social.get("occupation") and not (prof.get("occupation") or "").strip():
            prof["occupation"] = social["occupation"]
        elif social.get("occupation"):
            # SSOT occupation = social_graph for world consistency
            prof["occupation"] = social["occupation"]

    # --- 2) miara label unify ---
    miara_role = "漫展偶遇的人"
    if "miara" in (sg.get("characters") or {}):
        sg["characters"]["miara"]["role_to_pc"] = miara_role
    if "miara" in route_by_id:
        # keep progression hint in route_label
        route_by_id["miara"]["route_label"] = f"{miara_role} → 可走到恋爱/结婚"
    for _base, ch in iter_model_chars(mr):
        if ch.get("id") != "miara":
            continue
        prof = ch.setdefault("profile", {})
        prof["relationship"] = miara_role
        if "route" in ch:
            ch["route"]["route_label"] = f"{miara_role} → 可走到恋爱/结婚"

    # --- 3) cast_weights names + labels from model_roles / social_graph ---
    for cid, row in (weights.get("characters") or {}).items():
        if cid in name_by_id:
            row["name"] = name_by_id[cid]
        social = (sg.get("characters") or {}).get(cid) or {}
        role = social.get("role_to_pc") or ""
        label = row.get("label") or ""
        tip = label.split("·", 1)[1].strip() if "·" in label else label.strip()
        if role and tip:
            row["label"] = f"{role} · {tip}"
        elif role:
            row["label"] = role

    # --- 4) archetype_caps align with route SSOT (romance → married) ---
    caps["caps"] = {
        "gentle_lover": "married",
        "tsundere": "married",
        "cheerful_sun": "married",
        "sarcastic_lover": "married",
        "mature_sister": "married",
        "fantasy_spirit": "married",
    }
    caps["labels"] = {
        "gentle_lover": "温柔恋人 · 最高可妻子",
        "tsundere": "傲娇 · 最高可妻子",
        "cheerful_sun": "元气少女 · 最高可妻子",
        "sarcastic_lover": "毒舌 · 最高可妻子",
        "mature_sister": "成熟姐姐 · 最高可妻子",
        "fantasy_spirit": "奇幻精灵 · 最高可妻子",
    }

    # --- 5) presets: regenerate from model_roles first char per base (no stale persona) ---
    presets = []
    for base in mr.get("bases") or []:
        chars = base.get("characters") or []
        if not chars:
            continue
        pick = chars[0]
        if base.get("id") == "cheerful_sun":
            pick = next((c for c in chars if c.get("id") == "qingcai"), chars[0])
        prof = dict(pick.get("profile") or {})
        # strip dead Live2D/VRM from preset surface
        prof["live2d_model"] = ""
        prof["vrm_model"] = ""
        presets.append(
            {
                "id": base.get("id"),
                "label": base.get("label"),
                "deprecated_note": "演示用：各大类首个角色快照，权威人格以 model_roles + social_graph 为准",
                "profile": {
                    "name": prof.get("name"),
                    "age": prof.get("age"),
                    "relationship": prof.get("relationship"),
                    "occupation": prof.get("occupation"),
                    "appearance": prof.get("appearance"),
                    "backstory": prof.get("backstory"),
                    "personality": prof.get("personality"),
                    "speaking_style": prof.get("speaking_style"),
                    "traits": prof.get("traits") or {},
                    "opening_line": prof.get("opening_line"),
                    "live2d_model": "",
                    "vrm_model": "",
                    "tts_voice": prof.get("tts_voice") or "",
                    "theme_color": prof.get("theme_color") or base.get("theme_color") or "",
                    "mbti_type": prof.get("mbti_type") or "",
                    "cast_role": prof.get("cast_role") or "",
                    "character_id": pick.get("id"),
                },
            }
        )

    # write route_catalog back (miara label)
    routes["routes"] = list(route_by_id.values())
    # preserve order from original if possible
    order = [r["character_id"] for r in load("route_catalog.json").get("routes") or []]
    routes["routes"] = sorted(
        route_by_id.values(),
        key=lambda r: order.index(r["character_id"]) if r["character_id"] in order else 999,
    )

    dump("model_roles.json", mr)
    dump("social_graph.json", sg)
    dump("route_catalog.json", routes)
    dump("cast_weights.json", weights)
    dump("archetype_caps.json", caps)
    dump("presets.json", presets)

    print(f"synced model_roles.route: {synced_routes}")
    print(f"cast_weights names: {len(name_by_id)}")
    print(f"presets regenerated: {len(presets)}")
    print("miara role:", miara_role)
    print("archetype_caps all romance -> married")


if __name__ == "__main__":
    main()
