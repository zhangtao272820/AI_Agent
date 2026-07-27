"""重演绎意图：LLM 解析用户描述 → remix_plan JSON。"""
from __future__ import annotations

import json
import logging
from typing import Any

from .config import Settings
from .remix_presets import (
    band_parts_to_track_mappings,
    build_band_parts,
    get_style_spec,
    infer_style_hint,
    selection_brief,
)
from .llm import (
    EmitFn,
    _client,
    _extract_json,
    _intent_model,
    _stream_chat_deltas,
    _truncate,
)

logger = logging.getLogger(__name__)

REMIX_INTENT_SYSTEM = (
    "你是乐队编曲家与风格识别器，为重演绎输出 remix_plan（JSON，不写音符）。"
    "你需要先从上传摘要判断歌曲更像哪类风格，再按风格分配 band_parts 音色、tempo_bpm 与织体密度。"
    "引擎会生成统一节拍的多声部 MIDI（主旋律/贝斯/和声/铺底/鼓组），你负责把旋律突出且不破坏稳定性。"
    "字段："
    "style_hint(可选：mandopop|jpop|classical|jazz|folk|electronic)，"
    "separate_mode(音频 2stems，MIDI none)，keep_vocal(false)，"
    "arrangement_mode(band|light，默认 band)，"
    "remix_style(与所选曲风 id 一致；若未选择，则可用风格判断结果填充)，"
    "band_parts(array: {role, channel, instrument}；channel 0-3 旋律/贝斯/和声/铺底，9=鼓不改 instrument)，"
    "melody_priority(0-1，默认 0.85；越高越突出主旋律)，"
    "tempo_bpm(可选 60-200)，harmony_style(pop|jazz|classical|folk)，"
    "track_mappings(可由 band_parts 推导，channel+to_instrument)，"
    "notes(一句中文编曲思路)，confidence(0-1)。"
    "须丰富、像完整乐队，不要单一乐器独奏。"
)

PATCH_REMIX_JUDGE_SYSTEM = (
    "你是重演绎参数调整器。根据用户需求、当前 remix_plan、技术指标摘要、质检 JSON（overall、suggestions 等），"
    "输出修正后的完整 remix_plan（字段与规划器相同），可增加 patch_note(str 中文一句)。仅输出 JSON。"
)


def _normalize_remix_plan(data: dict[str, Any]) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "style_hint": "mandopop",
        "separate_mode": "auto",
        "keep_vocal": False,
        "vocal_gain_db": 0.0,
        "instrumental_gain_db": -2.0,
        "track_mappings": [],
        "harmony_style": "pop",
        "arrangement_mode": "band",
        "band_parts": [],
        "tempo_bpm": None,
        "melody_priority": 0.85,
        "notes": "",
        "confidence": 0.75,
    }
    out = {**defaults, **{k: v for k, v in data.items() if v is not None}}
    hint = str(out.get("style_hint") or "mandopop").strip().lower()
    if hint not in ("mandopop", "jpop", "classical", "jazz", "folk", "electronic"):
        hint = "mandopop"
    out["style_hint"] = hint
    sm = str(out.get("separate_mode") or "auto").strip().lower()
    if sm not in ("auto", "2stems", "4stems", "none"):
        sm = "auto"
    out["separate_mode"] = sm
    if "keep_vocal" not in data:
        out["keep_vocal"] = False
    am = str(out.get("arrangement_mode") or "band").strip().lower()
    if am == "conducted":
        am = "band"
    if am not in ("band", "light", "off", "none", "melody_only", "melody", "vocal_band"):
        am = "band"
    if am == "none":
        am = "off"
    out["arrangement_mode"] = am
    bp = out.get("band_parts")
    if not isinstance(bp, list):
        bp = []
    out["band_parts"] = [p for p in bp if isinstance(p, dict)][:8]
    try:
        tb = out.get("tempo_bpm")
        out["tempo_bpm"] = float(tb) if tb is not None and float(tb) > 0 else None
    except (TypeError, ValueError):
        out["tempo_bpm"] = None
    try:
        out["vocal_gain_db"] = float(out.get("vocal_gain_db", 0))
    except (TypeError, ValueError):
        out["vocal_gain_db"] = 0.0
    try:
        out["instrumental_gain_db"] = float(out.get("instrumental_gain_db", -2))
    except (TypeError, ValueError):
        out["instrumental_gain_db"] = -2.0
    hm = str(out.get("harmony_style") or "pop").lower()
    if hm not in ("pop", "jazz", "classical", "folk"):
        hm = "pop"
    out["harmony_style"] = hm
    maps = out.get("track_mappings") or out.get("mappings")
    if not isinstance(maps, list):
        maps = []
    out["track_mappings"] = [m for m in maps if isinstance(m, dict)][:16]
    try:
        out["melody_priority"] = max(0.0, min(1.0, float(out.get("melody_priority", 0.85))))
    except (TypeError, ValueError):
        out["melody_priority"] = 0.85
    try:
        out["confidence"] = max(0.0, min(1.0, float(out.get("confidence", 0.75))))
    except (TypeError, ValueError):
        out["confidence"] = 0.75
    return out


