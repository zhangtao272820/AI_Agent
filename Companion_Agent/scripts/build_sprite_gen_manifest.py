"""Generate data/sprite_gen_manifest.json from on-disk sprites + social_graph + body_catalog.

Always merges intimate / 擦边 / max / end_* outfit labels + hints + signature_hooks so a
single rebuild cannot leave a half-broken manifest (see apply_intimate_expansion).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
from body_catalog_lib import body_lock_short, get_body_row, load_body_catalog  # noqa: E402

EMOTIONS = ["neutral", "happy", "shy", "sad", "angry", "love", "surprised", "sarcastic"]
OUTFITS = [
    {"id": "school", "label": "校服/学生装"},
    {"id": "casual", "label": "日常便服"},
    {"id": "work", "label": "通勤/工装"},
    {"id": "home", "label": "居家服"},
    {"id": "festival_spring", "label": "新春节日装"},
    {"id": "festival_midautumn", "label": "中秋节日装"},
    {"id": "date", "label": "约会装"},
    {"id": "rain", "label": "雨天装"},
]
STATES = [
    {"id": "sleepy", "label": "犯困"},
    {"id": "sick", "label": "生病"},
    {"id": "party", "label": "派对"},
    {"id": "overtime", "label": "加班疲惫"},
]

# 居家不要签名抢 season_winter / intimate（见扩展计划 §5.2）
_CLEAR_HOME_HOOKS = frozenset({"linxi", "jingliu"})

EXTRA_OUTFITS = [
    {"id": "season_spring", "label": "春装"},
    {"id": "season_summer", "label": "夏装"},
    {"id": "season_autumn", "label": "秋装"},
    {"id": "season_winter", "label": "冬装"},
    {"id": "home_eating", "label": "居家用餐"},
    {"id": "home_sleeping", "label": "居家睡眠"},
    {"id": "work_working_focus", "label": "工位专注"},
    {"id": "intimate_lounge", "label": "私密·软"},
    {"id": "intimate_lingerie", "label": "私密·内衣"},
    {"id": "intimate_implied", "label": "私密·暗示"},
    {"id": "bridal", "label": "婚纱"},
    {"id": "maternity", "label": "怀孕日常"},
    {"id": "silk_slip", "label": "擦边·吊带睡裙"},
    {"id": "after_bath", "label": "擦边·浴后"},
    {"id": "morning_shirt", "label": "擦边·晨起衬衫"},
    {"id": "lace_night", "label": "擦边·蕾丝睡衣"},
    {"id": "towel_wrap", "label": "擦边·浴巾"},
    {"id": "backless_home", "label": "擦边·露背"},
    {"id": "bedside_hug", "label": "擦边·床边"},
    {"id": "window_night", "label": "擦边·窗边夜"},
    {"id": "max_micro_slip", "label": "魅力·极短睡裙"},
    {"id": "max_wet_cling", "label": "魅力·湿衣贴身"},
    {"id": "max_garter", "label": "魅力·吊带袜"},
    {"id": "max_kneel_pillow", "label": "魅力·跪坐抱枕"},
    {"id": "max_strappy", "label": "魅力·绑带蕾丝"},
    {"id": "max_choker", "label": "魅力·颈环"},
    {"id": "max_slit_gown", "label": "魅力·高开衩"},
    {"id": "max_over_shoulder", "label": "魅力·回眸露背"},
    {"id": "max_sofa_lie", "label": "魅力·沙发半躺"},
    {"id": "max_ribbon_cover", "label": "魅力·缎带遮挡"},
    {"id": "end_lingerie_set", "label": "结局·成套内衣"},
    {"id": "end_deep_v", "label": "结局·深V"},
    {"id": "end_lace_bra", "label": "结局·蕾丝文胸"},
    {"id": "end_sheer_cover", "label": "结局·薄纱遮挡"},
    {"id": "end_robe_open", "label": "结局·敞袍内衣"},
    {"id": "end_strappy", "label": "结局·绑带内衣"},
    {"id": "end_garter_bed", "label": "结局·吊带袜床沿"},
    {"id": "end_kneel_pillow", "label": "结局·跪坐抱枕"},
    {"id": "end_back_glance", "label": "结局·回眸露背"},
    {"id": "end_sofa_invite", "label": "结局·沙发邀约"},
    {"id": "end_choker", "label": "结局·颈环"},
    {"id": "end_wet_home", "label": "结局·湿发家居"},
    {"id": "end_window_night", "label": "结局·窗边夜"},
    {"id": "end_morning_after", "label": "结局·晨间半敞"},
    {"id": "end_close_embrace", "label": "结局·近拥抱前"},
]

BASE_ADVANCE = {
    "bridal": "婚纱进阶：白色或角色色点缀婚纱/轻婚纱+头纱或捧花，全身 VN；站姿或微侧，可轻提裙摆；浪漫庄重；禁止工作服与露点",
    "maternity": "怀孕日常：柔软孕妇装或宽松针织裙/家居裙，可见圆润孕肚轮廓；一手轻抚腹部，居家温柔；禁止紧身情趣与露点",
    "intimate_lingerie": "情趣内衣档：吊带睡裙或蕾丝内衣套装+丝袜/吊带袜，遮挡充分不露点；害羞亲昵站姿或坐姿；禁止裸露、性器官与性行为姿势",
    "intimate_implied": "暗示私密：床单/薄被/手臂遮挡或背影剪影，敏感部位不可辨；纯黑背景 VN；禁止露点、性器官与性行为姿势",
    "silk_slip": "擦边吊带睡裙：浅粉/奶白丝质短睡裙，露肩腿，可抱速写本作遮挡道具；害羞亲昵站或坐；禁止露点、性器官与性行为姿势",
    "after_bath": "浴后擦边：湿发披肩+薄白浴袍松系，锁骨与腿线可见，可持毛巾角；禁止露点与基图针织套",
    "morning_shirt": "晨起男友衬衫：过大沾淡颜料点的白衬衫只到大腿+短裤，袖口过长，睡眼惺忪害羞；禁止露点与情趣内衣",
    "lace_night": "蕾丝睡衣：柔粉蕾丝吊带睡裙+薄纱，遮挡充分，抱靠枕；禁止露点、性器官与性行为姿势",
    "towel_wrap": "浴巾遮挡：同色浴巾裹身到胸上，湿发，双手抓紧浴巾角害羞；禁止露点与性器官",
    "backless_home": "露背家居：背后交叉细带短睡裙或露背吊带，侧身回眸，遮挡充分；禁止露点",
    "bedside_hug": "床边抱膝：短睡裙坐床沿抱膝或抱枕挡胸，害羞低头；床单道具级；禁止露点与性行为姿势",
    "window_night": "窗边夜衣：薄睡裙侧光剪影级，一手拉窗帘一手护胸，敏感部位不可辨；禁止露点",
}

MAX_BASE = {
    "max_micro_slip": "魅力极限：极短丝质吊带睡裙，大腿根将露未露，遮挡充分不露点；害羞或心动；禁止露点、乳晕、性器官与性行为姿势",
    "max_wet_cling": "魅力极限：湿发+贴身不透明薄衣/白衫，曲线贴合但不透点；禁止透视乳头、露点与性器官",
    "max_garter": "魅力极限：蕾丝内衣+吊带袜袜夹，站姿或微抬腿，遮挡充分；禁止露点、性器官与性行为姿势",
    "max_kneel_pillow": "魅力极限：床沿跪坐抱枕挡胸，仰视害羞，非性行为姿势；禁止露点与性器官",
    "max_strappy": "魅力极限：细带绑带蕾丝内衣套装，遮挡充分；禁止露点、性器官与性行为姿势",
    "max_choker": "魅力极限：颈环+泰迪式蕾丝连体，手指可钩环，遮挡充分；禁止露点与性器官",
    "max_slit_gown": "魅力极限：高开衩丝质睡袍，侧腿一线，前襟仍遮挡；禁止露点与性器官",
    "max_over_shoulder": "魅力极限：露背回眸，肩带滑落将落未落，遮挡充分；禁止露点与性器官",
    "max_sofa_lie": "魅力极限：沙发半躺，睡裙上移仍遮挡胸臀；禁止露点、性器官与性行为姿势",
    "max_ribbon_cover": "魅力极限：缎带/薄纱战略遮挡，敏感部位不可辨；禁止露点、性器官与性行为姿势",
}

# §2.4 结局展示（仅 presentation / 图鉴；不进 resolve_outfit）
END_BASE = {
    "end_lingerie_set": "结局CG：成套蕾丝内衣（文胸+内裤），站姿或微侧，上胸曲线明确，遮挡充分不露点；男友视角；禁止露点、乳晕、性器官与性行为姿势",
    "end_deep_v": "结局CG：深V薄吊带或低领薄衣，乳沟压线仍遮挡，不露点；男友视角；禁止透视乳头与性器官",
    "end_lace_bra": "结局CG：蕾丝文胸为主的全身立绘，双手交叠或抱臂挡胸，遮挡充分；男友视角；禁止露点与性器官",
    "end_sheer_cover": "结局CG：薄纱/缎带战略遮挡，敏感部位不可辨；男友视角；禁止露点、性器官与性行为姿势",
    "end_robe_open": "结局CG：丝质睡袍敞开露出内衣套装，前襟仍遮挡充分；男友视角；禁止露点与性器官",
    "end_strappy": "结局CG：细带绑带蕾丝内衣套装，遮挡充分；男友视角；禁止露点、性器官与性行为姿势",
    "end_garter_bed": "结局CG：蕾丝内衣+吊带袜袜夹，床沿坐或跪，仰视男主，非性行为姿势；禁止露点与性器官",
    "end_kneel_pillow": "结局CG：跪坐抱枕挡胸，仰视告白感；禁止露点、性器官与性行为姿势",
    "end_back_glance": "结局CG：露背回眸，肩带将落未落，遮挡充分；男友视角；禁止露点与性器官",
    "end_sofa_invite": "结局CG：沙发半躺邀约姿态，睡裙/内衣仍遮挡胸臀；禁止露点、性器官与性行为姿势",
    "end_choker": "结局CG：颈环+泰迪式蕾丝，手指可钩环，遮挡充分；男友视角；禁止露点与性器官",
    "end_wet_home": "结局CG：湿发+贴身不透明家居薄衣，曲线贴合但不透点；禁止透视乳头、露点与性器官",
    "end_window_night": "结局CG：窗边夜衣剪影级私密，一手拉帘一手护胸，敏感部位不可辨；禁止露点",
    "end_morning_after": "结局CG：晨间仅内衣或男友衬衫半敞到大腿，遮挡充分；男友视角；禁止露点与性器官",
    "end_close_embrace": "结局CG：近距离拥抱前姿势（伸手/侧身靠近），内衣或薄睡裙仍遮挡；禁止性行为姿势、露点与性器官",
}

FLAVOR = {
    "xiaoyou": "插画师发色与淡颜料点可保留；可抱速写本作遮挡道具",
    "wanyu": "咖啡店员卸妆柔软向；发带/暖杏配色",
    "ruolin": "知性成熟；眼镜可摘置旁",
    "jingliu": "品牌黑/酒红；金饰卸大半",
    "aili": "蜜金波浪；可有干花/花瓣道具级遮挡",
    "linxi": "红丝带点缀；傲娇害羞",
    "yeyu": "设计师面料感；剪裁利落蕾丝",
    "taotao": "偶像卸妆后私服；禁舞台装整套照搬",
    "shizuku": "紫发软萌反差；禁图书馆员制服情趣化",
    "qiansha": "宅感褪下后的家居极限；禁工位装",
    "shiori": "文静书店员反差；禁店员围裙",
    "miara": "卸 elf cos 后本体；可留耳饰级小道具",
    "xingnai": "成年青梅私服/家居；禁止校服情趣与幼化",
    "fengyin": "大学生义妹；运动后家居向；禁止幼化",
    "qingcai": "舞者柔韧；跪坐/开衩强调腿线；禁止幼化",
    "xiaoyang": "成年同学私服；禁止校服情趣与幼化",
    "luna": "咖啡星象风；颈环/薄纱可带新月小饰",
}

T0 = {"xiaoyou", "wanyu", "ruolin", "jingliu", "aili", "linxi"}


def _load_expansion_packs() -> dict:
    archive = ROOT / "scripts" / "_archive" / "update_sprite_expansion_manifest.py"
    if not archive.is_file():
        return {}
    spec = importlib.util.spec_from_file_location("sprite_expansion_archive", archive)
    if not spec or not spec.loader:
        return {}
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return dict(getattr(mod, "PACKS", {}) or {})


def apply_intimate_expansion(manifest: dict) -> dict:
    """Merge intimate/max/end outfits, hints, signature_hooks; refresh files from disk."""
    existing_ids = {o["id"] for o in (manifest.get("outfits") or [])}
    for o in EXTRA_OUTFITS:
        if o["id"] not in existing_ids:
            manifest.setdefault("outfits", []).append(o)
            existing_ids.add(o["id"])

    packs = _load_expansion_packs()
    chars = manifest.setdefault("characters", {})
    for cid, pack in list(chars.items()):
        cast = pack.get("cast_kind") or "romance"
        folder = ROOT / "data" / "sprites" / cast / cid
        if folder.is_dir():
            files = sorted(f.name for f in folder.glob("*.png"))
            pack["existing_files"] = files
            pack["existing_emotions"] = [e for e in EMOTIONS if f"{e}.png" in files]
            pack["sprite_dir"] = str(folder.relative_to(ROOT)).replace("\\", "/")

        archived = packs.get(cid) or {}
        if archived:
            hooks = dict(archived.get("hooks") or {})
            if cid in _CLEAR_HOME_HOOKS:
                hooks.pop("home", None)
                hooks.pop("room", None)
            pack["signature_hooks"] = hooks
            if archived.get("sigs"):
                pack["signature_plan"] = list(archived["sigs"])
            oh = pack.setdefault("outfit_hints", {})
            for k, v in (archived.get("outfit_hints") or {}).items():
                oh.setdefault(k, v)

        if cast != "romance" or cid not in FLAVOR:
            continue
        oh = pack.setdefault("outfit_hints", {})
        flavor = FLAVOR[cid]
        if cid in T0:
            for k, v in BASE_ADVANCE.items():
                oh.setdefault(k, v)
            if cid == "xiaoyou":
                oh.update(BASE_ADVANCE)
        for k, v in MAX_BASE.items():
            oh[k] = f"{v}；角色差分：{flavor}"
        for k, v in END_BASE.items():
            oh[k] = f"{v}；角色差分：{flavor}"
    return manifest


def main() -> None:
    roles = json.loads((ROOT / "data" / "model_roles.json").read_text(encoding="utf-8"))
    sg = json.loads((ROOT / "data" / "social_graph.json").read_text(encoding="utf-8"))
    body_catalog = load_body_catalog()
    characters: dict = {}
    for base in roles.get("bases") or []:
        for row in base.get("characters") or []:
            cid = str(row.get("id") or "")
            prof = row.get("profile") or {}
            social = (sg.get("characters") or {}).get(cid) or {}
            cast_kind = str(social.get("cast_kind") or "romance")
            if cast_kind not in {"romance", "neutral", "npc"}:
                cast_kind = "romance"
            # 正式分档：sprites/{romance|neutral|npc}/{id}/；兼容旧顶层 sprites/{id}/
            folder = ROOT / "data" / "sprites" / cast_kind / cid
            if not folder.is_dir():
                folder = ROOT / "data" / "sprites" / cid
            files = sorted(f.name for f in folder.glob("*.png")) if folder.is_dir() else []
            emotion_bases = [e for e in EMOTIONS if f"{e}.png" in files]
            appearance = str(prof.get("appearance") or "")
            body_row = get_body_row(body_catalog, cid)
            entry = {
                "name": prof.get("name") or cid,
                "base_id": base.get("id"),
                "cast_kind": cast_kind,
                "sprite_dir": str(folder.relative_to(ROOT)).replace("\\", "/") if folder.is_dir() else "",
                "role_to_pc": social.get("role_to_pc") or "",
                "appearance_lock": appearance,
                "existing_emotions": emotion_bases,
                "existing_files": files,
                "priority": "stock_keep",
                "outfit_plan": [o["id"] for o in OUTFITS],
                "state_plan": [s["id"] for s in STATES],
                "prompt_seed": (
                    f"visual novel anime character sprite, same face and hair, {appearance}"
                ),
                "gen_policy": "image_edit_from_live_neutral",
            }
            if body_row:
                entry["body_ref"] = cid
                entry["body_lock"] = body_lock_short(body_row)
            characters[cid] = entry

    # 合并旧 manifest 手工字段，避免 rebuild 丢掉扩包元数据
    old_path = ROOT / "data" / "sprite_gen_manifest.json"
    old_outfits = list(OUTFITS)
    old_states = list(STATES)
    if old_path.is_file():
        old = json.loads(old_path.read_text(encoding="utf-8"))
        if old.get("outfits"):
            old_outfits = list(old["outfits"])
        if old.get("states"):
            old_states = list(old["states"])
        for cid, old_row in (old.get("characters") or {}).items():
            if cid not in characters:
                continue
            for key in (
                "clothing_forbid",
                "outfit_hints",
                "signature_hooks",
                "signature_plan",
                "state_hints",
                "gen_policy",
                "body_ref",
                "body_lock",
            ):
                if old_row.get(key) and not characters[cid].get(key):
                    characters[cid][key] = old_row[key]
            for plan_key in ("outfit_plan", "state_plan"):
                old_plan = old_row.get(plan_key) or []
                if not old_plan:
                    continue
                cur = list(characters[cid].get(plan_key) or [])
                for item in old_plan:
                    if item not in cur:
                        cur.append(item)
                characters[cid][plan_key] = cur

    manifest = {
        "version": 1,
        "naming": {
            "default": "{emotion}.png",
            "outfit": "{outfit}_{emotion}.png",
            "outfit_state": "{outfit}_{state}_{emotion}.png",
            "fallback": "If outfit/state file missing, use {emotion}.png",
        },
        "core_emotions": EMOTIONS,
        "outfits": old_outfits,
        "states": old_states,
        "staging_dir": "data/sprites/_staging",
        "body_catalog": "data/body_catalog.json",
        "policy": {
            "never_delete_existing": True,
            "main_cast_target": 12,
            "non_main_reuse_stock": True,
            "generate_after_pick": True,
        },
        "characters": characters,
    }
    apply_intimate_expansion(manifest)

    out = ROOT / "data" / "sprite_gen_manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    xy = (manifest.get("characters") or {}).get("xiaoyou") or {}
    print(f"wrote {out} ({len(characters)} characters)")
    print(f"outfits {len(manifest.get('outfits') or [])}")
    print(f"xiaoyou files {len(xy.get('existing_files') or [])} hints {len(xy.get('outfit_hints') or {})}")


if __name__ == "__main__":
    main()
