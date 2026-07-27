"""酒馆目录：酒品与角色（种类尽量丰富，供矩阵组合）。"""

from typing import Literal, TypedDict


class WineDef(TypedDict):
    id: str
    name: str
    tagline: str
    abv_hint: str  # 展示用酒精暗示，参与叙事而非精确计算
    flavor_notes: str


class WineStats(TypedDict):
    """酒品四维面板（1–10），与醉酒矩阵无关，仅供 UI / 图鉴展示。"""

    potency: int  # 烈度：酒精冲击力、上头感
    sweetness: int  # 甜度：残糖/味觉甜感（苦啤、伏特加偏低）
    complexity: int  # 层次：风味层次与余韵复杂度
    legend: int  # 传奇：叙事氛围、辨识度与「酒馆传说」感


# API 与前端展示用中文名（顺序固定）
WINE_STAT_LABELS: dict[str, str] = {
    "potency": "烈度",
    "sweetness": "甜度",
    "complexity": "层次",
    "legend": "传奇",
}

# 依据品类、风味文案与 abv_hint 人工标定（可按口味再调）
WINE_STATS_BY_ID: dict[str, WineStats] = {
    "baijiu_erguo": {"potency": 9, "sweetness": 2, "complexity": 4, "legend": 6},
    "baijiu_maotai": {"potency": 9, "sweetness": 3, "complexity": 10, "legend": 10},
    "whisky_islay": {"potency": 8, "sweetness": 2, "complexity": 9, "legend": 8},
    "whisky_sherry": {"potency": 7, "sweetness": 7, "complexity": 9, "legend": 7},
    "vodka": {"potency": 9, "sweetness": 1, "complexity": 3, "legend": 5},
    "red_wine": {"potency": 6, "sweetness": 3, "complexity": 8, "legend": 7},
    "beer_ipa": {"potency": 5, "sweetness": 2, "complexity": 6, "legend": 5},
    "beer_lager": {"potency": 4, "sweetness": 2, "complexity": 3, "legend": 3},
    "umeshu": {"potency": 5, "sweetness": 8, "complexity": 5, "legend": 6},
    "sake_daiginjo": {"potency": 5, "sweetness": 4, "complexity": 8, "legend": 7},
    "champagne": {"potency": 6, "sweetness": 4, "complexity": 8, "legend": 9},
    "tequila": {"potency": 9, "sweetness": 2, "complexity": 5, "legend": 8},
    "rum_spiced": {"potency": 7, "sweetness": 8, "complexity": 7, "legend": 7},
    "brandy_vsop": {"potency": 8, "sweetness": 5, "complexity": 9, "legend": 8},
    "huangjiu": {"potency": 5, "sweetness": 4, "complexity": 7, "legend": 6},
    "absinthe_style": {"potency": 10, "sweetness": 2, "complexity": 9, "legend": 10},
    "guihua": {"potency": 3, "sweetness": 7, "complexity": 4, "legend": 5},
    "cocktail_old_fashioned": {"potency": 8, "sweetness": 3, "complexity": 8, "legend": 8},
}

_DEFAULT_WINE_STAT: WineStats = {"potency": 5, "sweetness": 5, "complexity": 5, "legend": 5}


def get_wine_stats(wine_id: str) -> WineStats:
    return WINE_STATS_BY_ID.get(wine_id, _DEFAULT_WINE_STAT)


class CharacterDef(TypedDict):
    id: str
    name: str
    role: str
    archetype: Literal["理性", "感性", "莽", "文艺", "神秘", "市井"]
    catchphrase: str
    # 生图专用：英文职业装扮/道具，强制与其它角色区分（避免撞脸）
    visual_en: str


