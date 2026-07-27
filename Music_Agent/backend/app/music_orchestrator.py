"""多模型音乐编排器：风格识别 → 配器规划 → 旋律保真 → 质检修正。"""
from __future__ import annotations

import json
import logging
from typing import Any

from .config import Settings
from .llm import _client, _extract_json, _intent_model, _judge_model_text, _truncate
from .midi_analyze import build_track_mappings_from_roles
from .instrument_swap import infer_swap_lead_instrument
from .remix_instrumental import _band_parts_with_swap, apply_instrumental_remix_plan, is_instrumental_audio
from .remix_intent import _normalize_remix_plan, _compact_analysis
from .remix_presets import build_band_parts, band_parts_to_track_mappings, infer_style_hint
from .remix_timbral import apply_timbral_remix_defaults
from .remix_vocal_pop import apply_vocal_pop_plan, is_vocal_pop_analysis, vocal_pop_band_parts

logger = logging.getLogger(__name__)

STYLE_ROUTER_SYSTEM = (
    "你是音乐风格识别器。根据文件名、歌词/转写、时长、BPM、人声与情绪线索，"
    "判断最适合的重编配风格与乐器家族。仅输出 JSON。"
    "字段：style_hint(mandopop|jpop|classical|jazz|folk|electronic|bgm),"
    "confidence(0-1), tempo_bias(slow|mid|fast), mood(str),"
    "instrument_family(str[]，如 piano/guitar/strings/synth/flute/sax),"
    "melody_priority(0-1，人声或旋律明显时≥0.9),"
    "band_parts(可选 array: {role, channel, instrument}，channel 0-3 旋律/贝斯/和声/铺底，9=鼓),"
    "notes(str 一句中文编曲理由)。"
)

ARRANGER_SYSTEM = (
    "你是资深编曲家，做「轻量重演绎」：必须完整保留上传曲的主旋律轮廓，只换音色与少量伴奏。"
    "输出 remix_plan JSON；band_parts 为各声部 GM 乐器（piano/guitar/violin/flute/sax/bass/strings/synth 等），"
    "channel 0=主旋律，1=贝斯，2=和声，3=铺底，9=鼓。"
    "若 analysis_mode=midi：arrangement_mode 必须 off；按 midi_tracks 各轨 role_hint 分配 instrument，"
    "track_mappings 须含 track_index+channel+to；禁止改音符、禁止重编 drum。"
    "若 analysis_mode=audio 且无人声纯器乐：style_hint 优先 bgm；band_parts 含 melody/bass/harmony/pad 四声部，"
    "instrument 用管弦声学音色（flute/violin/cello/strings/harp），禁止 music_box/marimba 等电子打击音色；"
    "原曲 piano 则主旋律换 flute/violin/harp，禁止仍用 piano。"
    "不要改调性、不要重写旋律线；和声织体保持稀疏。"
)

MELODY_GUARD_SYSTEM = (
    "你是旋律保真守门员。根据当前 remix_plan、风格识别结果与技术摘要，"
    "修正 plan 中会压住主旋律的倾向，必要时降低和声密度、收紧铺底、提高 melody_priority。"
    "仅输出 JSON。"
)

JUDGE_PATCH_SYSTEM = (
    "你是重演绎修正器。根据质检 JSON、技术摘要与当前 plan，输出修正后的完整 remix_plan JSON。"
    "重点修正：旋律可听性、配器贴合度、风格一致性、节奏稳定性。"
)


def _compact_for_router(analysis: dict[str, Any] | None, filename: str) -> str:
    payload = _compact_analysis(analysis)
    payload["filename"] = filename
    return json.dumps(payload, ensure_ascii=False)


