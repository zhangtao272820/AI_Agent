"""Enrich body_catalog with shoulder/hip/leg feminine silhouette fields."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "body_catalog.json"

# per-character overrides; others derived from build + BWH
OVERRIDES: dict[str, dict] = {
    "aili": {
        "shoulder": "narrow",
        "silhouette": "soft_hourglass",
        "hip_visual": "soft",
        "leg_length": "long",
        "thigh": "slim",
        "calf": "slim",
        "style_flavor": "细线彩线稿、暖柔光影、奶油/鼠尾草绿/蜜金配色、纯黑底VN全身立绘",
    },
    "jingliu": {
        "shoulder": "medium",
        "silhouette": "elegant_hourglass",
        "hip_visual": "full",
        "leg_length": "long",
        "thigh": "soft",
        "calf": "slim",
        "style_flavor": "精细赛璐璐、黑金港风旗袍感、深棕大波浪长发金饰、暖棕眼、成熟性感优雅、纯黑底VN全身立绘",
    },
    "taotao": {
        "shoulder": "narrow",
        "silhouette": "pear",
        "hip_visual": "round",
        "leg_length": "medium",
        "thigh": "soft",
        "calf": "soft",
    },
    "miara": {
        "shoulder": "narrow",
        "silhouette": "soft_hourglass",
        "hip_visual": "full",
        "leg_length": "long",
        "thigh": "soft",
        "calf": "slim",
    },
    "fengyin": {
        "shoulder": "medium",
        "silhouette": "athletic",
        "hip_visual": "firm",
        "leg_length": "long",
        "thigh": "athletic",
        "calf": "athletic",
    },
    "yeyu": {
        "shoulder": "medium",
        "silhouette": "athletic",
        "hip_visual": "firm",
        "leg_length": "long",
        "thigh": "athletic",
        "calf": "athletic",
    },
    "moran": {
        "shoulder": "narrow",
        "silhouette": "straight_slim",
        "hip_visual": "slim",
        "leg_length": "long",
        "thigh": "slim",
        "calf": "slim",
    },
}


def derive_defaults(row: dict) -> dict:
    build = str(row.get("build") or "balanced")
    try:
        hip = float(row.get("hip_cm") or 0)
        waist = float(row.get("waist_cm") or 0)
        h = float(row.get("height_cm") or 0)
    except (TypeError, ValueError):
        hip, waist, h = 0.0, 0.0, 0.0
    hip_waist = hip - waist if hip and waist else 0

    if build == "petite":
        base = {
            "shoulder": "narrow",
            "silhouette": "petite_straight",
            "hip_visual": "slim",
            "leg_length": "short",
            "thigh": "slim",
            "calf": "slim",
        }
    elif build == "athletic":
        base = {
            "shoulder": "medium",
            "silhouette": "athletic",
            "hip_visual": "firm",
            "leg_length": "long" if h >= 163 else "medium",
            "thigh": "athletic",
            "calf": "athletic",
        }
    elif build == "soft_curvy":
        base = {
            "shoulder": "narrow",
            "silhouette": "pear" if hip_waist >= 26 else "soft_hourglass",
            "hip_visual": "round",
            "leg_length": "medium",
            "thigh": "soft",
            "calf": "soft",
        }
    elif build == "slender_elegant":
        base = {
            "shoulder": "narrow",
            "silhouette": "elegant_hourglass",
            "hip_visual": "soft",
            "leg_length": "long",
            "thigh": "slim",
            "calf": "slim",
        }
    elif build == "slender":
        base = {
            "shoulder": "narrow",
            "silhouette": "straight_slim",
            "hip_visual": "slim",
            "leg_length": "medium" if h < 163 else "long",
            "thigh": "slim",
            "calf": "slim",
        }
    else:
        base = {
            "shoulder": "medium",
            "silhouette": "balanced",
            "hip_visual": "soft",
            "leg_length": "medium",
            "thigh": "soft",
            "calf": "slim",
        }
    return base


def main() -> None:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    data["note"] = (
        "身材 SSOT；含胸/腰/臀/肩/腿等女性轮廓参数。"
        "数值为设定档案；立绘锁头身比+build+bust/hip/leg；"
        "精修换装优先对话 GenerateImage + 正式基图作 reference。"
    )
    data["silhouette_ids"] = [
        "petite_straight",
        "straight_slim",
        "balanced",
        "soft_hourglass",
        "elegant_hourglass",
        "pear",
        "athletic",
    ]
    chars = data.get("characters") or {}
    for cid, row in chars.items():
        defaults = derive_defaults(row)
        defaults.update(OVERRIDES.get(cid) or {})
        for k, v in defaults.items():
            row[k] = v
    PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"enriched {len(chars)} characters")


if __name__ == "__main__":
    main()