WINES: list[WineDef] = [
    {"id": "baijiu_erguo", "name": "二锅头", "tagline": "一口上头，两句真理", "abv_hint": "高", "flavor_notes": "辛辣、粮食香"},
    {"id": "baijiu_maotai", "name": "飞天茅台", "tagline": "酱香科技，友谊涨价", "abv_hint": "高", "flavor_notes": "酱香、焦糊、回味长"},
    {"id": "whisky_islay", "name": "艾雷岛威士忌", "tagline": "泥煤怪兽，吞云吐雾", "abv_hint": "中高", "flavor_notes": "泥煤、海风、消毒水味"},
    {"id": "whisky_sherry", "name": "雪莉桶威士忌", "tagline": "干果蜜饯，甜到报警", "abv_hint": "中高", "flavor_notes": "葡萄干、巧克力、橡木"},
    {"id": "vodka", "name": "冰冻伏特加", "tagline": "情绪清零，逻辑格式化", "abv_hint": "高", "flavor_notes": "极净、冷冽"},
    {"id": "red_wine", "name": "勃艮第黑皮诺", "tagline": "酸涩人生，优雅崩溃", "abv_hint": "中", "flavor_notes": "莓果、土壤、单宁"},
    {"id": "beer_ipa", "name": "双倍IPA精酿", "tagline": "苦得像周一，泡沫像希望", "abv_hint": "中", "flavor_notes": "啤酒花、柑橘、苦"},
    {"id": "beer_lager", "name": "工业拉格", "tagline": "寡淡但真诚", "abv_hint": "低中", "flavor_notes": "清爽、麦芽"},
    {"id": "umeshu", "name": "梅子酒", "tagline": "酸甜口的撒娇", "abv_hint": "低中", "flavor_notes": "梅子、蜂蜜"},
    {"id": "sake_daiginjo", "name": "大吟酿清酒", "tagline": "米香绕舌，礼貌发疯", "abv_hint": "中低", "flavor_notes": "花果、米旨"},
    {"id": "champagne", "name": "香槟", "tagline": "气泡审判一切", "abv_hint": "中", "flavor_notes": "酵母、白色水果"},
    {"id": "tequila", "name": "龙舌兰shot", "tagline": "盐、柠檬、后悔三件套", "abv_hint": "高", "flavor_notes": "草本、辛辣"},
    {"id": "rum_spiced", "name": "香料朗姆", "tagline": "海盗的Excel", "abv_hint": "中高", "flavor_notes": "焦糖、肉桂、热带水果"},
    {"id": "brandy_vsop", "name": "干邑VSOP", "tagline": "橡木桶里的西装暴徒", "abv_hint": "中高", "flavor_notes": "坚果、花香、蜂蜜"},
    {"id": "huangjiu", "name": "绍兴黄酒", "tagline": "温热岁月，慢醉人间", "abv_hint": "中低", "flavor_notes": "糯米、药香"},
    {"id": "absinthe_style", "name": "苦艾风味配制酒", "tagline": "绿色幻觉，文艺税", "abv_hint": "高", "flavor_notes": "茴香、草本"},
    {"id": "guihua", "name": "桂花酿", "tagline": "一口江南，两眼朦胧", "abv_hint": "低", "flavor_notes": "桂花、米酒"},
    {"id": "cocktail_old_fashioned", "name": "古典鸡尾酒", "tagline": "苦精与方糖的绅士争吵", "abv_hint": "中高", "flavor_notes": "柑橘皮、威士忌、苦"},
]