def infer_style_profile(settings: Settings, *, analysis: dict[str, Any] | None, filename: str) -> dict[str, Any]:
    base_hint = infer_style_hint(analysis, filename)
    if not getattr(settings, "enable_style_router_llm", True):
        return {
            "style_hint": base_hint,
            "confidence": 0.55,
            "tempo_bias": "mid",
            "mood": "neutral",
            "instrument_family": ["piano", "strings"],
            "melody_priority": 0.88,
            "notes": "离线风格默认值。",
        }

    try:
        client = _client(settings)
    except RuntimeError:
        return {
            "style_hint": base_hint,
            "confidence": 0.55,
            "tempo_bias": "mid",
            "mood": "neutral",
            "instrument_family": ["piano", "strings"],
            "melody_priority": 0.88,
            "notes": "无 API Key，使用启发式风格。",
        }

    user_in = (
        f"默认推断：{base_hint}\n"
        f"文件名：{_truncate(filename, 200)}\n"
        f"摘要：{_compact_for_router(analysis, filename)}\n"
        "请判断最适合的重编曲风格，并给出旋律突出程度。"
    )
    model = _intent_model(settings)
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": STYLE_ROUTER_SYSTEM},
                {"role": "user", "content": user_in},
            ],
            temperature=0.2,
            max_tokens=320,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
        data = _extract_json(raw)
    except Exception as ex:
        logger.info("style router fallback: %s", ex)
        return {
            "style_hint": base_hint,
            "confidence": 0.55,
            "tempo_bias": "mid",
            "mood": "neutral",
            "instrument_family": ["piano", "strings"],
            "melody_priority": 0.88,
            "notes": "风格识别失败，采用保守默认。",
        }

    if not isinstance(data, dict):
        return {
            "style_hint": base_hint,
            "confidence": 0.55,
            "tempo_bias": "mid",
            "mood": "neutral",
            "instrument_family": ["piano", "strings"],
            "melody_priority": 0.88,
            "notes": "风格识别结果无效，采用保守默认。",
        }

    style_hint = str(data.get("style_hint") or base_hint).strip().lower()
    if style_hint not in ("mandopop", "jpop", "classical", "jazz", "folk", "electronic"):
        style_hint = base_hint
    melody_priority = float(data.get("melody_priority") or 0.88)
    band_parts = data.get("band_parts")
    if not isinstance(band_parts, list):
        band_parts = []
    band_parts = [p for p in band_parts if isinstance(p, dict)][:8]
    return {
        "style_hint": style_hint,
        "confidence": max(0.0, min(1.0, float(data.get("confidence") or 0.55))),
        "tempo_bias": str(data.get("tempo_bias") or "mid").strip().lower(),
        "mood": str(data.get("mood") or "neutral").strip().lower(),
        "instrument_family": [str(x) for x in (data.get("instrument_family") or ["piano", "strings"])][:6],
        "melody_priority": max(0.0, min(1.0, melody_priority)),
        "band_parts": band_parts,
        "notes": str(data.get("notes") or "").strip()[:300],
    }


