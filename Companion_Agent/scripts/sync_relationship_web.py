# -*- coding: utf-8 -*-
"""Sync PC / romance / neutral relationship web after neutral cast redesign.

- Enrich social_graph edges + pc profile
- T0×N 守门秘密边：绑定女主真结局前置（见 build_story_routes / 故事圣经 §2.1）
- T2 轻副本：不新增跨线/守门边；既有弱边可留作氛围
- 无名背景：无结局 / 无故事分支
Run: python scripts/sync_relationship_web.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SG = ROOT / "data" / "social_graph.json"

# Canonical edges for the new web (idempotent upsert by a|b sorted key)
NEW_EDGES: list[dict] = [
    # —— 男主家庭轴 ——
    {
        "a": "shuli",
        "b": "fengyin",
        "relation": "亲妹妹与同住义妹：抢浴室、盯哥哥作息的一家人",
        "secret": False,
        "kind": "family",
    },
    {
        "a": "shuli",
        "b": "xiaoyou",
        "relation": "妹妹眼里「哥哥隔壁那个会画画的姐姐」",
        "secret": False,
        "kind": "neighbor",
    },
    # —— T0 女主 × 绑定中立 ——
    {
        "a": "youwei",
        "b": "xiaoyou",
        "relation": "工作室学妹与学姐；交稿夜会帮着调色",
        "secret": False,
        "kind": "mentor",
    },
    {
        "a": "youwei",
        "b": "shuli",
        "relation": "学妹来家里取稿时见过的妹妹",
        "secret": False,
        "kind": "acquaintance",
    },
    {
        "a": "yuxi",
        "b": "wanyu",
        "relation": "高中死党，店里互相顶班、互捂倦容",
        "secret": False,
        "kind": "best_friend",
    },
    {
        "a": "yuxi",
        "b": "luna",
        "relation": "同店兼职交接班的同事",
        "secret": False,
        "kind": "colleague",
    },
    {
        "a": "jingning",
        "b": "jingliu",
        "relation": "堂姐妹；堂妹旁观堂姐职场面具",
        "secret": False,
        "kind": "family",
    },
    {
        "a": "jingning",
        "b": "linxi",
        "relation": "跟堂姐开会时在公司见过的实习生",
        "secret": False,
        "kind": "acquaintance",
    },
    {
        "a": "lingke",
        "b": "ruolin",
        "relation": "研究生助教与导师；护课堂边界",
        "secret": False,
        "kind": "colleague",
    },
    {
        "a": "lingke",
        "b": "shuli",
        "relation": "校园答疑时见过的高中生妹妹",
        "secret": False,
        "kind": "acquaintance",
    },
    {
        "a": "aichen",
        "b": "aili",
        "relation": "离婚前后一直托底的闺蜜",
        "secret": False,
        "kind": "best_friend",
    },
    {
        "a": "aichen",
        "b": "wanyu",
        "relation": "花艺洽谈常去的咖啡店熟脸",
        "secret": False,
        "kind": "acquaintance",
    },
    # —— 中立对恋爱线的「守门」秘密边（需一定好感才揭开） ——
    {
        "a": "yuxi",
        "b": "wanyu",
        "relation": "死党私下盘问：你是不是在跟店里那个熟客走太近",
        "secret": True,
        "flag": "edge_yuxi_wanyu_guard",
        "kind": "gate",
    },
    {
        "a": "jingning",
        "b": "jingliu",
        "relation": "堂妹察觉堂姐下班后情绪不对，会旁敲侧击问你",
        "secret": True,
        "flag": "edge_jingning_jingliu_watch",
        "kind": "gate",
    },
    {
        "a": "lingke",
        "b": "ruolin",
        "relation": "助教对师生越线零容忍，会直接警告你",
        "secret": True,
        "flag": "edge_lingke_ruolin_boundary",
        "kind": "gate",
    },
    {
        "a": "aichen",
        "b": "aili",
        "relation": "闺蜜审视复联：伤过一次就不准再随便",
        "secret": True,
        "flag": "edge_aichen_aili_gate",
        "kind": "gate",
    },
    {
        "a": "youwei",
        "b": "xiaoyou",
        "relation": "学妹偷看学姐画里多了你的影子",
        "secret": True,
        "flag": "edge_youwei_xiaoyou_crush",
        "kind": "gate",
    },
    {
        "a": "shuli",
        "b": "fengyin",
        "relation": "两个妹妹交换情报：哥哥最近又对谁心软",
        "secret": True,
        "flag": "edge_sisters_pc_watch",
        "kind": "gate",
    },
]


def _edge_key(e: dict) -> tuple[str, str, str]:
    a, b = sorted([str(e.get("a") or ""), str(e.get("b") or "")])
    # secret edges can coexist with public ones between same pair
    sec = "1" if e.get("secret") else "0"
    return (a, b, sec)


def upsert_edges(existing: list[dict], incoming: list[dict]) -> list[dict]:
    by = {_edge_key(e): e for e in existing if e.get("a") and e.get("b")}
    for e in incoming:
        by[_edge_key(e)] = e
    # drop obsolete neutrals + demoted named NPCs (now nameless background only)
    obsolete = {"heqing", "xiaoke", "lele", "anran", "moxi", "luli"}
    out = []
    for e in by.values():
        if e.get("a") in obsolete or e.get("b") in obsolete:
            continue
        out.append(e)
    out.sort(key=lambda e: (str(e.get("a")), str(e.get("b")), bool(e.get("secret"))))
    return out


def main() -> None:
    data = json.loads(SG.read_text(encoding="utf-8"))
    data["pc"] = {
        "label": "你",
        "summary": (
            "落脚小镇的上班族。亲妹妹沈沈书璃同城念书，义妹沈沈枫音同住；"
            "工作日去公司，周末在咖啡店、书店与校园之间晃。"
            "恋爱只发生在 romance 线；中立是家人/守门人/同盟。"
            "地点路人立绘为无名背景装饰，无对话角色。"
        ),
        "home_with": ["shuli", "fengyin"],
        "work_location": "office",
        "bond_neutrals": {
            "shuli": "亲妹妹",
            "jingning": "江静流堂妹·旁观",
            "youwei": "苏晚悠工作室学妹",
            "yuxi": "温晚雨死党·店里护短",
            "lingke": "顾若铃助教·边界卫士",
            "aichen": "夏艾黎闺蜜·复联守门",
        },
        "npc_note": "无有名 NPC；路人立绘仅作地点背景装饰（_background），与场景底图同类。",
    }
    data["edges"] = upsert_edges(list(data.get("edges") or []), NEW_EDGES)
    SG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"social_graph edges -> {len(data['edges'])}; pc profile written")


if __name__ == "__main__":
    main()