CHARACTERS: list[CharacterDef] = [
    {
        "id": "dev",
        "name": "秃头程序员",
        "role": "全栈背锅",
        "archetype": "理性",
        "catchphrase": "我本地是好的",
        "visual_en": "balding male, oversized hoodie or plaid shirt, keyboard silhouette, tired eyes, subtle laptop glow on face",
    },
    {
        "id": "poet",
        "name": "流浪诗人",
        "role": "分行输出情绪",
        "archetype": "文艺",
        "catchphrase": "今夜月色编译失败",
        "visual_en": "long scarf, messy artistic hair, holding worn notebook or feather quill, melancholic pose",
    },
    {
        "id": "guard",
        "name": "夜班保安",
        "role": "巡逻与吐槽",
        "archetype": "市井",
        "catchphrase": "监控都看着呢",
        "visual_en": "security cap with badge, flashlight in hand, dark uniform jacket, stern tired eyes",
    },
    {
        "id": "tcm",
        "name": "老中医",
        "role": "阴阳五行论证",
        "archetype": "神秘",
        "catchphrase": "你这是肝火太旺",
        "visual_en": "grey beard, traditional Chinese robe, herbal medicine pouch, calm wise squint",
    },
    {
        "id": "otaku",
        "name": "二次元宅",
        "role": "周边即正义",
        "archetype": "感性",
        "catchphrase": "这就是羁绊啊",
        "visual_en": "graphic anime tee, oversized headphones, figurine or badge on bag, excited nerdy grin",
    },
    {
        "id": "ceo",
        "name": "霸道总裁",
        "role": "并购一切尴尬",
        "archetype": "莽",
        "catchphrase": "三分钟，我要这条街的笑话",
        "visual_en": "tailored black suit, slick hair, arrogantly folded arms, sharp jawline",
    },
    {
        "id": "busker",
        "name": "地下歌手",
        "role": "和弦安慰世界",
        "archetype": "文艺",
        "catchphrase": "下面一首献给甲方",
        "visual_en": "acoustic guitar strap visible, beanie or messy rocker hair, microphone, passionate singing mouth",
    },
    {
        "id": "taoist",
        "name": "云游道士",
        "role": "掐诀与谜语",
        "archetype": "神秘",
        "catchphrase": "无量天尊，别吵我炼丹",
        "visual_en": "daoist robe and topknot, long beard, yin-yang or talisman strip, mysterious hand gesture",
    },
    {
        "id": "rider",
        "name": "外卖骑手",
        "role": "时间与红绿灯哲学家",
        "archetype": "市井",
        "catchphrase": "您的超时正在配送",
        "visual_en": "bright delivery helmet, insulated delivery box on back strap, wind-burned lively face",
    },
    {
        "id": "kid",
        "name": "小学生",
        "role": "作业与宇宙真理",
        "archetype": "感性",
        "catchphrase": "老师没教这个",
        "visual_en": "oversized school backpack, red scarf or beanie, round innocent face, homework sheet prop",
    },
    {
        "id": "philosopher",
        "name": "深夜哲学家",
        "role": "存在主义摆摊",
        "archetype": "理性",
        "catchphrase": "我只是提问，不负责答案",
        "visual_en": "messy philosopher beard, rumpled coat, wine goblet or thick book, brooding stare upward",
    },
    {
        "id": "coach",
        "name": "健身教练",
        "role": "卡路里警察",
        "archetype": "莽",
        "catchphrase": "再来一组灵魂",
        "visual_en": "tank top showing muscles, whistle on neck, dumbbell in hand, sweaty energetic grin",
    },
    {
        "id": "detective",
        "name": "私家侦探",
        "role": "推理与多疑",
        "archetype": "理性",
        "catchphrase": "线索不对，再来一轮",
        "visual_en": "deerstalker or fedora, trench coat collar up, magnifying glass near eye, suspicious squint",
    },
    {
        "id": "pirate",
        "name": "海盗船长",
        "role": "宝藏与随机应变",
        "archetype": "莽",
        "catchphrase": "这波风浪我熟",
        "visual_en": "tricorn pirate hat, stubbly jaw, bandana, crossed sabres silhouette or hook hand optional",
    },
    {
        "id": "gardener",
        "name": "退休园丁",
        "role": "修剪人生杂草",
        "archetype": "文艺",
        "catchphrase": "花开堪折直须折",
        "visual_en": "wide straw hat, pruning shears, muddy apron, gentle elderly smile, flower in pocket",
    },
    {
        "id": "journalist",
        "name": "调查记者",
        "role": "追问到底",
        "archetype": "理性",
        "catchphrase": "我只关心事实",
        "visual_en": "PRESS patch on vest or arm band, handheld recorder or microphone, rolled newspaper tucked, investigative stern brow — NOT teacher, NO chalkboard",
    },
    {
        "id": "chef",
        "name": "暴躁主厨",
        "role": "火候与脾气齐飞",
        "archetype": "莽",
        "catchphrase": "出去！厨房我说了算",
        "visual_en": "tall white chef toque hat mandatory, stained apron, soup ladle or cleaver raised, angry shouting brows",
    },
    {
        "id": "nurse",
        "name": "夜班护士",
        "role": "温柔刀",
        "archetype": "感性",
        "catchphrase": "别动，深呼吸",
        "visual_en": "classic white nurse cap with red cross, blue scrubs or nurse dress, stethoscope around neck, gentle tired smile",
    },
    {
        "id": "witch",
        "name": "占星女巫",
        "role": "星盘解释权",
        "archetype": "神秘",
        "catchphrase": "水逆而已",
        "visual_en": "wide-brim witch hat with stars, crystal ball glowing, celestial cloak patterns, mysterious half-smile",
    },
    {
        "id": "teacher",
        "name": "补习班名师",
        "role": "考点即世界观",
        "archetype": "理性",
        "catchphrase": "这道题讲过",
        "visual_en": "chalk stick in fingers, sleeve protectors on arms, thick glasses, stack of exam papers under elbow — tiny blackboard with chalk formulas silhouette BEHIND shoulders — looks like cram-school tutor — NOT reporter, NO microphone, NO press vest",
    },
]
