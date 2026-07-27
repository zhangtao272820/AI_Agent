"""从用户描述 / 意图乐器列表映射 GM 音色与四层编配（纯规则，无模型）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Role = Literal["melody", "comp", "pad", "bass"]

# (关键词列表, GM program, 默认声部角色, 英文规范名)
_GM_CATALOG: list[tuple[tuple[str, ...], int, Role, str]] = [
    (("古筝", "guzheng", "zither"), 46, "melody", "guzheng"),  # Harp 近似
    (("笛", "笛子", "dizi", "flute", "长笛", "竹笛"), 73, "melody", "flute"),
    (("琵琶", "pipa"), 25, "melody", "pipa"),
    (("二胡", "erhu"), 110, "melody", "erhu"),
    (("箫", "xiao", "shakuhachi"), 77, "melody", "xiao"),
    (("古琴", "guqin", "qin"), 46, "melody", "guqin"),
    (("笙", "sheng"), 22, "comp", "sheng"),
    (("萨克斯", "sax", "saxophone"), 65, "melody", "sax"),
    (("小号", "trumpet", "铜管", "brass"), 56, "melody", "brass"),
    (("小提琴", "violin", "弦乐主奏"), 40, "melody", "violin"),
    (("大提琴", "cello", "低音提琴"), 42, "pad", "cello"),
    (("弦乐", "strings", "管弦"), 48, "pad", "strings"),
    (("竖琴", "harp"), 46, "comp", "harp"),
    (("吉他", "guitar", "acoustic"), 25, "melody", "guitar"),
    (("电吉他", "electric guitar", "rock"), 27, "melody", "electric_guitar"),
    (("钢琴", "piano", "keyboard"), 0, "melody", "piano"),
    (("电钢", "rhodes", "electric piano"), 5, "comp", "electric_piano"),
    (("合成", "synth", "pad", "铺底", "ambient"), 89, "pad", "synth_pad"),
    (("贝斯", "bass", "低音"), 33, "bass", "bass"),
    (("鼓", "drums", "percussion", "节奏"), 0, "bass", "drums"),  # 鼓走 channel 9
    (("手风琴", "accordion"), 22, "comp", "accordion"),
    (("口琴", "harmonica"), 22, "melody", "harmonica"),
    (("木琴", "marimba", "xylophone"), 12, "comp", "marimba"),
    (("人声", "vocal", "choir", "合唱"), 52, "pad", "choir"),
]


@dataclass(frozen=True)
class ResolvedLayers:
    melody: int
    pad: int
    comp: int
    bass: int
    use_drums: bool
    matched_names: list[str]


def _norm_blob(parts: list[str]) -> str:
    return " ".join(str(p).lower() for p in parts if p)


def _match_instruments(blob: str) -> list[tuple[int, Role, str]]:
    """按关键词命中顺序收集乐器（长词优先）。"""
    hits: list[tuple[int, Role, str, int]] = []
    for keywords, program, role, name in _GM_CATALOG:
        for kw in keywords:
            if kw.lower() in blob:
                hits.append((program, role, name, len(kw)))
                break
    # 长关键词优先，去重 name
    hits.sort(key=lambda x: -x[3])
    seen: set[str] = set()
    out: list[tuple[int, Role, str]] = []
    for prog, role, name, _ in hits:
        if name in seen:
            continue
        seen.add(name)
        out.append((prog, role, name))
    return out


def extract_instruments_from_text(user_text: str) -> list[str]:
    """从中文/英文描述提取规范乐器名（供意图 JSON 补全）。"""
    blob = user_text.lower()
    matched = _match_instruments(blob)
    return [name for _, _, name in matched]


def infer_style_hints(user_text: str) -> dict[str, str]:
    t = user_text.lower()
    out: dict[str, str] = {}
    if any(k in t for k in ("山水画", "纪录片", "中国风", "古风", "民族", "禅", "documentary", "chinese")):
        out["style"] = "chinese"
        out["harmony_style"] = "folk"
    if any(k in t for k in ("爵士", "jazz")):
        out["style"] = "jazz"
        out["harmony_style"] = "jazz"
    if any(k in t for k in ("古典", "classical", "交响")):
        out["style"] = "classical"
        out["harmony_style"] = "classical"
    if any(k in t for k in ("民谣", "folk", "乡村")):
        out["style"] = "folk"
        out["harmony_style"] = "folk"
    if any(k in t for k in ("电子", "edm", "dance", "synth")):
        out["style"] = "electronic"
    if any(k in t for k in ("宁静", "悠远", "轻柔", "安静", "peaceful", "calm")):
        out["emotion"] = "calm"
    if any(k in t for k in ("忧伤", "悲伤", "sad", "melancholic")):
        out["emotion"] = "sad"
    if any(k in t for k in ("欢快", "明亮", "happy", "bright", "energetic", "轻快")):
        out["emotion"] = "happy"
    if any(k in t for k in ("慢", "舒缓", "slow")):
        out["tempo_hint"] = "slow"
    if any(k in t for k in ("快", "急促", "fast")):
        out["tempo_hint"] = "fast"
    if any(k in t for k in ("无鼓", "不要鼓", "no drum")):
        out["no_drums"] = "1"
    return out


def resolve_layer_programs(
    instruments: list[str],
    harmony_style: str,
    *,
    user_text: str = "",
    style: str = "",
) -> ResolvedLayers:
    blob = _norm_blob(instruments) + " " + user_text.lower()
    matched = _match_instruments(blob)
    hm = (harmony_style or "pop").lower()
    st = (style or "").lower()

    mel, pad, comp, bass = 0, 48, 5, 33
    use_drums = True
    names: list[str] = []

    if "no drum" in blob or "无鼓" in blob or "不要鼓" in blob:
        use_drums = False

    # 按角色分配
    by_role: dict[Role, list[tuple[int, str]]] = {"melody": [], "comp": [], "pad": [], "bass": []}
    for prog, role, name in matched:
        if name == "drums":
            use_drums = True
            names.append(name)
            continue
        by_role[role].append((prog, name))
        names.append(name)

    if by_role["melody"]:
        mel = by_role["melody"][0][0]
    elif st in ("chinese", "folk") or "山水画" in user_text:
        mel = 73  # 默认笛子
        names.append("flute_default")
    elif hm == "classical":
        mel = 40
    elif hm == "jazz":
        mel = 65

    if by_role["pad"]:
        pad = by_role["pad"][0][0]
    elif any(k in blob for k in ("弦", "string", "管弦")):
        pad = 48
    elif st == "chinese":
        pad = 48
    elif hm == "jazz":
        pad = 17
    elif hm == "classical":
        pad = 49
    elif "synth" in blob or st == "electronic":
        pad = 89

    if by_role["comp"]:
        comp = by_role["comp"][0][0]
        if len(by_role["comp"]) > 1 and by_role["comp"][1][0] != comp:
            pass  # 第二层 comp 已用于旋律时下面覆盖
    elif by_role["melody"] and len(by_role["melody"]) > 1:
        comp = by_role["melody"][1][0]
    elif "guitar" in blob or "吉他" in blob:
        comp = 25
    elif st == "chinese" or "古筝" in blob or "guzheng" in blob:
        comp = 46
    elif hm == "classical":
        comp = 46
    elif hm == "folk":
        comp = 22

    if by_role["bass"]:
        bass = by_role["bass"][0][0]
    elif hm in ("classical", "folk") or st == "chinese":
        bass = 32
    elif any(k in blob for k in ("摇滚", "rock", "funk", "电贝")):
        bass = 34

    # 主奏与铺底同音色时拉开
    if mel == pad and mel in (40, 46, 48, 49):
        pad = 91 if mel == 49 else 48
    if mel == comp and mel != 0:
        comp = 5 if mel != 5 else 46

    if hm == "classical" or st == "chinese":
        use_drums = use_drums and not any(k in blob for k in ("无鼓", "不要鼓", "no drum"))

    return ResolvedLayers(
        melody=mel,
        pad=pad,
        comp=comp,
        bass=bass,
        use_drums=use_drums,
        matched_names=names,
    )
