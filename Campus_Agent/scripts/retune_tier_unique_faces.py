# -*- coding: utf-8 -*-
"""Retune sprite_traits: tier-accurate beauty, unique faces, celeb vibe only."""
from __future__ import annotations

import json
from pathlib import Path

ROSTER = Path(r"e:\Agent\Campus_Agent\data\class_roster.json")

# Keep sprites: f12 f14 f18 f20 f21–f24. Still soft-update copy to "灵感参考".
KEEP_SPRITES = {"f12", "f14", "f18", "f20", "f21", "f22", "f23", "f24"}

ANTI = (
    "MUST NOT look like Zhao-Jinmai black-bang sweet belle, "
    "MUST NOT have silver/white moon hair, "
    "MUST NOT have thick Korean curtain bangs chocolate-brown waves, "
    "MUST NOT look Ishihara soft dark wavy madonna, "
    "MUST NOT have copper-auburn voluminous curls, "
    "MUST NOT have ash-black blue-tint long elegant hair, "
    "MUST NOT have flax light-brown long dreamy hair, "
    "MUST NOT have black outward-flip bob, "
    "original unique character face NOT celebrity lookalike"
)

# id -> (look_tag, look_ref_zh, hair, unique_face_block)
# beauty_level phrase embedded in unique_face_block
FACE: dict[str, tuple[str, str, str, str]] = {
    "f01": (
        "soft_literary_black",
        "温柔清秀文学感（灵感非复刻）",
        "long soft slightly wavy ink-black hair with thin wispy bangs",
        "T1 extreme beauty soft literary type: gentle oval face soft downturned eyes shy sweet smile freckle-free fair skin, "
        "long soft slightly wavy ink-black hair thin wispy bangs, slim 162cm A-cup small bust, quiet bookish glamour",
    ),
    "f02": (
        "uyghur_ponytail_radiant",
        "明艳高马尾异域感（灵感非复刻）",
        "glossy amber-chestnut high ponytail",
        "T1 extreme beauty radiant athletic exotic type: deep-set bright eyes high nose bridge warm wheat skin, "
        "glossy amber-chestnut HIGH PONYTAIL only, athletic 165cm B-cup, bright open laugh",
    ),
    "f03": (
        "calm_scholar_straight",
        "清冷直发学霸感（灵感非复刻）",
        "waist-length ice-straight pure ink-black hair no bangs",
        "T1 extreme beauty cool scholar type: refined longish oval face calm narrow eyes light makeup, "
        "waist-length ice-straight pure ink-black hair NO bangs tucked behind ear, tall slim 168cm B-cup, polite distant aura",
    ),
    "f04": (
        "ginger_bob_energetic",
        "橘红短发元气娇小（灵感非复刻）",
        "short wavy ginger-orange bob with choppy bangs",
        "T2 high beauty energetic petite type: round freckled face bright grin, "
        "short wavy ginger-orange bob choppy bangs, DISTINCTLY short 152cm adult petite AA-cup flat small chest, NOT child",
    ),
    "f05": (
        "glasses_bun_ordinary",
        "眼镜低丸子邻家纪律感（非明星）",
        "neat low black bun with thin metal round glasses",
        "T3 MID ordinary classmate beauty ONLY: square-round plain face yellowish undertone, thin metal round glasses, "
        "neat low black bun, tidy but NOT pretty idol, average 164cm B-cup, MUST look ordinary mid not high beauty",
    ),
    "f06": (
        "ash_purple_bob_artsy",
        "灰紫波波头文艺（灵感非复刻）",
        "ash-purple-brown chin-length bob with thick straight bangs",
        "T2 high beauty quiet artsy type: monolid thin brows small mouth delicate face, "
        "ash-purple-brown chin-length bob thick straight bangs, petite 155cm A-cup, muted cool vibe NOT cute idol smile",
    ),
    "f07": (
        "sidebraid_phoenix_oneesan",
        "侧辫高骨相御姐（灵感非复刻）",
        "ink-black long hair with thin side braid soft auburn sheen",
        "T1 extreme beauty commanding oneesan type: high cheekbones elongated phoenix eyes sharp elegant nose, "
        "ink-black long hair thin SIDE BRAID soft auburn sheen, tall 170cm oneesan fuller D-cup silhouette, cool authority",
    ),
    "f08": (
        "warm_shoulder_soft",
        "暖黑肩发柔软照顾型（灵感非复刻）",
        "warm black soft shoulder-length with rounded soft bangs",
        "T2 high beauty warm soft caring type: round almond eyes gentle closed-lip smile, "
        "warm black soft shoulder-length rounded soft bangs, soft_f 161cm C-cup fuller soft silhouette",
    ),
    "f09": (
        "honey_wave_leader",
        "蜜金长卷班长明媚（灵感非复刻）",
        "honey-gold long loose waves to waist center part",
        "T1 extreme beauty bright leader type: open large smiling eyes luminous warm skin, "
        "honey-gold long loose waves to waist center part, slim 166cm B-cup, confident class-monitor presence",
    ),
    "f10": (
        "wolftail_witty",
        "黑狼尾马尾灵动（灵感非复刻）",
        "sleek pure-black high ponytail with wolf-cut layered ends",
        "T2 high beauty witty athletic type: square-ish jaw playful squinted fox eyes, "
        "sleek pure-black high ponytail wolf-cut layered ends, athletic 163cm B-cup, mischievous smirk",
    ),
    "f11": (
        "ash_straight_blank",
        "烟灰直发冷感路人（非偶像）",
        "ash-gray long straight hair center-part no bangs",
        "T3 MID ordinary beauty ONLY deliberately plain-pretty-low: flat blank expression thin lips pale cool skin, "
        "ash-gray long straight hair center-part NO bangs, slim 167cm A-cup, MUST NOT look idol or magazine beauty, "
        "classmate mid face with slight plainness",
    ),
    "f13": (
        "ultrashort_wolf_cool",
        "超短狼尾酷感（灵感非复刻）",
        "ultra-short ink-black textured wolf cut",
        "T2 high beauty cool sporty type: sharp cool eyes thin lips small beauty mark near mouth corner, "
        "ultra-short ink-black textured wolf cut, tall 169cm athletic narrow hips B-cup, stoic cool face",
    ),
    "f15": (
        "twintail_plain_petite",
        "粉棕双马尾普通娇小（非明星）",
        "pinkish-brown twin tails with uneven bangs",
        "T4 LOW ordinary beauty ONLY: soft round adult face slightly uneven teeth plain features low attractiveness, "
        "pinkish-brown twin tails uneven bangs, extremely short 150cm adult petite AA-cup, "
        "MUST look plain ordinary NOT cute idol NOT pretty, adult 18 not child",
    ),
    "f16": (
        "messy_natural_mid",
        "微乱黑发素颜自然（非偶像）",
        "loose slightly messy natural black medium hair",
        "T3 MID ordinary natural beauty ONLY: light freckles bare face relaxed half-smile ordinary features, "
        "loose slightly messy natural black medium hair, average 160cm B-cup, "
        "MUST look natural mid classmate NOT high beauty idol",
    ),
    "f17": (
        "tight_ponytail_strict",
        "紧低马尾严肃普通（非明星）",
        "tight low pure-black ponytail no fringe",
        "T4 LOW ordinary beauty ONLY: narrow long face heavy thick brows thin lips rough bare skin serious expression, "
        "tight low pure-black ponytail no fringe, 166cm average B-cup slightly longer skirt, "
        "MUST look plain strict ordinary NOT pretty",
    ),
    "f19": (
        "icestraight_cold_oneesan",
        "冰直黑发冷感御姐（灵感非复刻）",
        "ice-straight waist-length pure black hair center part",
        "T1 extreme beauty cold oneesan type: sharp elegant oval face cool half-lidded eyes pale porcelain skin, "
        "ice-straight waist-length pure black hair center part, tall 172cm fuller D-cup oneesan silhouette, icy calm",
    ),
    "f25": (
        "roundbob_plump_soft",
        "圆脸软波波微胖（灵感非复刻）",
        "warm black soft rounded bob with thick rounded bangs",
        "T2 high beauty plump soft cute type: soft round adult cheeks bright eyes friendly plush smile, "
        "warm black soft rounded bob thick rounded bangs, 156cm plump_f fuller D-cup soft silhouette readable, adult 18",
    ),
}

