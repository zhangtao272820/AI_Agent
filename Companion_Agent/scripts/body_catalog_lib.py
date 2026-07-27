"""Body catalog helpers — SSOT at data/body_catalog.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BODY_CATALOG_PATH = ROOT / "data" / "body_catalog.json"

BUILD_LABEL_ZH: dict[str, str] = {
    "petite": "娇小纤细",
    "slender": "纤细匀称",
    "slender_elegant": "纤细优雅",
    "balanced": "匀称标准",
    "athletic": "结实运动",
    "soft_curvy": "柔和丰盈",
}

BUST_VISUAL_ZH: dict[str, str] = {
    "petite": "娇小胸型",
    "small": "偏小胸型",
    "medium": "中等胸型",
    "full": "偏丰胸型",
    "ample": "丰满胸型",
}

ANATOMY_LOCK = (
    "解剖学硬约束：双手各五指清晰可数、无融合手指；双脚脚掌着地、脚趾不畸形；"
    "禁止多肢、错位关节、裙下悬浮脚。"
)


def load_body_catalog(path: Path | None = None) -> dict[str, Any]:
    p = path or BODY_CATALOG_PATH
    if not p.is_file():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def get_body_row(catalog: dict[str, Any], cid: str) -> dict[str, Any]:
    return dict((catalog.get("characters") or {}).get(cid) or {})


def derive_build(row: dict[str, Any]) -> str:
    """若未显式写 build，由 BMI + 胸腰差粗映射；显式优先。"""
    explicit = str(row.get("build") or "").strip()
    if explicit in BUILD_LABEL_ZH:
        return explicit
    try:
        h = float(row["height_cm"]) / 100.0
        w = float(row["weight_kg"])
        bust = float(row.get("bust_cm") or 0)
        waist = float(row.get("waist_cm") or 0)
    except (KeyError, TypeError, ValueError):
        return "balanced"
    if h <= 0:
        return "balanced"
    bmi = w / (h * h)
    bust_waist = bust - waist if bust and waist else 0
    if h * 100 < 158 and bmi < 20:
        return "petite"
    if bust_waist >= 26 and bmi >= 18.5:
        return "soft_curvy"
    if bmi >= 20.5 and bust_waist < 24:
        return "athletic"
    if bmi < 19.5 and h * 100 >= 164:
        return "slender_elegant"
    if bmi < 19.5:
        return "slender"
    return "balanced"


def derive_bust_visual(row: dict[str, Any]) -> str:
    """显式 bust_visual 优先；否则按 bust_cm 粗分档。"""
    explicit = str(row.get("bust_visual") or "").strip()
    if explicit in BUST_VISUAL_ZH:
        return explicit
    if explicit:
        return explicit
    try:
        bust = float(row.get("bust_cm") or 0)
    except (TypeError, ValueError):
        return "medium"
    if bust <= 0:
        return "medium"
    if bust < 80:
        return "petite"
    if bust < 84:
        return "small"
    if bust < 88:
        return "medium"
    if bust < 92:
        return "full"
    return "ample"


HIP_VISUAL_ZH: dict[str, str] = {
    "slim": "纤细臀线",
    "soft": "柔和臀线",
    "round": "圆润臀线",
    "full": "丰满臀线",
    "firm": "结实臀线",
}

LEG_LENGTH_ZH: dict[str, str] = {
    "short": "偏短腿比例",
    "medium": "标准腿长",
    "long": "偏长腿比例",
}

THIGH_ZH: dict[str, str] = {
    "slim": "纤细大腿",
    "soft": "柔和大腿",
    "athletic": "结实大腿",
}

SHOULDER_ZH: dict[str, str] = {
    "narrow": "窄肩",
    "medium": "自然肩宽",
    "broad": "偏宽肩",
}

SILHOUETTE_ZH: dict[str, str] = {
    "petite_straight": "娇小直筒",
    "straight_slim": "纤细直筒",
    "balanced": "匀称身形",
    "soft_hourglass": "柔和沙漏",
    "elegant_hourglass": "优雅沙漏",
    "pear": "梨形",
    "athletic": "运动身形",
}


def body_lock_prompt(row: dict[str, Any], *, default_forbid: str = "") -> str:
    if not row:
        return (
            "身材锁定：必须与底图躯干、四肢比例一致，禁止拉长腿或改变胸围腰围。"
            "胸部、臀线、腿部轮廓必须与底图完全一致。"
            + ANATOMY_LOCK
        )
    build = derive_build(row)
    label = BUILD_LABEL_ZH.get(build, build)
    h = row.get("height_cm", "?")
    ratio = row.get("head_body_ratio", "?")
    bust = row.get("bust_cm", "?")
    waist = row.get("waist_cm", "?")
    hip = row.get("hip_cm", "?")
    bust_key = derive_bust_visual(row)
    bust_label = BUST_VISUAL_ZH.get(str(bust_key), str(bust_key))
    hip_v = HIP_VISUAL_ZH.get(str(row.get("hip_visual") or "soft"), "柔和臀线")
    leg_v = LEG_LENGTH_ZH.get(str(row.get("leg_length") or "medium"), "标准腿长")
    thigh_v = THIGH_ZH.get(str(row.get("thigh") or "slim"), "纤细大腿")
    shoulder_v = SHOULDER_ZH.get(str(row.get("shoulder") or "narrow"), "窄肩")
    sil_v = SILHOUETTE_ZH.get(str(row.get("silhouette") or ""), str(row.get("silhouette") or "匀称"))
    pose = str(row.get("pose_notes") or "").strip()
    forbid = str(row.get("anatomy_forbid") or default_forbid or "").strip()
    style = str(row.get("style_flavor") or "").strip()
    parts = [
        f"身材锁定：身高感约{h}、头身比{ratio}、{label}、{sil_v}、{shoulder_v}，三围{bust}/{waist}/{hip}；"
        "必须与参考立绘躯干四肢比例一致。",
        f"胸部硬锁：{bust_label}（约{bust}），大小位置起伏与参考图一致，禁止丰胸缩胸。",
        f"下半身硬锁：{hip_v}（臀围约{hip}）、{leg_v}、{thigh_v}；"
        "换装不改变臀腿围度与腿长比例，禁止擅自拉长腿或加粗大腿。",
    ]
    if pose:
        parts.append(f"姿态参考：{pose}。")
    if style:
        parts.append(f"画风味道：{style}。")
    parts.append(ANATOMY_LOCK)
    if forbid:
        parts.append(forbid if forbid.endswith("。") else forbid + "。")
    return "".join(parts)


def body_summary_soft(row: dict[str, Any]) -> str:
    """对话用人设软文案，不念三围数字。"""
    if not row:
        return ""
    build = derive_build(row)
    label = BUILD_LABEL_ZH.get(build, "匀称")
    try:
        h = int(row.get("height_cm") or 0)
    except (TypeError, ValueError):
        h = 0
    if h <= 0:
        height_soft = ""
    elif h < 158:
        height_soft = "娇小"
    elif h < 163:
        height_soft = "中等偏娇小"
    elif h < 168:
        height_soft = "约一六五"
    else:
        height_soft = "高挑"
    parts: list[str] = [label]
    if height_soft and height_soft not in label:
        parts.append(height_soft)
    sil = str(row.get("silhouette") or "")
    bust_key = derive_bust_visual(row)
    if "hourglass" in sil:
        parts.append("曲线分明")
    elif bust_key in {"full", "ample"} and build not in {"athletic", "soft_curvy"}:
        parts.append("轮廓偏丰")
    # 去重保序
    seen: set[str] = set()
    ordered: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.add(p)
            ordered.append(p)
    return "，".join(ordered)


def body_lock_short(row: dict[str, Any]) -> str:
    """写入 manifest 的短摘要，避免双份手改数值。"""
    if not row:
        return ""
    build = derive_build(row)
    bv = derive_bust_visual(row)
    return (
        f"h{row.get('height_cm')}/r{row.get('head_body_ratio')}/"
        f"{build}/bust:{bv}/BWH {row.get('bust_cm')}-{row.get('waist_cm')}-{row.get('hip_cm')}"
    )
