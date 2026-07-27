# -*- coding: utf-8 -*-
"""Polish incomplete female roster looks: celebrity refs + explicit bust cups."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "class_roster.json"

# Skip regenerating full packs later; still polish SSOT text for cups/refs.
# look_ref is Chinese celeb inspiration for sprite prompts (not legal likeness).
POLISH: dict[str, dict] = {
    "f01": {
        "look_tag": "cn_zhangruonan_soft",
        "look_ref": "章若楠式温柔清秀",
        "hair": "long soft ink-black hair, gentle middle-ish part",
        "sprite_extra": "inspired by Zhang Ruonan soft youth beauty: gentle oval face soft eyes fresh fair skin, long soft ink-black hair, slim 162cm A-cup small bust readable under shirt, soft shy school-belle-adjacent extreme beauty NOT school-belle title",
    },
    "f02": {
        "look_tag": "uyghur_dilireba_athletic",
        "look_ref": "迪丽热巴式明艳异域",
        "hair": "glossy amber-chestnut high ponytail",
        "sprite_extra": "Dilireba-like exotic Chinese Uyghur-heritage beauty: deep-set bright eyes high elegant nose warm wheat skin, glossy amber-chestnut high ponytail, athletic graceful 165cm B-cup moderate bust, radiant smile",
    },
    "f03": {
        "look_tag": "cn_zhouye_calm",
        "look_ref": "周也式清冷学霸脸",
        "hair": "long straight ink-black hair",
        "sprite_extra": "inspired by Zhou Ye refined calm beauty: elegant oval face calm eyes long straight ink-black hair, tall slim 168cm B-cup moderate bust, reserved elegant aura magazine quality NOT school-belle title",
    },
    "f04": {
        "look_tag": "cn_zhangzifeng_petite",
        "look_ref": "张子枫式元气娇小",
        "hair": "short wavy ginger-orange hair with bangs",
        "sprite_extra": "inspired by Zhang Zifeng youthful energetic petite adult: round freckled face short wavy ginger-orange hair with bangs, DISTINCTLY petite 152cm AA-cup very small bust flat chest readable, adult proportions NOT child",
    },
    "f05": {
        "look_tag": "cn_ordinary_glasses",
        "look_ref": "邻家纪律委员脸（非明星脸）",
        "hair": "neat low black bun",
        "sprite_extra": "ordinary neat Chinese classmate NOT idol: square-round face thin metal-frame glasses neat low black bun yellowish undertone, average 164cm B-cup moderate bust, upright tidy mid beauty",
    },
    "f06": {
        "look_tag": "cn_zhou_dongyu_artsy",
        "look_ref": "周冬雨式文艺短发",
        "hair": "ash-purple-brown bob with thick bangs",
        "sprite_extra": "inspired by Zhou Dongyu artsy delicate look: monolid thin brows quiet artsy face, ash-purple-brown bob with thick bangs, petite slim 155cm A-cup small bust, delicate NOT cute-idol",
    },
    "f07": {
        "look_tag": "tibetan_ni_ni_oneesan",
        "look_ref": "倪妮式高骨相御姐",
        "hair": "ink-black long hair with delicate side braid soft auburn sheen",
        "sprite_extra": "inspired by Ni Ni high-cheekbone elegant oneesan: refined high cheekbones elongated phoenix eyes, ink-black long hair delicate side braid soft auburn sheen, tall 170cm D-cup fuller bust readable under modest shirt, commanding mature-vibe adult 18",
    },
    "f08": {
        "look_tag": "cn_yangzi_soft",
        "look_ref": "杨紫式软萌照顾型",
        "hair": "soft shoulder-length warm-black hair",
        "sprite_extra": "inspired by Yang Zi warm soft caring look: round almond eyes gentle smile, soft shoulder-length warm-black hair, soft_f 161cm C-cup fuller bust soft rounded waistline motherly silhouette under uniform",
    },
    "f09": {
        "look_tag": "kazakh_gulinazha_leader",
        "look_ref": "古力娜扎式明媚班长",
        "hair": "honey-gold long wavy hair to waist",
        "sprite_extra": "inspired by Guli Nazha open bright beauty: open refined features luminous warm skin bright smiling eyes, honey-gold long wavy hair to waist, slim graceful 166cm B-cup moderate bust, warm leader presence",
    },
    "f10": {
        "look_tag": "cn_liyitong_witty",
        "look_ref": "李一桐式灵动嘴贫",
        "hair": "sleek pure-black high ponytail with wolf-tail ends",
        "sprite_extra": "inspired by Li Yitong witty athletic look: square jaw playful squinted eyes, sleek pure-black high ponytail wolf-tail ends, athletic shoulders 163cm B-cup moderate bust, NOT amber hair NOT Uyghur features",
    },
    "f11": {
        "look_tag": "cn_aloof_ash",
        "look_ref": "冷感路人学霸脸（非偶像）",
        "hair": "ash-gray long straight hair no bangs",
        "sprite_extra": "aloof ordinary mid beauty NOT idol: ash-gray long straight hair no bangs, slim 167cm A-cup small bust, flat blank cool distant eyes mid classmate face",
    },
    "f12": {
        "look_tag": "dai_zhaolusi_sociable",
        "look_ref": "赵露思式甜美社交",
        "hair": "voluminous copper-auburn curly hair",
        "sprite_extra": "inspired by Zhao Lusi soft sociable beauty: soft rounded pretty jaw glowing honey skin, voluminous copper-auburn curly hair, soft curvy 164cm C-cup fuller bust hourglass-leaning under modest uniform, dazzling smile",
    },
    "f13": {
        "look_tag": "cn_cool_short_wolf",
        "look_ref": "金晨式酷感短发",
        "hair": "ultra-short ink-black wolf cut",
        "sprite_extra": "inspired by Jin Chen cool short-hair look: ultra-short ink-black wolf cut, thin lips cool face small beauty mark near mouth, tall 169cm athletic narrow hips B-cup moderate bust",
    },
    "f14": {
        "look_tag": "chaoxian_mengziyi_elegant",
        "look_ref": "孟子义式清贵文静",
        "hair": "cool ash-black long straight side-part faint blue-gray tint",
        "sprite_extra": "inspired by Meng Ziyi elegant quiet beauty: refined oval face slender fox eyes porcelain luminous skin, cool ash-black long straight side-part faint blue-gray tint, slim poetic 165cm B-cup moderate bust, quieter cooler than Su Wanqing",
    },
    "f15": {
        "look_tag": "plain_petite_playful",
        "look_ref": "邻家娇小普通脸（非明星）",
        "hair": "pinkish-brown twin tails",
        "sprite_extra": "plain low-beauty playful petite adult: round soft adult face slight baby fat slightly uneven teeth, pinkish-brown twin tails, EXTREMELY short 150cm AA-cup very small bust, adult proportions NOT child NON-idol",
    },
    "f16": {
        "look_tag": "cn_natural_messy",
        "look_ref": "周也素颜自然系（淡化妆感）",
        "hair": "loose slightly messy natural black medium hair",
        "sprite_extra": "natural mid beauty bare-faced relaxed: loose slightly messy natural black medium hair light freckles, average 160cm B-cup moderate bust, ordinary classmate NOT idol",
    },
    "f17": {
        "look_tag": "plain_strict",
        "look_ref": "严肃普通学霸脸（非明星）",
        "hair": "tight low pure-black ponytail",
        "sprite_extra": "strict plain low beauty NON-idol: tight low pure-black ponytail narrow long face heavy brows thin lips serious bare face rough skin texture, 166cm average B-cup moderate bust stiff upright slightly longer skirt hem",
    },
    "f18": {
        "look_tag": "cn_tianxiwei_dreamy",
        "look_ref": "田曦薇式梦幻感",
        "hair": "flax light-brown long straight center-part hair",
        "sprite_extra": "inspired by Tian Xiwei dreamy soft beauty: half-lidded dreamy eyes soft light makeup feel, flax light-brown long straight center-part hair, slim 163cm A-cup small bust, NOT honey-gold waves NOT copper curls",
    },
    "f19": {
        "look_tag": "cn_liushishi_cold",
        "look_ref": "刘诗诗式冷感御姐",
        "hair": "ice-straight long black hair",
        "sprite_extra": "inspired by Liu Shishi cold elegant oneesan: ice-straight long black hair, tall 172cm D-cup fuller bust, cold beauty commanding calm aura, extreme beauty NOT labeled school belle",
    },
    "f20": {
        "look_tag": "cn_yushuxin_sunny",
        "look_ref": "虞书欣式阳光热心",
        "hair": "medium-short black hair with outward flip waves",
        "sprite_extra": "inspired by Yu Shuxin sunny energetic look: round face light sun-kissed cheeks bright laughing teeth smile, medium-short black hair outward flip waves, healthy soft 162cm C-cup fuller bust soft_f silhouette",
    },
    "f25": {
        "look_tag": "cn_plump_babyface",
        "look_ref": "沈月式圆脸黏人感（微胖）",
        "hair": "warm black soft bob with rounded bangs",
        "sprite_extra": "inspired by Shen Yue round cute adult babyface with plump soft body: soft round adult cheeks, warm black soft bob rounded bangs, distinctly soft plump readable under uniform soft belly/arms, fuller D-cup bust, 156cm high beauty NOT school-belle, adult proportions NOT child",
    },
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

CUP_EN = {
    "AA": "AA-cup very small bust",
    "A": "A-cup small bust",
    "B": "B-cup moderate bust",
    "C": "C-cup fuller bust",
    "D": "D-cup noticeably full bust",
    "E": "E-cup very full bust",
}


def rebuild_model_prompt(s: dict, look_ref: str | None) -> str:
    name = s["name"]
    lines = [
        f"{name}｜{s['mbti']}｜{s['speech_style']}｜声线:{s['voice_tone']}",
        f"身材印象:{s['figure_archetype']} 罩杯:{s['bust_cup']} 身高:{s['height_cm']}cm 颜值:{s['beauty_tier']} 魅力:{s['charm']}",
    ]
    if look_ref:
        lines.append(f"外形参考:{look_ref}")
    likes = "、".join(s.get("likes") or [])
    dislikes = "、".join(s.get("dislikes") or [])
    lines.append(f"价值观:{s['values']}")
    lines.append(f"喜:{likes}；厌:{dislikes}")
    lines.append(s["persona_brief"])
    return "\n".join(lines)


def build_sprite_traits(s: dict, extra: str) -> str:
    cup = s["bust_cup"]
    fig = s["figure_archetype"]
    h = s["height_cm"]
    base = (
        f"photoreal Chinese mainland high-school senior woman age 18 adult, "
        f"{extra}, "
        f"explicit body lock: {h}cm {fig} figure with {CUP_EN[cup]} under modest Chinese mainland summer school uniform, "
        f"magazine-appropriate photoreal, MUST remain age 18 adult woman"
    )
    return base


def main() -> None:
    data = json.loads(ROSTER.read_text(encoding="utf-8"))
    updated = []
    for s in data["students"]:
        pid = s["id"]
        if pid not in POLISH:
            # Still ensure model_prompt has 罩杯 for school belles etc.
            if s.get("gender") == "female" and s.get("bust_cup"):
                # extract look_ref from persona if already polished school belle
                look_ref = None
                if "赵今麦" in (s.get("persona_brief") or ""):
                    look_ref = "赵今麦式清甜"
                elif "石原里美" in (s.get("persona_brief") or ""):
                    look_ref = "石原里美式柔和优雅"
                elif "张员瑛" in (s.get("persona_brief") or "") or "金智媛" in (s.get("persona_brief") or ""):
                    look_ref = "张员瑛/金智媛式韩系偶像"
                elif "银月" in (s.get("persona_brief") or "") or "凤眼" in (s.get("persona_brief") or ""):
                    look_ref = "中国银月白发清冷"
                s["model_prompt_zh"] = rebuild_model_prompt(s, look_ref)
                # ensure cup appears in sprite_traits if missing
                if f"{s['bust_cup']}-cup" not in s.get("sprite_traits", "") and f"{s['bust_cup']} cup" not in s.get("sprite_traits", "").lower():
                    s["sprite_traits"] = (
                        s["sprite_traits"].rstrip(".")
                        + f", explicit body lock {s['height_cm']}cm {s['figure_archetype']} {CUP_EN[s['bust_cup']]}"
                    )
                updated.append(pid)
            continue

        p = POLISH[pid]
        s["look_tag"] = p["look_tag"]
        if "hair" in p:
            s["hair"] = p["hair"]
        s["sprite_traits"] = build_sprite_traits(s, p["sprite_extra"])
        # Ensure persona mentions cup once if missing
        cup_zh = f"{s['bust_cup']}罩杯"
        fig_zh = FIGURE_LABEL.get(s["figure_archetype"], s["figure_archetype"])
        brief = s.get("persona_brief") or ""
        if cup_zh not in brief and f"{s['bust_cup']}罩" not in brief:
            s["persona_brief"] = (
                f"{brief.rstrip('。')}；外形约{s['height_cm']}cm、{fig_zh}、{cup_zh}。"
            )
        if p["look_ref"] and p["look_ref"] not in s["persona_brief"]:
            s["persona_brief"] = f"{p['look_ref']}。{s['persona_brief']}"
        s["model_prompt_zh"] = rebuild_model_prompt(s, p["look_ref"])
        updated.append(pid)

    ROSTER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("updated", len(updated), ",".join(updated))


if __name__ == "__main__":
    main()
