#!/usr/bin/env python3
"""按选角结果重设开局关系：无现成妻/女友；中立禁恋爱；对齐 route_catalog 与 model_roles。"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# cast_pick applied picks:
# romance 12 / neutral 4 / npc 2
ROLES: dict[str, dict] = {
    # —— romance：可发展恋爱，开局绝无「妻子/女朋友」——
    "xiaoyou": {
        "cast_kind": "romance",
        "role_to_pc": "邻居",
        "role_hint": "同小区见过几次的插画师，会点头，还不算熟",
        "boundary": "不喜欢被突然逼问私事或越界靠近",
        "contact_style": "消息慢热，认真回每一条",
    },
    "shizuku": {
        "cast_kind": "romance",
        "role_to_pc": "网友",
        "role_hint": "线上聊了很久，线下才刚见过一两面",
        "boundary": "不喜欢突然开视频或不打招呼就挂电话",
        "contact_style": "消息细软，爱发长语音说明",
    },
    "wanyu": {
        "cast_kind": "romance",
        "role_to_pc": "咖啡店熟人",
        "role_hint": "常在同一家店打照面，彼此记得对方喝什么",
        "boundary": "店里吵架或把她当客服使唤会冷淡",
        "contact_style": "短而热络，偶尔扔个表情包",
    },
    "linxi": {
        "cast_kind": "romance",
        "role_to_pc": "实习同事",
        "role_hint": "工位不远，公事客气，私下话还不多",
        "boundary": "不喜欢被当成情绪垃圾桶或公开打趣",
        "contact_style": "工作消息准时；闲聊会斟酌措辞",
    },
    "qingcai": {
        "cast_kind": "romance",
        "role_to_pc": "同学",
        "role_hint": "同校同社团的熟人，气氛轻松但还没告白过",
        "boundary": "讨厌被当众起哄或逼着表态",
        "contact_style": "聊天跳跃、爱分享新鲜事",
    },
    "xiaoyang": {
        "cast_kind": "romance",
        "role_to_pc": "同班同学",
        "role_hint": "同班很熟，爱约人玩儿，目前也只是同学",
        "boundary": "不喜欢被当成只会搞笑的工具人",
        "contact_style": "回复快，常甩梗和照片",
    },
    "qiansha": {
        "cast_kind": "romance",
        "role_to_pc": "前女友",
        "role_hint": "分过手，圈子小总会再遇见；关系尴尬又未完全断干净",
        "boundary": "最讨厌装作从没发生过，或旧事翻新账当玩笑",
        "contact_style": "短句多，情绪上来时尖锐但不写小作文",
    },
    "aili": {
        "cast_kind": "romance",
        "role_to_pc": "前妻",
        "role_hint": "离过婚，冷静处理过手续；如今仍住同一片区，偶会碰面",
        "boundary": "不接受被当作失败品审问，也不喜欢被可怜",
        "contact_style": "克制、具体，少矫情",
    },
    "jingliu": {
        "cast_kind": "romance",
        "role_to_pc": "上司",
        "role_hint": "职场上正色，对你业务上另眼相看，私下并无恋情",
        "boundary": "公私分明，讨厌越级撒娇或耽误进度",
        "contact_style": "工作导向；夸人很少但到位",
    },
    "ruolin": {
        "cast_kind": "romance",
        "role_to_pc": "选修课讲师",
        "role_hint": "旁听/选修课上认识的老师，课后偶有简短交流",
        "boundary": "拒绝学生式越界，也不喜欢被缠着求加分",
        "contact_style": "书面感稍重，实际语气比板书温柔",
    },
    "miara": {
        "cast_kind": "romance",
        "role_to_pc": "漫展偶遇的人",
        "role_hint": "漫展或谷子店偶然碰上，她穿招牌精灵 cos；愿意再聊妆面与造型，但还不熟",
        "boundary": "讨厌被当奇闻异事追问出身，也不接受糟蹋她的 cos 道具",
        "contact_style": "话多、联想快，爱聊造型细节",
    },
    "shiori": {
        "cast_kind": "romance",
        "role_to_pc": "坡上的熟人",
        "role_hint": "常在星空坡写字或拍 cos，点头之交，聊过天气和句子；业余爱「月下游吟诗人」cos",
        "boundary": "不喜欢被打断写作、硬聊“有没有对象”，也不接受被当成真精灵诗人追问",
        "contact_style": "慢热，句子有留白",
    },
    # —— neutral：有关系，但不能发展恋人（血缘/家人感/无恋爱意图）——
    "xingnai": {
        "cast_kind": "neutral",
        "role_to_pc": "青梅竹马",
        "role_hint": "从小一起长大，像家人；彼此心里都不往恋人那条线想",
        "boundary": "恋爱话术会令她厌恶并拉开距离",
        "contact_style": "嘴上嫌弃，有事会露面",
    },
    "fengyin": {
        "cast_kind": "neutral",
        "role_to_pc": "妹妹",
        "role_hint": "住在一起的义妹/家人，依赖你但绝不是恋爱对象",
        "boundary": "任何把她当女友的玩笑都会当真生气",
        "contact_style": "家常、直接，爱发语音碎碎念",
    },
    "taotao": {
        "cast_kind": "neutral",
        "role_to_pc": "社团朋友",
        "role_hint": "舞台活动里认识的朋友，一起忙通告，没有恋爱打算",
        "boundary": "讨厌把合作关系写成暧昧营销",
        "contact_style": "活泼，约时间干脆",
    },
    "yeyu": {
        "cast_kind": "neutral",
        "role_to_pc": "便利店熟人",
        "role_hint": "夜班常碰上，会闲聊两句的朋友；清楚彼此界线",
        "boundary": "不接受深夜腻歪或被当作恋爱备胎",
        "contact_style": "冷幽默短句，偶尔认真",
    },
    # —— npc：周边人生 ——
    "moran": {
        "cast_kind": "npc",
        "role_to_pc": "笔友",
        "role_hint": "主要在线上吐槽世界的笔友，线下几乎不碰面",
        "boundary": "拒绝被强拉见面或公开身份",
        "contact_style": "长文吐槽，下一秒又消失",
    },
    "luna": {
        "cast_kind": "npc",
        "role_to_pc": "魔法学徒",
        "role_hint": "围着旅人/诗人格子转的学徒，对你客气而疏远",
        "boundary": "不喜欢被当成吉祥物逗弄",
        "contact_style": "礼貌、好奇、称呼正式",
    },
}

EDGES = [
    {"a": "xingnai", "b": "fengyin", "relation": "青梅圈子里的家人熟人", "secret": False},
    {"a": "xingnai", "b": "xiaoyang", "relation": "从小到大的同学", "secret": False},
    {"a": "fengyin", "b": "xiaoyou", "relation": "妹妹眼里哥哥的邻居朋友", "secret": False},
    {"a": "qingcai", "b": "xiaoyang", "relation": "同社团好友", "secret": False},
    {"a": "qingcai", "b": "taotao", "relation": "舞台活动上搭过班", "secret": False},
    {"a": "qingcai", "b": "xingnai", "relation": "偶尔看见对方和你走在一起会不自在", "secret": True, "flag": "edge_qingcai_xingnai_watch"},
    {"a": "qiansha", "b": "jingliu", "relation": "前司曾共事，互相警惕", "secret": False},
    {"a": "qiansha", "b": "aili", "relation": "分手后辗转听说过彼此近况", "secret": True, "flag": "edge_qiansha_aili_excircle"},
    {"a": "qiansha", "b": "xiaoyou", "relation": "一次饭局上短暂同席，气氛微妙", "secret": True, "flag": "edge_qiansha_xiaoyou"},
    {"a": "wanyu", "b": "shizuku", "relation": "咖啡店里聊天最多的一对", "secret": False},
    {"a": "wanyu", "b": "aili", "relation": "熟客之间聊家长里短", "secret": False},
    {"a": "aili", "b": "ruolin", "relation": "成年女性圈子里互相尊重的朋友", "secret": False},
    {"a": "linxi", "b": "jingliu", "relation": "上下级，公事优先", "secret": False},
    {"a": "linxi", "b": "qiansha", "relation": "听过前司关于她的风声", "secret": True, "flag": "edge_linxi_qiansha_gossip"},
    {"a": "yeyu", "b": "moran", "relation": "线上互损的吐槽搭子", "secret": False},
    {"a": "miara", "b": "luna", "relation": "旅人与跟着的学徒", "secret": False},
    {"a": "miara", "b": "shiori", "relation": "cos 圈聊过造型与外拍的熟人", "secret": False},
    {"a": "shiori", "b": "xiaoyou", "relation": "坡上偶遇聊聊创作与诗句", "secret": False},
    {"a": "ruolin", "b": "jingliu", "relation": "校友年会上点头之交", "secret": False},
    {"a": "taotao", "b": "xiaoyang", "relation": "活动上互相撑场的朋友", "secret": False},
]

ROMANCE_ENDINGS = [
    "ending_true_love",
    "ending_festival_memory",
    "ending_gentle_forever",
    "ending_breakup",
    "ending_cold_distance",
    "ending_bond_boost_true",
    "ending_lover",
    "ending_qixi_vow",
    "ending_best_friend",
    "ending_friend",
    "ending_married_daily",
]
NEUTRAL_ENDINGS = [
    "ending_friend",
    "ending_best_friend",
    "ending_festival_memory",
    "ending_bond_ally",
    "ending_cold_distance",
    "ending_breakup",
]

# character_id -> base_id from current graph
BASE_BY_ID = {
    "xiaoyou": "gentle_lover",
    "shizuku": "gentle_lover",
    "wanyu": "gentle_lover",
    "xingnai": "tsundere",
    "fengyin": "tsundere",
    "linxi": "tsundere",
    "qingcai": "cheerful_sun",
    "xiaoyang": "cheerful_sun",
    "taotao": "cheerful_sun",
    "qiansha": "sarcastic_lover",
    "yeyu": "sarcastic_lover",
    "moran": "sarcastic_lover",
    "aili": "mature_sister",
    "jingliu": "mature_sister",
    "ruolin": "mature_sister",
    "miara": "fantasy_spirit",
    "shiori": "fantasy_spirit",
    "luna": "fantasy_spirit",
}

START_STAGE = {
    "网友": "stranger",
    "偶遇的旅人": "stranger",
    "漫展偶遇的人": "stranger",
    "笔友": "stranger",
    "魔法学徒": "acquaintance",
    "邻居": "acquaintance",
    "实习同事": "acquaintance",
    "上司": "acquaintance",
    "选修课讲师": "acquaintance",
    "前女友": "acquaintance",
    "前妻": "acquaintance",
    "咖啡店熟人": "friend",
    "同学": "friend",
    "同班同学": "friend",
    "坡上的熟人": "friend",
    "社团朋友": "friend",
    "便利店熟人": "friend",
    "青梅竹马": "close_friend",
    "妹妹": "close_friend",
}

# personality snippets keyed by mbti — no archetype labels
MBTI_PERSONA = {
    "ISFJ": "把小事记在心里，回应偏具体关心；不会抢话，但会在对方落单时伸手。",
    "INFJ": "先观察气氛再开口；句子里常有留白，讨厌被逼着立刻下判断。",
    "ISTJ": "条理清晰，不喜欢含糊；关心也用“要不要我做X”而不是空泛安慰。",
    "ESTP": "直接、行动派，嘴快但不是为了标签式损人；烦了会走人而不是念叨教条。",
    "ENFP": "话多、联想快，开心时爱岔题；真心在意时会突然认真。",
    "ESFP": "现场感强，爱笑爱起哄；察觉对方不开心会马上换语气哄。",
    "INTJ": "惜字如金，讨厌装乖；吐槽出于判断，不是为了扮演某种固定性格标签。",
    "ISTP": "淡，观察力强；危险或麻烦来了才变得可靠，平时少自我表演。",
    "ESTJ": "目标清楚，会催进度也会护短；下班后才露出一点人味。",
}


def mbti_personality(name: str, mbti: str, role: str, hint: str, cast: str) -> str:
    core = MBTI_PERSONA.get(mbti, "按自己的节奏说话，不模板化。")
    if cast == "neutral":
        ban = "你和对方的关系有边界：可以亲近、赌气、关心，但绝不会往恋人发展，也不会暧昧试探。"
    elif cast == "npc":
        ban = "你是对方生活里的配角人脉，不必推动恋爱主线。"
    else:
        ban = "目前并不是恋人；若日后动心，要自然、缓慢，不要突然宣布关系。"
    return (
        f"你是{name}。开局身份是「{role}」——{hint}。"
        f"{core}{ban}"
        "说话像真人聊天：口语、有停顿、有情绪起伏，避免小标题、条目、复读说明书。"
    )


def route_label(role: str, cast: str) -> str:
    if cast == "romance":
        return f"{role} → 可走到恋爱/结婚"
    if cast == "neutral":
        return f"{role}（挚友线·禁恋爱）"
    return f"{role}（周边）"


def patch_social() -> None:
    path = ROOT / "data" / "social_graph.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    chars = data.get("characters") or {}
    for cid, meta in ROLES.items():
        if cid not in chars:
            continue
        row = chars[cid]
        row["cast_kind"] = meta["cast_kind"]
        row["role_to_pc"] = meta["role_to_pc"]
        row["role_hint"] = meta["role_hint"]
        row["boundary"] = meta["boundary"]
        row["contact_style"] = meta["contact_style"]
    data["edges"] = EDGES
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"patched social_graph ({len(ROLES)} roles, {len(EDGES)} edges)")


def write_routes() -> None:
    routes = []
    for cid, meta in ROLES.items():
        cast = meta["cast_kind"]
        role = meta["role_to_pc"]
        start = START_STAGE.get(role, "acquaintance")
        if cast == "romance":
            routes.append(
                {
                    "character_id": cid,
                    "base_id": BASE_BY_ID[cid],
                    "growth_mode": "progressive",
                    "start_stage_id": start,
                    "target_stage_id": "dating",
                    "max_stage_id": "married",
                    "allowed_endings": list(ROMANCE_ENDINGS),
                    "route_label": route_label(role, cast),
                    "cast_role": "romance",
                }
            )
        else:
            # neutral / npc：封顶挚友，禁止 dating/married
            n_start = start if start != "stranger" or cast == "npc" else "stranger"
            if cast == "neutral" and role in {"青梅竹马", "妹妹"}:
                n_start = "close_friend"
            routes.append(
                {
                    "character_id": cid,
                    "base_id": BASE_BY_ID[cid],
                    "growth_mode": "progressive",
                    "start_stage_id": n_start,
                    "target_stage_id": "close_friend",
                    "max_stage_id": "close_friend",
                    "allowed_endings": list(NEUTRAL_ENDINGS),
                    "route_label": route_label(role, cast),
                    "cast_role": "neutral",
                }
            )
    path = ROOT / "data" / "route_catalog.json"
    path.write_text(json.dumps({"routes": routes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"rewrote route_catalog ({len(routes)} routes)")


def patch_model_roles() -> None:
    path = ROOT / "data" / "model_roles.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for base in data.get("bases") or []:
        for row in base.get("characters") or []:
            cid = str(row.get("id") or "")
            meta = ROLES.get(cid)
            if not meta:
                continue
            prof = row.get("profile") or {}
            mbti = str(prof.get("mbti_type") or "INFP")
            name = str(prof.get("name") or cid)
            cast = meta["cast_kind"]
            cast_role = "romance" if cast == "romance" else "neutral"
            start = START_STAGE.get(meta["role_to_pc"], "acquaintance")
            if cast != "romance" and meta["role_to_pc"] in {"青梅竹马", "妹妹"}:
                start = "close_friend"
            # affinity seeding by start stage
            aff = {"stranger": 12, "acquaintance": 28, "friend": 45, "close_friend": 58}.get(start, 25)
            if meta["role_to_pc"] in {"前女友", "前妻"}:
                aff = 40
            target = "恋人/可结婚" if cast == "romance" else "挚友"
            target_stage = "married" if cast == "romance" else "close_friend"
            prof.update(
                {
                    "relationship": meta["role_to_pc"],
                    "relationship_stage": start,
                    "growth_mode": "progressive",
                    "target_relationship": target,
                    "target_stage_id": target_stage,
                    "initial_affinity": aff,
                    "cast_role": cast_role,
                    "personality": mbti_personality(
                        name, mbti, meta["role_to_pc"], meta["role_hint"], cast
                    ),
                    "speaking_style": "casual"
                    if cast != "romance"
                    else ("formal" if mbti in {"ESTJ", "INFJ"} and cid in {"jingliu", "ruolin", "aili"} else "casual"),
                }
            )
            # drop archetype taglines
            if "tagline" in row:
                occ = prof.get("occupation") or ""
                row["tagline"] = f"{occ} · {meta['role_to_pc']}" if occ else meta["role_to_pc"]
            # neutralize opening if overly wife/gf
            ol = str(prof.get("opening_line") or "")
            if any(k in ol for k in ("妻子", "老婆", "女朋友", "想我了吗", "回来啦")):
                prof["opening_line"] = ""
            row["profile"] = prof
        # soften base labels (cosmetic)
        bid = str(base.get("id") or "")
        label_map = {
            "gentle_lover": "温软向",
            "tsundere": "直球别扭向",
            "cheerful_sun": "明快向",
            "sarcastic_lover": "锐利向",
            "mature_sister": "沉稳向",
            "fantasy_spirit": "诗意向",
        }
        if bid in label_map:
            base["label"] = label_map[bid]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("patched model_roles personalities / stages")


def main() -> None:
    patch_social()
    write_routes()
    patch_model_roles()
    print("done. New worlds will pick up roles; old world saves keep old bonds until recreate.")


if __name__ == "__main__":
    main()