def _compact_analysis(analysis: dict[str, Any] | None) -> dict[str, Any]:
    if not analysis:
        return {}
    keys = (
        "filename",
        "analysis_mode",
        "suffix",
        "duration_seconds",
        "tracks",
        "notes_estimate",
        "has_vocal",
        "vocal_label",
        "suggested_workflow",
        "lyrics_language",
        "lyrics_source",
        "transcription_whisper_language",
    )
    out = {k: analysis[k] for k in keys if k in analysis and analysis[k] not in (None, "", [])}
    lt = str(analysis.get("lyrics_text") or "").strip()
    if lt:
        out["lyrics_excerpt"] = _truncate(lt, 1200)
    return out


def _merge_band_parts(style_id: str, llm_parts: list[Any] | None) -> list[dict[str, Any]]:
    base = build_band_parts(style_id)
    if not isinstance(llm_parts, list) or len(llm_parts) < 3:
        return base
    llm_by_role = {
        str(p.get("role")): p
        for p in llm_parts
        if isinstance(p, dict) and p.get("role")
    }
    out: list[dict[str, Any]] = []
    for p in base:
        role = str(p.get("role") or "")
        if role in llm_by_role:
            inst = str(llm_by_role[role].get("instrument") or llm_by_role[role].get("to") or "").strip()
            if inst:
                out.append({**p, "instrument": inst})
                continue
        out.append(dict(p))
    return out


