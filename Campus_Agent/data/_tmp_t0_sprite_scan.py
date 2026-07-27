# -*- coding: utf-8 -*-
import json
from pathlib import Path
from collections import Counter

root = Path(r"e:/Agent/Campus_Agent")
roster = json.loads((root / "data/class_roster.json").read_text(encoding="utf-8"))
budget = json.loads((root / "data/sprite_budget.json").read_text(encoding="utf-8"))

# Normalize students list
if isinstance(roster, dict):
    for k in ("students", "females", "characters", "roster", "members", "girls"):
        if k in roster and isinstance(roster[k], list):
            students = roster[k]
            break
    else:
        # maybe nested class
        students = []
        for v in roster.values():
            if isinstance(v, list) and v and isinstance(v[0], dict) and "beauty_tier" in v[0]:
                students = v
                break
else:
    students = roster

belle_budget_ids = budget.get("tiers", {}).get("school_belle", {}).get("character_ids") or \
    budget.get("school_belle", {}).get("character_ids") or []
# try common shapes
if not belle_budget_ids:
    tiers = budget.get("tiers") or budget
    if isinstance(tiers, dict) and "school_belle" in tiers:
        sb = tiers["school_belle"]
        belle_budget_ids = sb.get("character_ids") or sb.get("ids") or sb.get("characters") or []

print("BUDGET school_belle block:")
# print structure around school_belle
raw = (root / "data/sprite_budget.json").read_text(encoding="utf-8")
# already have budget
tiers = budget.get("tiers") or {}
print(json.dumps(tiers.get("school_belle") or budget.get("school_belle"), ensure_ascii=False, indent=2)[:2000])
print("\nPRIVATE PACK:")
print(json.dumps(budget.get("private_pack"), ensure_ascii=False, indent=2)[:2000])

by_id = {s.get("id"): s for s in students if isinstance(s, dict) and s.get("id")}
belle = [s for s in students if isinstance(s, dict) and s.get("beauty_tier") == "school_belle"]
print("\n=== school_belle from roster ===")
for s in sorted(belle, key=lambda x: x.get("id", "")):
    print(f"{s.get('id')}\t{s.get('name')}\t{s.get('beauty_tier')}\tcharm={s.get('charm')}")

# also list beauty_tier counts
c = Counter(s.get("beauty_tier") for s in students if isinstance(s, dict))
print("\nbeauty_tier counts:", dict(c))

# note characters f01 f03 etc
note_ids = ["f01", "f03", "f07", "f10", "f11", "f14", "f18", "f19"]
print("\n=== note line125 ids ===")
for i in note_ids:
    s = by_id.get(i, {})
    print(f"{i}\t{s.get('name')}\t{s.get('beauty_tier')}\tcharm={s.get('charm')}")

# Expected filenames from plan
school_quota = 80
private_quota = 20
private_names = [
    "casual_stand_neutral", "casual_stand_happy", "casual_stand_shy",
    "casual_sit_bunk_neutral", "casual_stretch_happy",
    "pajama_stand_neutral", "pajama_stand_shy", "pajama_sit_bunk_neutral",
    "pajama_sit_bunk_happy", "pajama_yawn_neutral",
    "towel_stand_neutral", "towel_stand_shy", "towel_wet_hair_neutral", "towel_door_shy",
    "casual_lean_wall_shy", "casual_look_back_happy", "pajama_hug_pillow_shy",
    "towel_after_bath_shy", "casual_window_night_neutral", "pajama_bed_edge_shy",
]

# From budget actions if present
actions = budget.get("actions") or []
emotions = budget.get("emotions") or ["neutral", "happy", "angry", "shy", "sad"]
outfits = budget.get("outfits") or budget.get("school_outfits") or []

print("\n=== budget actions/outfits sample ===")
print("actions count", len(actions), "sample", actions[:15] if isinstance(actions, list) else actions)
print("emotions", emotions)
print("outfits", outfits)
print("actions_private", budget.get("actions_private", [])[:25])

# Count files for T0
t0_ids = sorted({s.get("id") for s in belle} | set(belle_budget_ids) | {"f21", "f22", "f23", "f24"})
sprites_root = root / "data/sprites/students"

print("\n=== file counts per T0 ===")
for cid in t0_ids:
    d = sprites_root / cid
    if not d.exists():
        print(f"{cid}\tDIR_MISSING")
        continue
    pngs = sorted([p for p in d.iterdir() if p.suffix.lower() == ".png"])
    # categories
    identity = [p for p in pngs if p.name.startswith("_identity") or p.name.startswith("_")]
    q = [p for p in pngs if p.name.startswith("q_")]
    private = [p for p in pngs if any(p.stem.startswith(pref) for pref in
                ("casual_", "pajama_", "towel_"))]
    school = [p for p in pngs if p not in identity and p not in q and p not in private]
    staging = list((d / "_staging").glob("*.png")) if (d / "_staging").exists() else []
    print(f"{cid}\ttotal_png={len(pngs)}\tschoolish={len(school)}\tprivateish={len(private)}\tq={len(q)}\tmeta={len(identity)}\tstaging={len(staging)}")
    # list all stems
    stems = [p.stem for p in pngs]
    # missing private
    have = set(stems)
    miss_priv = [n for n in private_names if n not in have]
    print(f"  private_have={20-len(miss_priv)}/20 missing_private={miss_priv[:8]}{'...' if len(miss_priv)>8 else ''}")
    # sample school files
    print(f"  sample_files={stems[:12]}")
    print(f"  all_files_count_detail={len(stems)}")

# Also dump expected school patterns from budget if any
print("\n=== looking for expected school file list in budget ===")
for key in ("filename_patterns", "school_pack", "expected_files", "manifest_slots", "slots"):
    if key in budget:
        print(key, str(budget[key])[:300])

# Find any progress/manifest json
print("\n=== inventory-like json under data ===")
for p in sorted((root / "data").rglob("*.json")):
    name = p.name.lower()
    if any(x in name for x in ("sprite", "manifest", "inventory", "progress", "gen_", "cutout")):
        print(p.relative_to(root))