def _merge_band_parts(style_id: str, llm_parts: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """LLM 定制编制优先，缺省声部用曲风预设补齐。"""
    base = build_band_parts(style_id)
    if not llm_parts:
        return base
    by_role: dict[str, dict[str, Any]] = {}
    for p in base:
        role = str(p.get("role") or "")
        if role:
            by_role[role] = dict(p)
    for p in llm_parts:
        if not isinstance(p, dict):
            continue
        role = str(p.get("role") or "").strip()
        if not role:
            continue
        inst = str(p.get("instrument") or p.get("to") or "").strip()
        merged = {**by_role.get(role, {}), **p}
        if inst:
            merged["instrument"] = inst
        by_role[role] = merged
    order = ["melody", "bass", "harmony", "pad", "drums"]
    out: list[dict[str, Any]] = []
    for role in order:
        if role in by_role:
            out.append(by_role[role])
    for role, p in by_role.items():
        if role not in order:
            out.append(p)
    return out or base


def build_remix_plan(settings: Settings, *, analysis: dict[str, Any] | None, filename: str, user_prompt: str = "") -> dict[str, Any]:
    style = infer_style_profile(settings, analysis=analysis, filename=filename)
    style_id = style["style_hint"]
    is_midi = (analysis or {}).get("analysis_mode") == "midi"
    vocal_pop = is_vocal_pop_analysis(analysis)
    instrumental = is_instrumental_audio(analysis)
    midi_tracks = (analysis or {}).get("midi_tracks") or []
    if instrumental and not is_midi:
        lead_inst, _src = infer_swap_lead_instrument(analysis, style, filename)
        sid = "bgm" if style_id not in ("classical", "folk", "jazz", "electronic", "jpop", "mandopop") else style_id
        band = _band_parts_with_swap(sid, lead_inst, _src)
        melody_pri = max(float(style.get("melody_priority", 0.88)), 0.96)
        arr_mode = "instrumental_band"
        keep_vocal = False
        track_maps = band_parts_to_track_mappings(band)
        style_id = sid
    elif vocal_pop and not is_midi:
        band = vocal_pop_band_parts(style_id)
        melody_pri = max(float(style.get("melody_priority", 0.88)), 0.95)
        arr_mode = "vocal_band"
        keep_vocal = False
        track_maps = band_parts_to_track_mappings(band)
    elif is_midi:
        band = _merge_band_parts(style_id, style.get("band_parts"))
        melody_pri = max(float(style.get("melody_priority", 0.88)), 0.88)
        arr_mode = "off"
        keep_vocal = False
        track_maps = (
            build_track_mappings_from_roles(midi_tracks, band)
            if midi_tracks
            else band_parts_to_track_mappings(band)
        )
    else:
        band = _merge_band_parts(style_id, style.get("band_parts"))
        melody_pri = max(float(style.get("melody_priority", 0.88)), 0.9)
        arr_mode = "light"
        keep_vocal = False
        track_maps = band_parts_to_track_mappings(band)
    remix_mode = (
        "midi_swap"
        if is_midi
        else ("instrumental_band" if instrumental else ("instrumental_hybrid" if instrumental else "timbral"))
    )
    base = {
        "style_hint": style_id,
        "remix_style": style_id,
        "remix_mode": remix_mode,
        "arrangement_mode": arr_mode,
        "separate_mode": "none" if is_midi else ("4stems" if instrumental else "2stems"),
        "melody_priority": melody_pri,
        "keep_vocal": keep_vocal,
        "band_parts": band,
        "track_mappings": track_maps,
        "midi_tracks": midi_tracks if is_midi else [],
        "harmony_style": "jazz" if style_id == "jazz" else ("classical" if style_id == "classical" else ("folk" if style_id == "folk" else "pop")),
        "notes": style.get("notes") or "",
        "confidence": style.get("confidence", 0.55),
        "tempo_bias": style.get("tempo_bias"),
        "mood": style.get("mood"),
        "instrument_family": style.get("instrument_family"),
    }
    base = apply_timbral_remix_defaults(base, analysis=analysis, settings=settings)
    if instrumental and not is_midi:
        base = apply_instrumental_remix_plan(base, analysis=analysis, settings=settings)
    if not getattr(settings, "enable_music_orchestrator", True):
        return _normalize_remix_plan(base)

    try:
        client = _client(settings)
    except RuntimeError:
        return _normalize_remix_plan(base)

    user_in = (
        f"风格识别：{json.dumps(style, ensure_ascii=False)}\n"
        f"文件名：{_truncate(filename, 200)}\n"
        f"用户重演绎说明：{_truncate(user_prompt, settings.intent_user_max_chars)}\n"
        f"摘要：{_compact_for_router(analysis, filename)}\n"
        f"基础 plan：{json.dumps(base, ensure_ascii=False)}\n"
        "请输出完整 remix_plan。要求：主旋律必须清晰可辨；仅轻量换乐器与稀疏织体，勿全曲重编。"
    )
    model = _intent_model(settings)
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": ARRANGER_SYSTEM},
                {"role": "user", "content": user_in},
            ],
            temperature=0.35,
            max_tokens=int(getattr(settings, "music_orchestrator_max_tokens", 700)),
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
        data = _extract_json(raw)
        if isinstance(data, dict):
            merged = {**base, **{k: v for k, v in data.items() if v is not None}}
            merged["style_hint"] = str(merged.get("style_hint") or style_id).strip().lower()
            if merged["style_hint"] not in (
                "mandopop",
                "jpop",
                "classical",
                "jazz",
                "folk",
                "electronic",
                "bgm",
            ):
                merged["style_hint"] = style_id
            merged["remix_style"] = merged["style_hint"]
            llm_bp = merged.get("band_parts") if isinstance(merged.get("band_parts"), list) else style.get("band_parts")
            merged["band_parts"] = _merge_band_parts(merged["style_hint"], llm_bp)
            if is_midi:
                mt = merged.get("midi_tracks") or midi_tracks
                merged["midi_tracks"] = mt
                merged["track_mappings"] = (
                    build_track_mappings_from_roles(mt, merged["band_parts"])
                    if mt
                    else band_parts_to_track_mappings(merged["band_parts"])
                )
                merged["arrangement_mode"] = "off"
                merged["remix_mode"] = "midi_swap"
            elif vocal_pop:
                merged["track_mappings"] = band_parts_to_track_mappings(merged["band_parts"])
                merged["arrangement_mode"] = "vocal_band"
                merged["keep_vocal"] = False
                merged["band_parts"] = vocal_pop_band_parts(merged["style_hint"])
                merged["track_mappings"] = band_parts_to_track_mappings(merged["band_parts"])
            elif instrumental and not is_midi:
                merged["arrangement_mode"] = "off"
                merged["remix_mode"] = "instrumental_hybrid"
            else:
                merged["track_mappings"] = band_parts_to_track_mappings(merged["band_parts"])
            if not is_midi and not vocal_pop and not instrumental:
                merged["arrangement_mode"] = "light"
            if getattr(settings, "enable_melody_guard_llm", True):
                merged["melody_priority"] = max(
                    float(merged.get("melody_priority") or melody_pri),
                    0.95 if vocal_pop else (0.9 if not is_midi else 0.85),
                )
            merged = apply_vocal_pop_plan(merged, analysis=analysis, settings=settings)
            merged = apply_timbral_remix_defaults(merged, analysis=analysis, settings=settings)
            if instrumental and not is_midi:
                merged = apply_instrumental_remix_plan(
                    merged, analysis=analysis, settings=settings
                )
            return _normalize_remix_plan(merged)
    except Exception as ex:
        logger.info("remix planner fallback: %s", ex)
    base = apply_vocal_pop_plan(base, analysis=analysis, settings=settings)
    base = apply_timbral_remix_defaults(base, analysis=analysis, settings=settings)
    return _normalize_remix_plan(base)


