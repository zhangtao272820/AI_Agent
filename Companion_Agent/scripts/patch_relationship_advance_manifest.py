"""One-shot: patch sprite_gen_manifest for T0 advance outfits + neutral C-pack hints/hooks."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "sprite_gen_manifest.json"

T0 = ("xiaoyou", "wanyu", "ruolin", "jingliu", "aili", "linxi")

T0_ADVANCE_HINTS = {
    "bridal": (
        "婚纱进阶：白色或角色色点缀婚纱/轻婚纱+头纱或捧花，全身 VN；"
        "站姿或微侧，可轻提裙摆；浪漫庄重；禁止工作服与露点"
    ),
    "maternity": (
        "怀孕日常：柔软孕妇装或宽松针织裙/家居裙，可见圆润孕肚轮廓；"
        "一手轻抚腹部，居家温柔；禁止紧身情趣与露点"
    ),
    "intimate_lingerie": (
        "情趣内衣档：吊带睡裙或蕾丝内衣套装+丝袜/吊带袜，遮挡充分不露点；"
        "害羞亲昵站姿或坐姿；禁止裸露、性器官与性行为姿势"
    ),
    "intimate_implied": (
        "暗示私密：床单/薄被/手臂遮挡或背影剪影，敏感部位不可辨；"
        "纯黑背景 VN；禁止露点、性器官与性行为姿势"
    ),
}

NEUTRAL_PACK = {
    "shuli": {
        "clothing_forbid": "基图米色高领毛衣深蓝长裙整套轮廓不变",
        "outfit_hints": {
            "casual": "日常便服：开衫+裙或衬衫长裤，仍可捧书；书呆可爱；禁止基图整套不动",
            "work": "图书馆/自习工装：衬衫+背心裙或长裙，可持文件夹；认真",
            "home": "居家：宽松家居T+长裤或家居裙，室内拖鞋；放松",
            "home_sibling": "亲妹居家：家居服捧书坐或靠沙发，圆框眼镜，兄妹日常；禁止恋爱姿势",
            "kitchen_helper": "厨房帮忙：围裙罩在便装外，持碗筷或搅拌勺；生活感",
        },
        "signature_hooks": {"home": "home_sibling", "room": "kitchen_helper"},
    },
    "jingning": {
        "clothing_forbid": "基图学院风外套整套不变",
        "outfit_hints": {
            "casual": "软学院便装：针织开衫+裙，小金花耳饰保留；温和",
            "work": "实习/办公便装：衬衫+半身裙或西裤，平板在手；得体",
            "home": "居家：柔软家居裙或针织家居，耳饰可留；放松",
            "cousin_tea": "堂妹品茶：便装坐姿持茶杯，小金花耳饰；安静旁观感",
            "family_gather": "家族聚会：稍正式连衣裙或套装，微笑站姿；礼貌",
        },
        "signature_hooks": {"home": "cousin_tea", "cafe": "cousin_tea", "office": "family_gather"},
    },
    "youwei": {
        "clothing_forbid": "基图沾颜料卫衣整套不变",
        "outfit_hints": {
            "casual": "美院日常：卫衣或罩衫+短裤/裙，可夹画板；元气学妹",
            "work": "工作室工装：围裙或工作衫沾淡颜料+便裤，持画板；认真",
            "home": "宿舍居家：宽松T+短裤，速写本；放松",
            "studio_junior": "画室学妹：工装站画架旁，画笔/画板在手；仰慕认真",
            "sketch_share": "递速写本共看：便装，双手捧开速写本朝观众侧；害羞分享",
        },
        "signature_hooks": {"home": "sketch_share", "office": "studio_junior", "campus": "studio_junior"},
    },
    "yuxi": {
        "clothing_forbid": "基图店员围裙整套不变",
        "outfit_hints": {
            "casual": "死党便装：马尾+夹克或卫衣+牛仔裤；干脆利落",
            "work": "咖啡店员：围裙+衬衫工装，可持托盘；职业",
            "home": "居家：宽松家居T+短裤；放松",
            "cafe_bestie": "咖啡馆死党：店员围裙或便装，叉腰或端杯；爽朗",
            "school_memory": "高中回忆便装：校服风衬衫+短裙或运动外套，可持旧相册道具级；怀旧",
        },
        "signature_hooks": {"cafe": "cafe_bestie", "campus": "school_memory", "home": "cafe_bestie"},
    },
    "lingke": {
        "clothing_forbid": "基图衬衫西裤工牌整套不变",
        "outfit_hints": {
            "casual": "研究生便装：衬衫+牛仔裤或半身裙，可无工牌；干练",
            "work": "助教工装：衬衫西裤+胸前工牌，夹文件夹；锐利",
            "home": "居家：宽松衬衫+家居裤；放松仍挺直",
            "ta_office": "助教办公室：衬衫工牌，持文件夹或平板，靠桌站姿；专业",
            "lecture_assist": "课堂协助：工装，可持讲义或激光笔道具级；专注",
        },
        "signature_hooks": {"office": "ta_office", "campus": "lecture_assist", "home": "ta_office"},
    },
    "aichen": {
        "clothing_forbid": "基图大地色大衣襟花整套不变",
        "outfit_hints": {
            "casual": "闺蜜便装：大地色针织+裙或大衣敞开，可小襟花；温柔",
            "work": "花店帮忙：围裙罩便装，可持小花束；亲切",
            "home": "居家：柔软家居裙或针织；放松",
            "flower_chat": "花店闲聊：便装/围裙，持小花束或花剪；闺蜜感",
            "girls_night": "闺蜜夜：稍精致连衣裙或家居派对装，持饮料杯道具级；轻松",
        },
        "signature_hooks": {"store": "flower_chat", "cafe": "girls_night", "home": "girls_night"},
    },
}

NEW_OUTFITS = [
    {"id": "season_spring", "label": "春装"},
    {"id": "season_summer", "label": "夏装"},
    {"id": "season_autumn", "label": "秋装"},
    {"id": "season_winter", "label": "冬装"},
    {"id": "intimate_lounge", "label": "私密·软"},
    {"id": "intimate_lingerie", "label": "私密·内衣"},
    {"id": "intimate_implied", "label": "私密·暗示"},
    {"id": "bridal", "label": "婚纱"},
    {"id": "maternity", "label": "怀孕日常"},
]


def main() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    outfits = data.setdefault("outfits", [])
    have = {o.get("id") for o in outfits if isinstance(o, dict)}
    for o in NEW_OUTFITS:
        if o["id"] not in have:
            outfits.append(o)
            have.add(o["id"])

    chars = data.setdefault("characters", {})
    for cid in T0:
        pack = chars.get(cid)
        if not isinstance(pack, dict):
            continue
        hints = pack.setdefault("outfit_hints", {})
        for k, v in T0_ADVANCE_HINTS.items():
            hints[k] = v

    for cid, meta in NEUTRAL_PACK.items():
        pack = chars.get(cid)
        if not isinstance(pack, dict):
            continue
        if meta.get("clothing_forbid") and not pack.get("clothing_forbid"):
            pack["clothing_forbid"] = meta["clothing_forbid"]
        hints = pack.setdefault("outfit_hints", {})
        for k, v in meta["outfit_hints"].items():
            hints[k] = v
        pack["signature_hooks"] = dict(meta["signature_hooks"])

    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("patched", MANIFEST)


if __name__ == "__main__":
    main()
