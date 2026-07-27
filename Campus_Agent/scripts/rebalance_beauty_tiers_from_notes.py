# -*- coding: utf-8 -*-
"""Rebalance female beauty tiers from user look notes + soften mid faces."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "class_roster.json"
BUDGET = ROOT / "data" / "sprite_budget.json"
PERS = ROOT / "data" / "personality_catalog.json"

# User-marked 很好看 → T1; unmarked former T1 (f01/f02/f03) → T2; f07/f19 keep T1.
# f15/f17 leave T4 → mid (不要太难看). T4 empty.
NEW_TIERS: dict[str, str] = {
    # T0
    "f21": "school_belle",
    "f22": "school_belle",
    "f23": "school_belle",
    "f24": "school_belle",
    # T1 extreme (8): marked favorites + keep 御姐
    "f06": "extreme",
    "f07": "extreme",
    "f09": "extreme",
    "f10": "extreme",
    "f12": "extreme",
    "f14": "extreme",
    "f18": "extreme",
    "f19": "extreme",
    # T2 high (8): demoted + remaining
    "f01": "high",
    "f02": "high",
    "f03": "high",
    "f04": "high",
    "f08": "high",
    "f13": "high",
    "f20": "high",
    "f25": "high",
    # T3 mid (5): no low tier; soft ordinary-pretty
    "f05": "mid",
    "f11": "mid",
    "f15": "mid",
    "f16": "mid",
    "f17": "mid",
}

TIER_PHRASE = {
    "school_belle": "T0 school-belle peak",
    "extreme": "T1 extreme beauty",
    "high": "T2 high beauty",
    "mid": "T3 mid neat pretty",
    "low": "T4 low plain",
}

# Soften deliberately-ugly mid faces (keep unique locks, drop "plain/ugly" pressure).
SOFT_FACE: dict[str, str] = {
    "f05": (
        "T3 mid neat pretty classmate: clean square-round face light warm undertone, thin metal round glasses, "
        "neat low black bun, tidy approachable not glamorous idol, average 164cm B-cup, "
        "fresh ordinary-pretty schoolgirl NOT ugly NOT deliberately plain"
    ),
    "f11": (
        "T3 mid cool neat pretty: quiet oval face soft thin lips pale cool skin calm eyes, "
        "ash-gray long straight hair center-part NO bangs, slim 167cm A-cup, "
        "cool understated pretty classmate NOT magazine cover NOT ugly"
    ),
    "f15": (
        "T3 mid cute ordinary-pretty petite adult: soft round adult face bright eyes gentle smile slight baby fat, "
        "pinkish-brown twin tails uneven bangs, extremely short 150cm adult petite AA-cup, "
        "lovable ordinary-pretty classmate NOT glamorous idol, adult 18 not child, MUST NOT look ugly"
    ),
    "f16": (
        "T3 mid natural pretty: light freckles fresh bare-face relaxed half-smile soft features, "
        "loose slightly messy natural black medium hair, average 160cm B-cup, "
        "natural pretty classmate NOT high-glam idol, MUST NOT look ugly"
    ),
    "f17": (
        "T3 mid serious neat pretty: narrow oval face strong brows thin lips clear bare skin serious calm expression, "
        "tight low pure-black ponytail no fringe, 166cm average B-cup slightly longer skirt, "
        "strict neat presentable classmate NOT glamorous, MUST NOT look ugly or rough-skinned"
    ),
}

LOOK_REF_SOFT = {
    "f05": "邻家纪律委员清爽脸（普通好看）",
    "f11": "冷感路人清秀学霸（普通好看）",
    "f15": "邻家娇小可爱普通脸（普通好看）",
    "f16": "素颜自然清爽系（普通好看）",
    "f17": "严肃干练学霸脸（普通好看）",
}

ANTI = (
    "MUST NOT look like Zhao-Jinmai black-bang sweet belle, "
    "MUST NOT have silver/white moon hair, "
    "MUST NOT have thick Korean curtain bangs chocolate-brown waves, "
    "MUST NOT look Ishihara soft dark wavy madonna, "
    "MUST NOT have copper-auburn voluminous curls, "
    "MUST NOT have ash-black blue-tint long elegant hair, "
    "MUST NOT have flax light-brown long dreamy hair, "
    "MUST NOT have black outward-flip bob, "
    "original unique character face NOT celebrity lookalike, MUST remain age 18 adult woman"
)

FIGURE_LABEL = {
    "petite": "娇小",
    "oneesan": "御姐体",
    "athletic_f": "运动",
    "soft_f": "柔软微肉",
    "slim_f": "纤细",
    "tall_slim_f": "高挑纤细",
    "curvy_f": "曲线",
    "average_f": "匀称",
    "plump_f": "微胖丰满",
}


def load_pts() -> tuple[dict[str, int], dict[str, int], dict[str, int]]:
    pers = json.loads(PERS.read_text(encoding="utf-8"))
    beauty = {b["id"]: int(b["charm_pts"]) for b in pers["beauty_tiers"]}
    grade = {g["id"]: int(g["charm_pts"]) for g in pers["grade_tiers"]}
    bust = {c["id"]: int(c["body_charm_pts"]) for c in pers["bust_cups"]}
    return beauty, grade, bust


def compute_charm(s: dict, beauty: dict, grade: dict, bust: dict) -> int:
    bp = beauty.get(s["beauty_tier"], 22)
    gp = grade.get(s["grade_tier"], 12)
    if s.get("gender") == "female":
        body = bust.get(s.get("bust_cup"), 14)
    else:
        male_map = {"athletic_m": 22, "sturdy_m": 18, "average_m": 14, "slim_m": 12}
        body = male_map.get(s.get("figure_archetype"), 14)
    return int(max(1, min(100, bp + body + gp)))


def rewrite_tier_phrase(traits: str, new_tier: str) -> str:
    phrase = TIER_PHRASE[new_tier]
    # Replace common tier lead-ins
    traits = re.sub(
        r"T[0-4]\s+(?:school-belle peak|extreme beauty|high beauty|mid neat pretty|MID ordinary[^.]*|LOW ordinary[^:]*)",
        phrase,
        traits,
        count=1,
        flags=re.I,
    )
    traits = re.sub(
        r"T3 mid neat pretty ONLY deliberately plain[^.]*\.",
        f"{phrase}: ",
        traits,
        count=1,
        flags=re.I,
    )
    return traits


def rebuild_model_prompt(s: dict) -> str:
    look = None
    for line in (s.get("model_prompt_zh") or "").splitlines():
        if line.startswith("外形参考:"):
            look = line.replace("外形参考:", "").strip()
            break
    if s["id"] in LOOK_REF_SOFT:
        look = LOOK_REF_SOFT[s["id"]]
    likes = "、".join(s.get("likes") or [])
    dislikes = "、".join(s.get("dislikes") or [])
    lines = [
        f"{s['name']}｜{s['mbti']}｜{s['speech_style']}｜声线:{s['voice_tone']}",
        f"身材印象:{s['figure_archetype']} 罩杯:{s['bust_cup']} 身高:{s['height_cm']}cm 颜值:{s['beauty_tier']} 魅力:{s['charm']}",
    ]
    if look:
        lines.append(f"外形参考:{look}")
    lines.append(f"价值观:{s['values']}")
    lines.append(f"喜:{likes}；厌:{dislikes}")
    lines.append(s["persona_brief"])
    return "\n".join(lines)


def patch_sprite_traits(s: dict, new_tier: str) -> str:
    sid = s["id"]
    if sid in SOFT_FACE:
        h = s.get("height_cm")
        cup = s.get("bust_cup")
        fig = s.get("figure_archetype")
        body = f"explicit body lock: {h}cm {fig} {cup}-cup under modest Chinese mainland summer school uniform white shirt navy bow navy pleated skirt"
        return (
            f"photoreal Chinese mainland high-school senior woman age 18 adult, {SOFT_FACE[sid]}, "
            f"{body}, {ANTI}"
        )

    traits = s.get("sprite_traits") or ""
    # Map old T-labels
    replacements = [
        (r"T1 extreme beauty", TIER_PHRASE[new_tier] if new_tier != "extreme" else "T1 extreme beauty"),
        (r"T2 high beauty", TIER_PHRASE[new_tier] if new_tier != "high" else "T2 high beauty"),
        (r"T3 MID ordinary[^.]*?(?=:|,)", TIER_PHRASE[new_tier]),
        (r"T4 LOW ordinary[^.]*?(?=:|,)", TIER_PHRASE[new_tier]),
    ]
    if new_tier == "extreme":
        traits = re.sub(r"T2 high beauty", "T1 extreme beauty", traits)
    elif new_tier == "high":
        traits = re.sub(r"T1 extreme beauty", "T2 high beauty", traits)
        # f01/f02/f03 demoted: drop "school-belle-adjacent" if any
        traits = traits.replace("school-belle-adjacent extreme beauty NOT school-belle title", "high campus beauty NOT school-belle")
    return traits


def main() -> None:
    beauty, grade, bust = load_pts()
    data = json.loads(ROSTER.read_text(encoding="utf-8"))
    changed = []
    for s in data["students"]:
        sid = s["id"]
        if sid not in NEW_TIERS:
            continue
        new_tier = NEW_TIERS[sid]
        old = s.get("beauty_tier")
        s["beauty_tier"] = new_tier
        s["sprite_traits"] = patch_sprite_traits(s, new_tier)
        s["charm"] = compute_charm(s, beauty, grade, bust)
        s["model_prompt_zh"] = rebuild_model_prompt(s)
        if old != new_tier:
            changed.append(f"{sid} {old}->{new_tier} charm={s['charm']}")

    ROSTER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Budget
    by_tier: dict[str, list[str]] = {
        "school_belle": [],
        "extreme": [],
        "high": [],
        "mid": [],
        "low": [],
    }
    for sid, t in NEW_TIERS.items():
        by_tier[t].append(sid)
    for k in by_tier:
        by_tier[k].sort()

    budget = json.loads(BUDGET.read_text(encoding="utf-8"))
    fb = budget["female_by_beauty"]
    fb["school_belle"]["ids"] = by_tier["school_belle"]
    fb["extreme"]["ids"] = by_tier["extreme"]
    fb["high"]["ids"] = by_tier["high"]
    fb["mid"]["ids"] = by_tier["mid"]
    fb["low"]["ids"] = by_tier["low"]
    n0, n1, n2, n3, n4 = (len(by_tier[k]) for k in ("school_belle", "extreme", "high", "mid", "low"))
    school = n0 * 80 + n1 * 80 + n2 * 50 + n3 * 30 + n4 * 20
    private = 25 * 20
    budget["totals_estimate"] = {
        "female_school": f"{n0}*80 + {n1}*80 + {n2}*50 + {n3}*30 + {n4}*20 = {school}",
        "female_private": f"25*20 = {private}",
        "female": f"{school} + {private} = {school + private}",
        "male": "10*15 = 150",
        "note": "2026-07-21：按观感重排 T1/T2；取消 T4 丑化，f15/f17 升 mid；标注好看者入 T1",
    }
    BUDGET.write_text(json.dumps(budget, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("changed:")
    for line in changed:
        print(" ", line)
    print("counts:", {k: len(v) for k, v in by_tier.items()})


if __name__ == "__main__":
    main()