def melody_guard_plan(settings: Settings, *, plan: dict[str, Any], analysis: dict[str, Any] | None, filename: str, technical_summary: str = "") -> dict[str, Any]:
    base = _normalize_remix_plan({**plan})
    if not getattr(settings, "enable_melody_guard_llm", True):
        base["melody_priority"] = max(float(base.get("melody_priority") or 0.88), 0.9)
        return base
    try:
        client = _client(settings)
    except RuntimeError:
        base["melody_priority"] = max(float(base.get("melody_priority") or 0.88), 0.9)
        return base
    user_in = (
        f"文件名：{_truncate(filename, 200)}\n"
        f"摘要：{_compact_for_router(analysis, filename)}\n"
        f"技术摘要：{_truncate(technical_summary, 700)}\n"
        f"当前 plan：{json.dumps(base, ensure_ascii=False)}\n"
        "请输出修正后的完整 remix_plan，并尽可能提高主旋律清晰度。"
    )
    model = _intent_model(settings)
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": MELODY_GUARD_SYSTEM},
                {"role": "user", "content": user_in},
            ],
            temperature=0.2,
            max_tokens=int(getattr(settings, "melody_guard_max_tokens", 420)),
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
        data = _extract_json(raw)
        if isinstance(data, dict):
            merged = {**base, **{k: v for k, v in data.items() if v is not None}}
            merged["melody_priority"] = max(float(merged.get("melody_priority") or 0.9), 0.9)
            return _normalize_remix_plan(merged)
    except Exception as ex:
        logger.info("melody guard fallback: %s", ex)
    base["melody_priority"] = max(float(base.get("melody_priority") or 0.88), 0.9)
    return base


def patch_remix_plan_with_judge(settings: Settings, *, user_prompt: str, plan: dict[str, Any], judge_result: dict[str, Any], technical_summary: str, attempt_index: int) -> tuple[dict[str, Any], str]:
    base = _normalize_remix_plan({**plan})
    try:
        client = _client(settings)
    except RuntimeError:
        return base, ""
    model = _judge_model_text(settings)
    user_in = (
        f"需求：{_truncate(user_prompt, settings.judge_user_max_chars)}\n"
        f"当前 plan：{json.dumps(base, ensure_ascii=False)}\n"
        f"技术摘要：{_truncate(technical_summary, 700)}\n"
        f"质检：{json.dumps(judge_result, ensure_ascii=False)}\n"
        f"第 {attempt_index + 1} 次修正。\n"
    )
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": JUDGE_PATCH_SYSTEM},
                {"role": "user", "content": user_in},
            ],
            temperature=0.2,
            max_tokens=420,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
        data = _extract_json(raw)
        if isinstance(data, dict):
            patch_note = str(data.pop("patch_note", "") or "")[:500]
            return _normalize_remix_plan({**base, **{k: v for k, v in data.items() if v is not None}}), patch_note
    except Exception as ex:
        logger.info("remix patch fallback: %s", ex)
    return base, ""
