#!/usr/bin/env python3
"""扫描 romance+neutral 立绘缺口，写出 JSON + Markdown（含 menu×40 / Q头 / 情绪基图）。"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "data" / "sprites"
OUT_JSON = ROOT / "data" / "sprite_inventory.json"
OUT_MD = ROOT / "doc" / "立绘资源缺口.md"

EMOTIONS = ("neutral", "happy", "shy", "sad", "angry", "love", "surprised", "sarcastic")
AVATAR_BASE = ("avatar.png",)
AVATAR_EMO = tuple(f"avatar_{e}.png" for e in EMOTIONS if e != "neutral")
MENU_UI = (
    "portrait",
    "smile",
    "soft",
    "cool",
    "work",
    "casual",
    "evening",
    "closeup",
    "profile",
    "hero",
)
MENU_DIALOGUE = (
    "neutral",
    "happy",
    "shy",
    "sad",
    "angry",
    "love",
    "surprised",
    "sarcastic",
    "winter",
    "spring",
    "summer",
    "autumn",
    "date",
    "home",
    "rain",
    "school",
    "office",
    "cafe",
    "talk",
    "listen",
    "laugh",
    "thoughtful",
    "glance",
    "away",
    "bust_soft",
    "bust_cool",
    "sit",
    "walk",
    "window",
    "over_shoulder",
)
MENU_ALL = MENU_UI + MENU_DIALOGUE

# 中立最低玩法包（禁亲密）
NEUTRAL_OUTFITS = ("casual", "work", "home")
# romance 基础换装（有则佳）
ROMANCE_BASE_OUTFITS = ("casual", "work", "home", "school", "date", "rain")


def _files(folder: Path) -> set[str]:
    if not folder.is_dir():
        return set()
    return {p.name for p in folder.glob("*.png")}


def scan_character(cast: str, cid: str) -> dict:
    folder = SPRITES / cast / cid
    names = _files(folder)
    missing_emo = [e for e in EMOTIONS if f"{e}.png" not in names]
    missing_avatar = []
    if "avatar.png" not in names:
        missing_avatar.append("avatar.png")
    for a in AVATAR_EMO:
        if a not in names:
            missing_avatar.append(a)
    missing_menu = [s for s in MENU_ALL if f"menu_{s}.png" not in names]
    present_menu = [s for s in MENU_ALL if f"menu_{s}.png" in names]

    outfits_expected = list(NEUTRAL_OUTFITS if cast == "neutral" else ROMANCE_BASE_OUTFITS)
    missing_outfit = []
    for o in outfits_expected:
        # need at least one emotion for outfit
        if not any(f"{o}_{e}.png" in names for e in ("neutral", "happy", "shy")):
            missing_outfit.append(o)

    return {
        "cast": cast,
        "character_id": cid,
        "total_png": len(names),
        "emotion_base": {
            "have": [e for e in EMOTIONS if f"{e}.png" in names],
            "missing": missing_emo,
        },
        "avatar": {
            "have": [a for a in ("avatar.png", *AVATAR_EMO) if a in names],
            "missing": missing_avatar,
        },
        "menu": {
            "have_count": len(present_menu),
            "target": len(MENU_ALL),
            "have": present_menu,
            "missing": missing_menu,
            "missing_ui10": [s for s in MENU_UI if f"menu_{s}.png" not in names],
            "missing_dialogue30": [s for s in MENU_DIALOGUE if f"menu_{s}.png" not in names],
        },
        "base_outfits": {
            "expected": outfits_expected,
            "missing": missing_outfit,
        },
    }


def main() -> None:
    rows: list[dict] = []
    for cast in ("romance", "neutral"):
        root = SPRITES / cast
        if not root.is_dir():
            continue
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            rows.append(scan_character(cast, d.name))

    summary = {
        "note": "正式情绪基图 / Q头 / menu×40 / 基础换装缺口。亲密/max/end 包见扩展计划，不在本表最低玩法线。",
        "menu_slots_ui": list(MENU_UI),
        "menu_slots_dialogue": list(MENU_DIALOGUE),
        "characters": rows,
    }
    OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    # Markdown
    lines: list[str] = [
        "# 立绘资源缺口（全员 · romance + neutral）",
        "",
        "> **自动生成**：`python scripts/build_sprite_inventory.py`  ",
        "> 机器可读：[`../data/sprite_inventory.json`](../data/sprite_inventory.json)  ",
        "> 契约：[`立绘资源手册.md`](./立绘资源手册.md) · 进度：[`立绘资源扩展计划.md`](./立绘资源扩展计划.md)",
        "",
        f"扫描角色数：**{len(rows)}**（romance + neutral）。目标：情绪基图×8 · Q头基图+情绪 · `menu_*`×40 · 基础换装。",
        "",
        "## 总览",
        "",
        "| cast | id | 总PNG | 情绪缺 | Q头缺 | menu有/40 | 基础换装缺 |",
        "|------|----|------:|-------:|------:|----------:|-----------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['cast']} | `{r['character_id']}` | {r['total_png']} | "
            f"{len(r['emotion_base']['missing'])} | {len(r['avatar']['missing'])} | "
            f"{r['menu']['have_count']}/{r['menu']['target']} | "
            f"{', '.join(r['base_outfits']['missing']) or '—'} |"
        )

    lines += ["", "## 分角色明细", ""]
    for r in rows:
        lines.append(f"### `{r['character_id']}`（{r['cast']}）")
        lines.append("")
        if r["emotion_base"]["missing"]:
            lines.append(f"- **情绪基图缺**：{', '.join('`'+x+'`' for x in r['emotion_base']['missing'])}")
        else:
            lines.append("- **情绪基图**：齐（8）")
        if r["avatar"]["missing"]:
            lines.append(f"- **Q 头缺**：{', '.join('`'+x+'`' for x in r['avatar']['missing'])}")
        else:
            lines.append("- **Q 头**：齐")
        mu = r["menu"]["missing_ui10"]
        md = r["menu"]["missing_dialogue30"]
        lines.append(
            f"- **menu**：{r['menu']['have_count']}/40；"
            f"菜单10缺 {len(mu)}；对话30缺 {len(md)}"
        )
        if mu:
            lines.append(f"  - 菜单槽缺：{', '.join('`'+x+'`' for x in mu)}")
        if md and len(md) <= 30:
            # collapse if all 30
            if len(md) == 30:
                lines.append("  - 对话槽：整包 30 未开始")
            else:
                lines.append(f"  - 对话槽缺：{', '.join('`'+x+'`' for x in md)}")
        if r["base_outfits"]["missing"]:
            lines.append(
                f"- **基础换装缺**：{', '.join('`'+x+'`' for x in r['base_outfits']['missing'])}"
            )
        lines.append("")

    # Priority board
    lines += [
        "## 补图优先级建议",
        "",
        "1. **T0 menu 对话30**：✅ 已齐 xiaoyou/wanyu/ruolin/jingliu/aili/linxi（各 40/40）",
        "2. **T1/T2 + neutral 的 menu×10**（标题/选角封面）· 下一位见扩展计划 M2–M3（`qiansha`）",
        "3. **全员 Q 头 P1 五情绪**（sad/angry/love/surprised/sarcastic）— 非 T0 多数仍缺",
        "4. **neutral 基础换装** casual/work/home（多数仅情绪基图）",
        "5. **场景底图季节差分** `*_winter.png`（见扩展计划 §9）",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} and {OUT_MD.relative_to(ROOT)} ({len(rows)} chars)")


if __name__ == "__main__":
    main()