CUP_EN = {
    "AA": "AA-cup very small bust",
    "A": "A-cup small bust",
    "B": "B-cup moderate bust",
    "C": "C-cup fuller bust",
    "D": "D-cup noticeably full bust",
}

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


def rebuild_model_prompt(s: dict, look_ref: str) -> str:
    likes = "、".join(s.get("likes") or [])
    dislikes = "、".join(s.get("dislikes") or [])
    return "\n".join(
        [
            f"{s['name']}｜{s['mbti']}｜{s['speech_style']}｜声线:{s['voice_tone']}",
            f"身材印象:{s['figure_archetype']} 罩杯:{s['bust_cup']} 身高:{s['height_cm']}cm 颜值:{s['beauty_tier']} 魅力:{s['charm']}",
            f"外形参考:{look_ref}（灵感非撞脸复刻）",
            f"价值观:{s['values']}",
            f"喜:{likes}；厌:{dislikes}",
            s["persona_brief"],
        ]
    )


def main() -> None:
    data = json.loads(ROSTER.read_text(encoding="utf-8"))
    updated = []
    for s in data["students"]:
        pid = s["id"]
        if pid not in FACE and pid not in KEEP_SPRITES:
            continue
        if pid in FACE:
            tag, ref, hair, face = FACE[pid]
            s["look_tag"] = tag
            s["hair"] = hair
            cup = s["bust_cup"]
            s["sprite_traits"] = (
                f"photoreal Chinese mainland high-school senior woman age 18 adult, "
                f"{face}, "
                f"explicit body lock: {s['height_cm']}cm {s['figure_archetype']} {CUP_EN[cup]} "
                f"under modest Chinese mainland summer school uniform white shirt navy bow navy pleated skirt, "
                f"{ANTI}, MUST remain age 18 adult woman"
            )
            cup_zh = f"{cup}罩杯"
            fig_zh = FIGURE_LABEL.get(s["figure_archetype"], s["figure_archetype"])
            # strip old celeb-clone prefix if present
            brief = s.get("persona_brief") or ""
            for old in (
                "章若楠式温柔清秀。",
                "迪丽热巴式明艳异域。",
                "周也式清冷学霸脸。",
                "张子枫式元气娇小。",
                "邻家纪律委员脸（非明星脸）。",
                "周冬雨式文艺短发。",
                "倪妮式高骨相御姐。",
                "杨紫式软萌照顾型。",
                "古力娜扎式明媚班长。",
                "李一桐式灵动嘴贫。",
                "冷感路人学霸脸（非偶像）。",
                "金晨式酷感短发。",
                "邻家娇小普通脸（非明星）。",
                "周也素颜自然系（淡化妆感）。",
                "严肃普通学霸脸（非明星）。",
                "刘诗诗式冷感御姐。",
                "沈月式圆脸黏人感（微胖）。",
            ):
                brief = brief.replace(old, "")
            if "外形约" not in brief:
                brief = brief.rstrip("。") + f"；外形约{s['height_cm']}cm、{fig_zh}、{cup_zh}。"
            s["persona_brief"] = f"{ref}。{brief}" if not brief.startswith(ref) else brief
            s["model_prompt_zh"] = rebuild_model_prompt(s, ref)
            updated.append(pid)
        elif pid in KEEP_SPRITES:
            # soft rewrite look_ref wording only in model_prompt
            ref_map = {
                "f12": "甜美社交曲线（灵感非复刻）",
                "f14": "清贵文静长发（灵感非复刻）",
                "f18": "亚麻长发梦幻（灵感非复刻）",
                "f20": "外翻短发阳光（灵感非复刻）",
                "f21": "中系明艳清甜·墨黑直长发浅刘海·通透瓷肌亮瞳",
                "f22": "中系清冷仙气·银月白直发细长凤眼·冷玉肤",
                "f23": "韩系第一视觉·厚帘幕刘海玻璃肌小V脸·巧克力棕柔波",
                "f24": "日系柔美优雅·深棕侧分柔波杏眼·清透健康肌",
            }
            ref = ref_map[pid]
            # keep sprite_traits but append anti-lookalike note
            if "NOT celebrity lookalike" not in s.get("sprite_traits", ""):
                s["sprite_traits"] = (
                    s["sprite_traits"].rstrip(".")
                    + ", original unique character NOT celebrity lookalike, keep current locked face"
                )
            s["model_prompt_zh"] = rebuild_model_prompt(s, ref)
            updated.append(pid)

    ROSTER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("updated", ",".join(updated))
    print("regen_needed", ",".join(sorted(FACE)))


if __name__ == "__main__":
    main()
