# -*- coding: utf-8 -*-
"""为 social_graph.edges 补 kind，并加深中立/NPC 交叉边（P3）。"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "social_graph.json"

KIND_HINTS = [
    ("上下级", "colleague"),
    ("前司", "colleague"),
    ("共事", "colleague"),
    ("夜班", "colleague"),
    ("同学", "friend"),
    ("社团", "friend"),
    ("好友", "friend"),
    ("朋友", "friend"),
    ("搭子", "friend"),
    ("撑场", "friend"),
    ("青梅", "friend"),
    ("家人熟人", "friend"),
    ("邻居", "neighbor"),
    ("分手", "ex_circle"),
    ("不自在", "rival"),
    ("警惕", "rival"),
    ("微妙", "rival"),
    ("别扭", "rival"),
    ("风声", "acquaintance"),
    ("学徒", "mentor"),
    ("同门", "mentor"),
    ("旅人", "mentor"),
    ("前辈", "mentor"),
    ("饭局", "acquaintance"),
    ("熟客", "acquaintance"),
    ("点头", "acquaintance"),
    ("偶遇", "acquaintance"),
    ("幕后", "friend"),
    ("活动", "friend"),
    ("舞台", "friend"),
    ("咖啡", "friend"),
    ("坡上", "acquaintance"),
    ("线上", "friend"),
    ("情报", "acquaintance"),
]


def infer_kind(relation: str) -> str:
    for key, kind in KIND_HINTS:
        if key in relation:
            return kind
    return "acquaintance"


def pair_key(a: str, b: str) -> tuple[str, str]:
    return tuple(sorted((a, b)))


NEW_EDGES = [
    {
        "a": "heqing",
        "b": "wanyu",
        "relation": "咖啡店偶遇聊过创作的熟人",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "heqing",
        "b": "aili",
        "relation": "成年女性圈子里互相尊重的朋友",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "heqing",
        "b": "ruolin",
        "relation": "校友活动上点头之交",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "xiaoke",
        "b": "fengyin",
        "relation": "妹妹圈子里见过的邻居熟人",
        "kind": "neighbor",
        "secret": False,
    },
    {
        "a": "xiaoke",
        "b": "shizuku",
        "relation": "在咖啡店帮过一次忙的邻里",
        "kind": "neighbor",
        "secret": False,
    },
    {
        "a": "xiaoke",
        "b": "xingnai",
        "relation": "青梅圈子里偶尔碰面",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "xiaoke",
        "b": "qingcai",
        "relation": "看见对方和你走在一起时会别扭",
        "kind": "rival",
        "secret": True,
        "flag": "edge_xiaoke_qingcai_watch",
    },
    {
        "a": "lele",
        "b": "heqing",
        "relation": "中立圈子里互相撑场的朋友",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "anran",
        "b": "qiansha",
        "relation": "夜班便利店里见过几次的熟客",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "anran",
        "b": "moran",
        "relation": "线上互损圈子里的共同熟人",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "anran",
        "b": "jingliu",
        "relation": "加班路过便利店买过东西的点头之交",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "anran",
        "b": "xiaoke",
        "relation": "同小区夜里偶遇点头",
        "kind": "neighbor",
        "secret": False,
    },
    {
        "a": "moxi",
        "b": "yeyu",
        "relation": "线上吐槽圈的情报中转",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "moxi",
        "b": "moran",
        "relation": "互损搭子的共同熟人，偶尔传话",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "moxi",
        "b": "qiansha",
        "relation": "听过前司风声的旁观者",
        "kind": "acquaintance",
        "secret": True,
        "flag": "edge_moxi_qiansha_gossip",
    },
    {
        "a": "moxi",
        "b": "linxi",
        "relation": "职场八卦链上的边缘节点",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "luli",
        "b": "moxi",
        "relation": "剧情配角之间偶尔交换情报",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "wanyu",
        "b": "jingliu",
        "relation": "客户与职场人的礼貌熟识",
        "kind": "acquaintance",
        "secret": False,
    },
    {
        "a": "shizuku",
        "b": "ruolin",
        "relation": "安静场合里互相点头的朋友",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "taotao",
        "b": "qingcai",
        "relation": "舞台搭档之外的私下吐槽朋友",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "aili",
        "b": "linxi",
        "relation": "一次应酬上短暂同席",
        "kind": "acquaintance",
        "secret": True,
        "flag": "edge_aili_linxi_banquet",
    },
    {
        "a": "fengyin",
        "b": "xiaoyang",
        "relation": "青梅同学圈子里的交叉熟人",
        "kind": "friend",
        "secret": False,
    },
    {
        "a": "luna",
        "b": "shiori",
        "relation": "学徒眼里的神秘前辈熟人",
        "kind": "mentor",
        "secret": False,
    },
]


def main() -> None:
    g = json.loads(PATH.read_text(encoding="utf-8"))
    for e in g["edges"]:
        if not e.get("kind"):
            e["kind"] = infer_kind(e.get("relation") or "")

    existing = {pair_key(e["a"], e["b"]) for e in g["edges"]}
    added = 0
    for e in NEW_EDGES:
        k = pair_key(e["a"], e["b"])
        if k in existing:
            continue
        if e["a"] not in g["characters"] or e["b"] not in g["characters"]:
            print("skip missing", e["a"], e["b"])
            continue
        g["edges"].append(e)
        existing.add(k)
        added += 1

    rom = {c for c, v in g["characters"].items() if v.get("cast_kind") == "romance"}
    neu = {c for c, v in g["characters"].items() if v.get("cast_kind") == "neutral"}
    npc = {c for c, v in g["characters"].items() if v.get("cast_kind") == "npc"}

    def romance_edge_count(cid: str) -> int:
        n = 0
        for e in g["edges"]:
            other = None
            if e["a"] == cid:
                other = e["b"]
            elif e["b"] == cid:
                other = e["a"]
            if other and other in rom:
                n += 1
        return n

    PATH.write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("edges", len(g["edges"]), "added", added)
    for c in sorted(neu):
        print("neutral", c, "romance_edges", romance_edge_count(c))
    for c in sorted(npc):
        cnt = sum(1 for e in g["edges"] if e["a"] == c or e["b"] == c)
        print("npc", c, "edges", cnt)


if __name__ == "__main__":
    main()
