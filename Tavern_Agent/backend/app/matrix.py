"""角色×酒品矩阵 → 行为参数（话痨、情绪、攻击性、文艺、糊涂）。"""

from dataclasses import dataclass
from typing import Any

from .catalog import CHARACTERS, WINES, CharacterDef, WineDef


@dataclass(frozen=True)
class BehaviorParams:
    """醉酒行为参数，范围约 0~1，用于动态提示词。"""

    chatter: float  # 话痨
    mood_swing: float  # 情绪波动
    aggression: float  # 攻击性（吐槽/杠）
    artsy: float  # 文艺/修辞密度
    confusion: float  # 糊涂/逻辑跳跃


# 酒：基准向量（话痨、情绪、攻击、文艺、糊涂）
_WINE_BASE: dict[str, tuple[float, float, float, float, float]] = {
    "baijiu_erguo": (0.85, 0.55, 0.75, 0.25, 0.45),
    "baijiu_maotai": (0.65, 0.45, 0.55, 0.35, 0.35),
    "whisky_islay": (0.55, 0.65, 0.7, 0.4, 0.4),
    "whisky_sherry": (0.6, 0.7, 0.35, 0.45, 0.35),
    "vodka": (0.45, 0.35, 0.55, 0.3, 0.55),
    "red_wine": (0.65, 0.75, 0.4, 0.55, 0.45),
    "beer_ipa": (0.7, 0.55, 0.6, 0.35, 0.35),
    "beer_lager": (0.75, 0.45, 0.45, 0.25, 0.3),
    "umeshu": (0.8, 0.65, 0.25, 0.45, 0.3),
    "sake_daiginjo": (0.55, 0.5, 0.3, 0.6, 0.35),
    "champagne": (0.85, 0.8, 0.45, 0.45, 0.35),
    "tequila": (0.75, 0.7, 0.65, 0.35, 0.45),
    "rum_spiced": (0.7, 0.65, 0.55, 0.4, 0.45),
    "brandy_vsop": (0.6, 0.55, 0.5, 0.5, 0.4),
    "huangjiu": (0.65, 0.45, 0.35, 0.55, 0.45),
    "absinthe_style": (0.5, 0.75, 0.45, 0.85, 0.55),
    "guihua": (0.7, 0.55, 0.2, 0.65, 0.35),
    "cocktail_old_fashioned": (0.6, 0.5, 0.6, 0.45, 0.35),
}

# 角色：人格调制向量（相加后 clamp）
_CHAR_MOD: dict[str, tuple[float, float, float, float, float]] = {
    "dev": (0.15, 0.1, 0.2, 0.05, 0.15),
    "poet": (0.2, 0.25, 0.1, 0.35, 0.15),
    "guard": (0.25, 0.15, 0.25, 0.05, 0.1),
    "tcm": (0.2, 0.1, 0.15, 0.25, 0.25),
    "otaku": (0.3, 0.3, 0.15, 0.2, 0.15),
    "ceo": (0.15, 0.35, 0.45, 0.15, 0.1),
    "busker": (0.25, 0.35, 0.1, 0.35, 0.15),
    "taoist": (0.15, 0.1, 0.1, 0.3, 0.35),
    "rider": (0.35, 0.25, 0.3, 0.1, 0.15),
    "kid": (0.35, 0.35, 0.15, 0.1, 0.2),
    "philosopher": (0.2, 0.2, 0.25, 0.25, 0.25),
    "coach": (0.25, 0.2, 0.45, 0.05, 0.15),
    "detective": (0.15, 0.15, 0.25, 0.2, 0.15),
    "pirate": (0.25, 0.25, 0.5, 0.15, 0.2),
    "gardener": (0.2, 0.2, 0.1, 0.35, 0.2),
    "journalist": (0.2, 0.15, 0.35, 0.15, 0.1),
    "chef": (0.3, 0.35, 0.55, 0.1, 0.1),
    "nurse": (0.25, 0.25, 0.1, 0.15, 0.15),
    "witch": (0.2, 0.3, 0.15, 0.35, 0.25),
    "teacher": (0.15, 0.15, 0.35, 0.15, 0.15),
}

# 少量「组合彩蛋」：额外偏移（角色_id, 酒_id）
_PAIR_BONUS: dict[tuple[str, str], tuple[float, float, float, float, float]] = {
    ("dev", "beer_ipa"): (0.1, 0.05, 0.15, 0.0, 0.05),
    ("poet", "absinthe_style"): (0.05, 0.1, 0.0, 0.15, 0.1),
    ("ceo", "champagne"): (0.05, 0.15, 0.2, 0.05, 0.0),
    ("taoist", "huangjiu"): (0.0, 0.05, 0.0, 0.15, 0.15),
    ("kid", "umeshu"): (0.15, 0.15, -0.05, 0.05, 0.05),
    ("pirate", "rum_spiced"): (0.1, 0.1, 0.1, 0.05, 0.05),
}


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _vec_add(
    a: tuple[float, float, float, float, float],
    b: tuple[float, float, float, float, float],
) -> tuple[float, float, float, float, float]:
    return tuple(_clamp01(x + y) for x, y in zip(a, b))


def compute_params(wine_id: str, character_id: str) -> BehaviorParams:
    w = _WINE_BASE.get(wine_id, (0.6, 0.5, 0.45, 0.35, 0.35))
    c = _CHAR_MOD.get(character_id, (0.2, 0.2, 0.2, 0.2, 0.2))
    bonus = _PAIR_BONUS.get((character_id, wine_id), (0.0, 0.0, 0.0, 0.0, 0.0))
    chatter, mood, agg, artsy, conf = _vec_add(_vec_add(w, c), bonus)
    return BehaviorParams(
        chatter=chatter,
        mood_swing=mood,
        aggression=agg,
        artsy=artsy,
        confusion=conf,
    )


def find_wine(wine_id: str) -> WineDef | None:
    for w in WINES:
        if w["id"] == wine_id:
            return w
    return None


def find_character(character_id: str) -> CharacterDef | None:
    for c in CHARACTERS:
        if c["id"] == character_id:
            return c
    return None


def params_to_dict(p: BehaviorParams) -> dict[str, Any]:
    return {
        "chatter": round(p.chatter, 3),
        "mood_swing": round(p.mood_swing, 3),
        "aggression": round(p.aggression, 3),
        "artsy": round(p.artsy, 3),
        "confusion": round(p.confusion, 3),
    }
