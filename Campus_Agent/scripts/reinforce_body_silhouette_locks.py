# -*- coding: utf-8 -*-
"""Front-load visible body locks (height/figure/bust/weight) into female sprite_traits.

Root cause of identical bodies: face prose dominated the prompt; body was a weak
trailing 'explicit body lock' that image models ignore. This script prepends a
hard FULL-BODY silhouette block and writes weight_kg from height+figure.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "class_roster.json"
CATALOG = ROOT / "data" / "personality_catalog.json"

# BMI-ish anchors by figure → visible weight differences at same height
BMI = {
    "petite": 18.2,
    "slim_f": 18.6,
    "tall_slim_f": 18.4,
    "athletic_f": 20.0,
    "average_f": 20.5,
    "soft_f": 21.6,
    "curvy_f": 21.2,
    "oneesan": 21.0,
    "plump_f": 23.8,
}

FIGURE_VIS = {
    "petite": (
        "petite SHORT adult frame, compact torso, short limbs vs classmates, "
        "adult proportions NOT child, small shoulder span"
    ),
    "slim_f": (
        "slim slender narrow shoulders and hips, flat stomach, thin limbs, "
        "lightweight silhouette"
    ),
    "tall_slim_f": (
        "TALL slim runway-lean build, long legs high hip line, narrow waist, "
        "elongated limbs clearly taller than average classmate"
    ),
    "athletic_f": (
        "athletic toned build, broader shoulders than slim girls, firm limbs, "
        "sporty posture, visible muscle tone under uniform sleeves"
    ),
    "average_f": (
        "average proportional classmate build, neither skinny nor soft-plump, "
        "balanced shoulders-waist-hips"
    ),
    "soft_f": (
        "soft micro-plump healthy curves, soft upper arms and thighs, gentle "
        "rounded waist, soft_f silhouette readable under uniform"
    ),
    "curvy_f": (
        "hourglass-leaning curvy_f, cinched waist vs fuller bust and hips, "
        "clear chest-waist-hip contrast under modest uniform"
    ),
    "oneesan": (
        "mature oneesan silhouette, long legs, fuller chest and hips, "
        "composed upright stance, adult glamorous body presence still in school uniform"
    ),
    "plump_f": (
        "soft plump_f readable soft belly and arms under shirt, rounder hips, "
        "plush thighs, fuller overall volume DISTINCT from slim classmates, adult 18"
    ),
}

CUP_VIS = {
    "AA": (
        "AA-cup nearly flat chest, shirt front almost straight with minimal "
        "breast volume, very small bust MUST be obvious vs fuller-bust classmates"
    ),
    "A": (
        "A-cup small gentle breast curve under white shirt, modest volume, "
        "clearly smaller than B/C/D classmates"
    ),
    "B": (
        "B-cup moderate natural bust, clear soft curve under white shirt and bow, "
        "neither flat nor heavy"
    ),
    "C": (
        "C-cup fuller bust volume pushing shirt slightly, obvious chest presence "
        "vs A/B classmates while still modest school-uniform appropriate"
    ),
    "D": (
        "D-cup noticeably full bust, shirt fabric tension across chest readable, "
        "clearly fuller than C-cup classmates, still modest high-school uniform"
    ),
    "E": (
        "E-cup very full bust clearly fuller and rounder than D-cup classmates, "
        "shirt fabric tension across chest strongly readable, still modest high-school uniform"
    ),
}

FIGURE_ZH = {
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

COLLISION = (
    "MUST NOT copy other classmates face OR body silhouette, "
    "body height/weight/bust/figure MUST match explicit metrics lock above, "
    "original unique character face and body, MUST remain age 18 adult woman"
)


def weight_kg(height_cm: int, figure: str) -> int:
    bmi = BMI.get(figure, 20.5)
    h = height_cm / 100.0
    return max(38, min(75, int(round(bmi * h * h))))


def height_vis(h: int) -> str:
    if h <= 152:
        return (
            f"height {h}cm VERY SHORT vs 162cm class average, full-body framing "
            f"must show much shorter stature and shorter leg length"
        )
    if h <= 158:
        return (
            f"height {h}cm short-below-average vs 162cm classmates, visibly shorter legs"
        )
    if h <= 164:
        return f"height {h}cm near class-average stature (~162cm)"
    if h <= 169:
        return (
            f"height {h}cm above-average tall, longer legs than shorter classmates"
        )
    return (
        f"height {h}cm TALL among classmates, long-leg dominance in full-body shot"
    )


def body_block(s: dict) -> str:
    fig = s["figure_archetype"]
    cup = s["bust_cup"]
    h = int(s["height_cm"])
    w = int(s["weight_kg"])
    return (
        "FULL-BODY head-to-toe mandatory (not portrait crop), "
        "BODY SILHOUETTE LOCK (must visually differ from other classmates): "
        f"{height_vis(h)}, body weight about {w}kg appearance, "
        f"{FIGURE_VIS[fig]}, {CUP_VIS[cup]}, "
        f"explicit metrics lock {h}cm / {fig} / {cup}-cup / ~{w}kg"
    )


def strip_old_body(traits: str) -> str:
    """Remove trailing explicit body lock / keep locked face / weak cup repeats."""
    t = traits
    t = re.sub(r",?\s*keep current locked face", "", t, flags=re.I)
    t = re.sub(r",?\s*explicit body lock:[^,]+(?:,|$)", ",", t, flags=re.I)
    # collapse leftover commas
    t = re.sub(r",\s*,+", ", ", t)
    t = re.sub(r"\s+,", ",", t)
    return t.strip(" ,")


def extract_face_hair(traits: str) -> str:
    """Keep face/hair identity prose; drop leading photoreal boilerplate if present."""
    t = strip_old_body(traits)
    # Drop previous BODY SILHOUETTE if re-run
    t = re.sub(
        r"FULL-BODY head-to-toe mandatory.*?explicit metrics lock[^,]*,\s*",
        "",
        t,
        flags=re.I,
    )
    # Prefer content after first colon following beauty type, else whole string
    m = re.search(
        r"photoreal[^,]*,\s*(?:T[0-4][^:]+:|ABSOLUTE PEAK[^:]+:|inspired by[^:]+:)?\s*(.*)$",
        t,
        flags=re.I,
    )
    if m:
        face = m.group(1).strip(" ,")
    else:
        face = t
    # Remove embedded weak height/cup phrases that fight the new lock? Keep hair/face.
    return face


def rebuild_model_prompt(s: dict, look_zh: str | None = None) -> str:
    likes = "、".join(s.get("likes") or [])
    dislikes = "、".join(s.get("dislikes") or [])
    # keep existing 外形参考 line if present
    old = s.get("model_prompt_zh") or ""
    look = look_zh
    if not look:
        m = re.search(r"外形参考:(.+)", old)
        look = (m.group(1).strip() if m else "").split("\n")[0] or "纯外形锚点"
    return (
        f"{s['name']}｜{s['mbti']}｜{s['speech_style']}｜声线:{s['voice_tone']}\n"
        f"身材印象:{s['figure_archetype']} 罩杯:{s['bust_cup']} 身高:{s['height_cm']}cm "
        f"体重:{s['weight_kg']}kg 颜值:{s['beauty_tier']} 魅力:{s['charm']}\n"
        f"外形参考:{look}\n"
        f"价值观:{s['values']}\n"
        f"喜:{likes}；厌:{dislikes}\n"
        f"{s['persona_brief']}"
    )


def patch_persona_body(s: dict) -> None:
    fig_zh = FIGURE_ZH.get(s["figure_archetype"], s["figure_archetype"])
    cup_zh = f"{s['bust_cup']}罩杯"
    marker = f"外形约{s['height_cm']}cm"
    brief = s.get("persona_brief") or ""
    body_zh = (
        f"外形约{s['height_cm']}cm、{fig_zh}、{cup_zh}、约{s['weight_kg']}kg"
    )
    if "外形约" in brief:
        brief = re.sub(
            r"外形约\d+cm[^。；]*",
            body_zh,
            brief,
            count=1,
        )
    else:
        brief = brief.rstrip("。") + f"；{body_zh}。"
    s["persona_brief"] = brief


def strengthen_catalog() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    stronger = {
        "petite": (
            "FULL-BODY petite SHORT adult Chinese high-school senior woman age 18, "
            "clearly shorter than classmates, small chest AA/A range, adult proportions NOT a child"
        ),
        "oneesan": (
            "FULL-BODY tall mature oneesan Chinese high-school senior woman age 18 adult, "
            "long legs, fuller D-cup bust readable under modest uniform, commanding silhouette"
        ),
        "athletic_f": (
            "FULL-BODY athletic toned Chinese high-school senior woman age 18 adult, "
            "broader sporty shoulders, firm limbs, moderate bust"
        ),
        "soft_f": (
            "FULL-BODY soft micro-plump Chinese high-school senior woman age 18 adult, "
            "soft arms/thighs, gentle curves, fuller C-cup leaning"
        ),
        "slim_f": (
            "FULL-BODY slim slender Chinese high-school senior woman age 18 adult, "
            "narrow frame, flat stomach, modest A/B bust"
        ),
        "tall_slim_f": (
            "FULL-BODY tall slim long-leg Chinese high-school senior woman age 18 adult, "
            "elongated limbs, clearly taller than average classmate"
        ),
        "curvy_f": (
            "FULL-BODY hourglass-leaning curvy Chinese high-school senior woman age 18 adult, "
            "cinched waist, fuller bust and hips under modest school uniform"
        ),
        "average_f": (
            "FULL-BODY average proportional Chinese high-school senior woman age 18 adult, "
            "balanced build neither skinny nor plump"
        ),
        "plump_f": (
            "FULL-BODY soft plump Chinese high-school senior woman age 18 adult, "
            "readable soft belly/arms under uniform, fuller D-cup, DISTINCT from slim classmates, NOT a child"
        ),
    }
    for fig in data.get("figure_archetypes") or []:
        if fig["id"] in stronger:
            fig["sprite_lock"] = stronger[fig["id"]]
    for cup in data.get("bust_cups") or []:
        notes = {
            "AA": "nearly flat AA chest, shirt almost straight, obvious vs fuller busts",
            "A": "small A-cup gentle curve under white shirt",
            "B": "moderate B-cup natural curve under white shirt",
            "C": "fuller C-cup volume, shirt slightly pushed, modest uniform OK",
            "D": "noticeably full D-cup, readable shirt tension, modest high-school uniform",
        }
        if cup["id"] in notes:
            cup["sprite_note"] = notes[cup["id"]]
    style = data.setdefault("sprite_style", {})
    style["body_priority"] = (
        "出图 prompt 必须 FULL-BODY；身高/体型/罩杯/体重外观放在脸部描述之前；"
        "禁止全班同一默认身材；娇小与高挑、AA 与 D、纤细与微胖必须肉眼可辨"
    )
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    strengthen_catalog()
    data = json.loads(ROSTER.read_text(encoding="utf-8"))
    updated = []
    for s in data["students"]:
        if s.get("gender") != "female":
            continue
        fig = s["figure_archetype"]
        s["weight_kg"] = weight_kg(int(s["height_cm"]), fig)
        face = extract_face_hair(s.get("sprite_traits") or "")
        # Remove "NOT celebrity lookalike" noise if present; keep face content
        face = face.replace("NOT celebrity lookalike", "").replace("  ", " ").strip(" ,")
        body = body_block(s)
        s["sprite_traits"] = (
            f"photoreal Chinese mainland high-school senior woman age 18 adult, "
            f"{body}, "
            f"face/hair identity: {face}, "
            f"under modest Chinese mainland summer school uniform white short-sleeve shirt "
            f"navy bow navy pleated skirt white socks black loafers, "
            f"{COLLISION}"
        )
        patch_persona_body(s)
        s["model_prompt_zh"] = rebuild_model_prompt(s)
        updated.append(s["id"])

    ROSTER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("female_updated", len(updated), ",".join(updated))
    # sample body metrics
    by = {s["id"]: s for s in data["students"]}
    for fid in ("f04", "f07", "f15", "f19", "f25", "f12", "f21"):
        s = by[fid]
        print(
            fid,
            s["height_cm"],
            s["figure_archetype"],
            s["bust_cup"],
            s["weight_kg"],
            "body@" + str(s["sprite_traits"].find("BODY SILHOUETTE")),
        )


if __name__ == "__main__":
    main()