def base_remix_plan_from_selection(
    style_id: str,
    *,
    analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    spec = get_style_spec(style_id) or get_style_spec("mandopop") or {}
    mode = analysis.get("analysis_mode") if analysis else None
    separate = "none" if mode == "midi" else "2stems"
    hm = str(spec.get("harmony_style") or "pop").lower()
    if hm not in ("pop", "jazz", "classical", "folk"):
        hm = "pop"
    band = build_band_parts(style_id)
    return _normalize_remix_plan(
        {
            "style_hint": style_id,
            "separate_mode": separate,
            "keep_vocal": False,
            "band_parts": band,
            "track_mappings": band_parts_to_track_mappings(band),
            "harmony_style": hm,
            "notes": selection_brief(style_id),
            "confidence": 0.85,
            "remix_style": style_id,
            "arrangement_mode": "band",
            "melody_priority": 0.9,
        }
    )


def parse_remix_intent_from_selection(
    settings: Settings,
    *,
    style_id: str,
    analysis: dict[str, Any] | None,
    filename: str = "",
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    """曲风 → 乐队编制底稿 + LLM 按音频气质微调声部。"""
    if style_id == "auto":
        style_id = infer_style_hint(analysis, filename)
    base = base_remix_plan_from_selection(style_id, analysis=analysis)
    brief = selection_brief(style_id)
    client = _client(settings)
    model = _intent_model(settings)
    user_in = (
        f"用户选择：{brief}\n"
        f"风格判断：{style_id}\n"
        f"规则底稿 plan：{json.dumps(base, ensure_ascii=False)}\n"
        f"文件名：{_truncate(filename, 200)}\n"
        f"分析摘要：{json.dumps(_compact_analysis(analysis), ensure_ascii=False)}\n"
        "请输出完整 remix_plan；可微调 style_hint、band_parts 各声部 instrument、tempo_bpm 与 notes，"
        "保持旋律突出、乐队织体丰富、节拍统一。"
    )
    mt = min(768, max(256, int(getattr(settings, "remix_intent_max_tokens", 512))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": REMIX_INTENT_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.35,
        max_tokens=mt,
    )
    use_stream = bool(stream_emit and getattr(settings, "stream_model_thinking", True))
    raw = "{}"
    if use_stream:
        try:
            _r, raw = _stream_chat_deltas(
                client,
                emit=stream_emit,
                extra_body={"enable_thinking": True},
                **base_kw,
            )
            raw = (raw or "").strip() or "{}"
        except Exception as e:
            logger.info("remix selection intent stream failed (%s), fallback", e)
            use_stream = False
    if not use_stream:
        try:
            completion = client.chat.completions.create(
                **base_kw,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.info("remix selection intent json_object failed (%s), retry", e)
            completion = client.chat.completions.create(**base_kw)
        raw = completion.choices[0].message.content or "{}"
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("remix selection intent parse failed, use base plan")
        return base
    if not isinstance(data, dict):
        return base
    merged = {**base, **{k: v for k, v in data.items() if v is not None}}
    merged["remix_style"] = style_id
    merged["style_hint"] = str(merged.get("style_hint") or style_id or "mandopop").strip().lower()
    if merged.get("style_hint") == "auto":
        merged["style_hint"] = style_hint
    merged["band_parts"] = _merge_band_parts(style_id, merged.get("band_parts"))
    merged["track_mappings"] = band_parts_to_track_mappings(merged["band_parts"])
    return _normalize_remix_plan(merged)


def parse_remix_intent(
    settings: Settings,
    *,
    user_prompt: str,
    analysis: dict[str, Any] | None,
    filename: str = "",
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    client = _client(settings)
    model = _intent_model(settings)
    style_hint = infer_style_hint(analysis, filename)
    user_in = (
        f"重演绎需求：{_truncate(user_prompt, settings.intent_user_max_chars)}\n"
        f"文件名：{_truncate(filename, 200)}\n"
        f"风格判断：{style_hint}\n"
        f"分析摘要：{json.dumps(_compact_analysis(analysis), ensure_ascii=False)}\n"
        "请优先决定曲风、乐器组合与旋律突出程度，再输出完整 remix_plan。\n"
    )
    mt = min(768, max(256, int(getattr(settings, "remix_intent_max_tokens", 512))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": REMIX_INTENT_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.35,
        max_tokens=mt,
    )
    use_stream = bool(stream_emit and getattr(settings, "stream_model_thinking", True))
    raw = "{}"
    if use_stream:
        try:
            _r, raw = _stream_chat_deltas(
                client,
                emit=stream_emit,
                extra_body={"enable_thinking": True},
                **base_kw,
            )
            raw = (raw or "").strip() or "{}"
        except Exception as e:
            logger.info("remix intent stream failed (%s), fallback", e)
            use_stream = False
    if not use_stream:
        try:
            completion = client.chat.completions.create(
                **base_kw,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.info("remix intent json_object failed (%s), retry", e)
            completion = client.chat.completions.create(**base_kw)
        raw = completion.choices[0].message.content or "{}"
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("remix intent parse failed raw=%s", raw[:400])
        data = {}
    return _normalize_remix_plan(data if isinstance(data, dict) else {})


def patch_remix_plan_from_judge(
    settings: Settings,
    *,
    user_prompt: str,
    plan: dict[str, Any],
    judge_result: dict[str, Any],
    technical_summary: str,
    attempt_index: int,
    stream_emit: EmitFn | None = None,
) -> tuple[dict[str, Any], str]:
    base = _normalize_remix_plan({**plan})
    if not getattr(settings, "enable_remix_judge_patch", True):
        return base, ""

    client = _client(settings)
    model = _intent_model(settings)
    judge_compact = {
        k: judge_result.get(k)
        for k in ("overall", "match", "melody", "harmony", "emotion_fit", "suggestions")
    }
    user_in = (
        f"需求：{_truncate(user_prompt, settings.judge_user_max_chars)}\n"
        f"当前 plan：{json.dumps(base, ensure_ascii=False)}\n"
        f"技术指标：{_truncate(technical_summary, 700)}\n"
        f"第 {attempt_index + 1} 次重试；质检：{json.dumps(judge_compact, ensure_ascii=False)}\n"
    )
    mt = max(200, min(768, int(getattr(settings, "remix_patch_max_tokens", 384))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": PATCH_REMIX_JUDGE_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.25,
        max_tokens=mt,
    )
    use_stream = bool(stream_emit and getattr(settings, "stream_model_thinking", True))
    raw = "{}"
    if use_stream:
        try:
            _r, raw = _stream_chat_deltas(
                client,
                emit=stream_emit,
                extra_body={"enable_thinking": True},
                **base_kw,
            )
            raw = (raw or "").strip() or "{}"
        except Exception:
            use_stream = False
    if not use_stream:
        try:
            completion = client.chat.completions.create(
                **base_kw,
                response_format={"type": "json_object"},
            )
        except Exception:
            completion = client.chat.completions.create(**base_kw)
        raw = completion.choices[0].message.content or "{}"
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        return base, ""
    if not isinstance(data, dict):
        return base, ""
    patch_note = str(data.pop("patch_note", "") or "").strip()[:500]
    return _normalize_remix_plan({**base, **{k: v for k, v in data.items() if v is not None}}), patch_note
