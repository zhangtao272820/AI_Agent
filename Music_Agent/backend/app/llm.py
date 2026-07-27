import base64
import json
import logging
import re
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from openai import OpenAI

from .config import Settings
from .intent_enrich import enrich_intent_from_user_text

logger = logging.getLogger(__name__)

# 紧凑系统提示，减少 system 侧 token（字段含义不变）
INTENT_SYSTEM = (
    "你是资深编曲家兼音乐意图解析器。根据用户描述输出一个 JSON，无 markdown。"
    "字段：key(调性中文如 D大调), tempo(40-200), emotion(calm|happy|sad|energetic 等英文), "
    "structure(如 intro-A-outro、A-B-A、verse-chorus), "
    "instruments(str[] 须与用户提到的乐器一致，中文或英文，如 guzheng, flute, pipa, piano, strings, drums), "
    "duration_seconds(15-180), style(pop|jazz|classical|folk|chinese|electronic), "
    "harmony_style(pop|jazz|classical|folk), confidence(0-1)。"
    "山水画/纪录片/中国风：style=chinese，instruments 含 flute+guzheng 或 strings，tempo 偏慢，emotion=calm。"
    "不同描述须给出不同配器组合，勿默认一律 piano。"
)

PATCH_INTENT_JUDGE_SYSTEM = (
    "你是音乐生成参数调整器。根据用户原始需求、当前结构化意图、生成结果技术指标摘要、"
    "质检 JSON（含 suggestions、overall、melody、harmony、match、emotion_fit），"
    "输出下一轮 MIDI 生成应采用的完整意图 JSON（字段与意图解析器一致）："
    "key, tempo, emotion, structure, instruments, duration_seconds, style, harmony_style, confidence。"
    "优先依据 suggestions 做针对性修改（tempo、emotion、structure、instruments、harmony_style 等）；"
    "若 suggestions 含糊，可微调 tempo±8、emotion、harmony_style；勿无故更换 key。"
    "另可增加字段 patch_note(str，中文一句，说明本轮相对上一轮改了什么)。"
    "仅输出一个 JSON，无 markdown。"
)

REFINE_INTENT_SYSTEM = (
    "音乐意图增量修订。输入包含原始创作描述、上一轮完整结构化意图、用户本轮修改说明。"
    "输出合并后的完整意图 JSON（字段与意图解析器相同）。未提及的字段沿用上一轮；"
    "按修改说明更新相关项（如速度、情绪、曲式、配器、和声风格、时长）。"
    "仅输出一个 JSON，无 markdown。"
)

JUDGE_SYSTEM_VL = (
    "音乐质检。仅输出 JSON：overall,match,melody,harmony,emotion_fit 为 1-10 整数；"
    "suggestions 为中文一两句。无 markdown。"
)

JUDGE_SYSTEM_OMNI = (
    "听音频+文本后质检。仅输出 JSON：overall,match,melody,harmony,emotion_fit 为 1-10 整数；"
    "suggestions 中文一两句。无 markdown。"
)


def _client(settings: Settings) -> OpenAI:
    """OpenAI 兼容客户端：意图解析与评判与百炼共用 Key；任填 OPENAI_API_KEY 或 DASHSCOPE_API_KEY 即可。"""
    key = (settings.openai_api_key or settings.dashscope_api_key or "").strip()
    if not key:
        raise RuntimeError(
            "未配置 API Key：请设置环境变量 OPENAI_API_KEY 或 DASHSCOPE_API_KEY（阿里云百炼 DashScope）"
        )
    return OpenAI(api_key=key, base_url=settings.openai_base_url)


def _intent_model(settings: Settings) -> str:
    if settings.use_qwen3_vl_for_intent:
        return (settings.qwen3_vl_model or "qwen3-vl-plus").strip()
    return settings.openai_model


def _judge_model_text(settings: Settings) -> str:
    if settings.use_qwen3_vl_for_judge:
        return (settings.qwen3_vl_model or "qwen3-vl-plus").strip()
    return settings.openai_model


def _truncate(text: str, max_chars: int) -> str:
    text = (text or "").strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return text[: max_chars - 1] + "…"


def _compact_intent_for_judge(intent: dict[str, Any]) -> dict[str, Any]:
    """评判只需结构化参数以省 token。"""
    keys = (
        "key",
        "tempo",
        "emotion",
        "structure",
        "instruments",
        "duration_seconds",
        "style",
        "harmony_style",
        "confidence",
    )
    return {k: intent[k] for k in keys if k in intent}


EmitFn = Callable[[str, str], None]  # (kind, chunk) kind: reasoning | content


def _emit_chunk(emit: EmitFn | None, kind: str, chunk: str | None) -> None:
    if emit and chunk:
        emit(kind, chunk)


def _stream_chat_deltas(
    client: OpenAI,
    *,
    emit: EmitFn | None,
    extra_body: dict[str, Any] | None = None,
    **kwargs: Any,
) -> tuple[str, str]:
    """流式读取，返回 (reasoning 全文, content 全文)，可选每片 emit。"""
    kw = {**kwargs, "stream": True}
    if extra_body:
        kw["extra_body"] = extra_body
    stream = client.chat.completions.create(**kw)
    reasoning_parts: list[str] = []
    content_parts: list[str] = []
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta is None:
            continue
        rc = getattr(delta, "reasoning_content", None)
        if rc:
            reasoning_parts.append(rc)
            _emit_chunk(emit, "reasoning", rc)
        if delta.content:
            content_parts.append(delta.content)
            _emit_chunk(emit, "content", delta.content)
    return "".join(reasoning_parts), "".join(content_parts)


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        text = m.group(0)
    return json.loads(text)


def _normalize_judge_dict(data: dict[str, Any]) -> dict[str, Any]:
    out = {**data}
    try:
        out["overall"] = int(out.get("overall", 7))
    except (TypeError, ValueError):
        out["overall"] = 7
    out["overall"] = max(1, min(10, int(out["overall"])))
    return out


def extract_duration_seconds_from_text(text: str) -> int | None:
    """从用户自然语言中提取明确时长（秒）；未提及则返回 None。"""
    s = str(text or "").strip()
    if not s:
        return None
    m = re.search(r"(\d{1,2})\s*分(?:钟)?\s*(\d{1,2})\s*秒", s)
    if m:
        total = int(m.group(1)) * 60 + int(m.group(2))
        return max(15, min(180, total))
    m = re.search(r"(\d{1,3})\s*分(?:钟)?(?!\s*\d)", s)
    if m:
        return max(15, min(180, int(m.group(1)) * 60))
    m = re.search(r"(\d{1,3})\s*(?:秒|秒钟|s(?![a-z])|sec(?:onds?)?)", s, re.I)
    if m:
        return max(15, min(180, int(m.group(1))))
    return None


def apply_explicit_duration_from_text(user_text: str, intent: dict[str, Any]) -> dict[str, Any]:
    explicit = extract_duration_seconds_from_text(user_text)
    if explicit is None:
        return intent
    out = dict(intent)
    out["duration_seconds"] = explicit
    return out


def parse_music_intent(
    settings: Settings,
    user_text: str,
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    """文字 → 音乐参数。可选 stream_emit(kind, chunk) 推送思考/正文片段。"""
    client = _client(settings)
    model = _intent_model(settings)
    user_in = _truncate(user_text, settings.intent_user_max_chars)
    mt = min(1024, max(256, int(settings.intent_max_tokens)))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": INTENT_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.3,
        max_tokens=mt,
    )

    use_stream = bool(stream_emit and getattr(settings, "stream_model_thinking", True))
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
            logger.info("intent stream+thinking failed (%s), fallback non-stream", e)
            use_stream = False

    if not use_stream:
        kwargs = {**base_kw}
        try:
            completion = client.chat.completions.create(
                **kwargs,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.info("intent json_object unsupported or failed (%s), retry without", e)
            completion = client.chat.completions.create(**kwargs)
        raw = completion.choices[0].message.content or "{}"

    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("intent JSON parse failed, raw=%s", raw[:500])
        data = {}
    return enrich_intent_from_user_text(
        user_text,
        apply_explicit_duration_from_text(user_text, _normalize_intent(data)),
    )


def _normalize_intent(data: dict[str, Any]) -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "key": "C大调",
        "tempo": 100,
        "emotion": "calm",
        "structure": "A-B-A",
        "instruments": ["piano"],
        "duration_seconds": 45,
        "style": "pop",
        "confidence": 0.8,
        "visual_density": 0.72,
        "layer_density": 0.7,
        "motion_complexity": 0.55,
        "pulse_strength": 0.58,
        "atmosphere": 0.55,
        "brightness": 0.48,
        "contrast": 0.56,
        "stereo_wideness": 0.52,
        "bass_weight": 0.46,
        "high_energy": 0.5,
        "acousticness": 0.35,
        "instrument_count": 1,
        "vocal_presence": 0.12,
        "primary_instruments": ["piano"],
        "secondary_instruments": [],
        "visual_tags": ["minimal"],
    }
    out = {**defaults, **{k: v for k, v in data.items() if v is not None}}
    for drop_k in ("has_vocal", "lyrics"):
        out.pop(drop_k, None)
    try:
        t = int(out.get("tempo", 100))
        out["tempo"] = max(40, min(200, t))
    except (TypeError, ValueError):
        out["tempo"] = 100
    try:
        d = int(out.get("duration_seconds", 45))
        out["duration_seconds"] = max(15, min(180, d))
    except (TypeError, ValueError):
        out["duration_seconds"] = 45
    if not isinstance(out.get("instruments"), list) or not out["instruments"]:
        out["instruments"] = ["piano"]
    out["instruments"] = [str(x)[:40] for x in out["instruments"]][:8]
    if not isinstance(out.get("key"), str):
        out["key"] = "C大调"

    for key_name in (
        "visual_density",
        "layer_density",
        "motion_complexity",
        "pulse_strength",
        "atmosphere",
        "brightness",
        "contrast",
        "stereo_wideness",
        "bass_weight",
        "high_energy",
        "acousticness",
        "vocal_presence",
    ):
        try:
            out[key_name] = max(0.0, min(1.0, float(out.get(key_name, defaults[key_name]))))
        except (TypeError, ValueError):
            out[key_name] = defaults[key_name]

    try:
        out["instrument_count"] = max(1, min(16, int(out.get("instrument_count", len(out["instruments"])))) )
    except (TypeError, ValueError):
        out["instrument_count"] = len(out["instruments"])

    if not isinstance(out.get("primary_instruments"), list) or not out["primary_instruments"]:
        out["primary_instruments"] = list(out["instruments"][:3])
    out["primary_instruments"] = [str(x)[:40] for x in out["primary_instruments"]][:5]
    if not isinstance(out.get("secondary_instruments"), list):
        out["secondary_instruments"] = []
    out["secondary_instruments"] = [str(x)[:40] for x in out["secondary_instruments"]][:6]
    if not isinstance(out.get("visual_tags"), list) or not out["visual_tags"]:
        out["visual_tags"] = ["minimal"]
    out["visual_tags"] = [str(x)[:30] for x in out["visual_tags"]][:10]

    st = str(out.get("style") or "pop").lower()
    hm_raw = out.get("harmony_style")
    hm = str(hm_raw).lower() if isinstance(hm_raw, str) else ""
    if hm in ("pop", "jazz", "classical", "folk"):
        out["harmony_style"] = hm
    elif st in ("jazz",):
        out["harmony_style"] = "jazz"
    elif st in ("classical",):
        out["harmony_style"] = "classical"
    elif st in ("folk", "民谣"):
        out["harmony_style"] = "folk"
    else:
        out["harmony_style"] = "pop"

    return out


def _build_judge_payload(
    settings: Settings,
    user_prompt: str,
    intent: dict[str, Any],
    technical_summary: str,
) -> str:
    compact = _compact_intent_for_judge(intent)
    return (
        f"需求：{_truncate(user_prompt, settings.judge_user_max_chars)}\n"
        f"意图：{json.dumps(compact, ensure_ascii=False)}\n"
        f"摘要：{_truncate(technical_summary, 600)}\n"
    )


def _judge_vl_text_only(
    settings: Settings,
    *,
    user_prompt: str,
    intent: dict[str, Any],
    technical_summary: str,
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    client = _client(settings)
    model = _judge_model_text(settings)
    payload = _build_judge_payload(settings, user_prompt, intent, technical_summary)
    mt = min(512, max(200, int(settings.judge_max_tokens)))
    kwargs = dict(
        model=model,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM_VL},
            {"role": "user", "content": payload},
        ],
        temperature=0.2,
        max_tokens=mt,
    )

    use_stream = bool(stream_emit and getattr(settings, "stream_model_thinking", True))
    if use_stream:
        try:
            _r, raw = _stream_chat_deltas(
                client,
                emit=stream_emit,
                extra_body={"enable_thinking": True},
                **kwargs,
            )
            raw = (raw or "").strip() or "{}"
        except Exception as e:
            logger.info("judge stream failed (%s), fallback", e)
            use_stream = False

    if not use_stream:
        try:
            completion = client.chat.completions.create(
                **kwargs,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.info("judge json_object failed (%s), retry without", e)
            completion = client.chat.completions.create(**kwargs)
        raw = completion.choices[0].message.content or "{}"
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        return {
            "overall": 7,
            "match": 7,
            "melody": 7,
            "harmony": 7,
            "emotion_fit": 7,
            "suggestions": "评判 JSON 解析失败，跳过细节。",
            "judge_model": model,
            "judge_mode": "qwen3-vl-text",
        }
    out = _normalize_judge_dict(data)
    out["judge_model"] = model
    out["judge_mode"] = "qwen3-vl-text"
    return out


def _wav_b64_part(wav_path: Path, max_bytes: int) -> dict[str, Any]:
    raw = wav_path.read_bytes()
    if len(raw) > max_bytes:
        raise ValueError(f"WAV 过大（>{max_bytes}），跳过 Omni 以控制 token")
    b64 = base64.standard_b64encode(raw).decode("ascii")
    return {
        "type": "input_audio",
        "input_audio": {
            "data": f"data:audio/wav;base64,{b64}",
            "format": "wav",
        },
    }


def _collect_stream_text(completion, emit: EmitFn | None = None) -> str:
    parts: list[str] = []
    for chunk in completion:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta is None:
            continue
        rc = getattr(delta, "reasoning_content", None)
        if rc:
            _emit_chunk(emit, "reasoning", rc)
        c = getattr(delta, "content", None)
        if c:
            parts.append(c)
            _emit_chunk(emit, "content", c)
    return "".join(parts)


def _judge_qwen_omni_audio(
    settings: Settings,
    *,
    user_prompt: str,
    intent: dict[str, Any],
    technical_summary: str,
    wav_path: Path,
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    client = _client(settings)
    model = (settings.qwen_omni_model or "qwen3.5-omni-plus").strip()
    text_block = _build_judge_payload(settings, user_prompt, intent, technical_summary)
    text_block += "结合听感与摘要打分。"
    max_b = max(256 * 1024, int(settings.judge_omni_audio_max_bytes))
    user_content: list[Any] = [
        _wav_b64_part(wav_path, max_b),
        {"type": "text", "text": text_block},
    ]
    messages = [
        {"role": "system", "content": JUDGE_SYSTEM_OMNI},
        {"role": "user", "content": user_content},
    ]
    omt = min(512, max(256, int(settings.judge_omni_max_tokens)))
    emit = stream_emit if getattr(settings, "stream_model_thinking", True) else None
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.2,
            max_tokens=omt,
            stream=True,
            stream_options={"include_usage": True},
            extra_body={"modalities": ["text"]},
        )
    except Exception as e:
        logger.warning("Omni judge with modalities failed: %s, retry without extra_body", e)
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.2,
            max_tokens=omt,
            stream=True,
            stream_options={"include_usage": True},
        )
    raw = _collect_stream_text(completion, emit=emit)
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("Omni judge JSON parse failed, raw=%s", raw[:800])
        return {
            "overall": 7,
            "match": 7,
            "melody": 7,
            "harmony": 7,
            "emotion_fit": 7,
            "suggestions": "Omni 输出非 JSON，已给默认分。",
            "judge_model": model,
            "judge_mode": "qwen-omni-audio",
        }
    out = _normalize_judge_dict(data)
    out["judge_model"] = model
    out["judge_mode"] = "qwen-omni-audio"
    return out


def judge_composition(
    settings: Settings,
    *,
    user_prompt: str,
    intent: dict[str, Any],
    technical_summary: str,
    audio_path: Path | None = None,
    force_audio_judge: bool = False,
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    """
    LLM-as-Judge。
    - audio_path 且 judge_audio_with_omni 且 force_audio_judge：走 Qwen-Omni（音频 token 大）。
    - 否则：Qwen3-VL 文本（用于重试循环内决策，省 token）。
    """
    use_omni = (
        bool(audio_path and audio_path.is_file())
        and settings.judge_audio_with_omni
        and force_audio_judge
    )
    if use_omni:
        try:
            return _judge_qwen_omni_audio(
                settings,
                user_prompt=user_prompt,
                intent=intent,
                technical_summary=technical_summary,
                wav_path=audio_path,
                stream_emit=stream_emit,
            )
        except Exception as e:
            logger.warning("Omni audio judge failed, fallback to Qwen3-VL text: %s", e)
    return _judge_vl_text_only(
        settings,
        user_prompt=user_prompt,
        intent=intent,
        technical_summary=technical_summary,
        stream_emit=stream_emit,
    )


def patch_intent_from_judge(
    settings: Settings,
    *,
    user_prompt: str,
    intent: dict[str, Any],
    judge_result: dict[str, Any],
    technical_summary: str,
    attempt_index: int,
    stream_emit: EmitFn | None = None,
) -> tuple[dict[str, Any], str]:
    """
    将质检 feedback 映射为下一轮完整意图。失败时返回原意图的 normalize 结果与空说明。
    第二项为模型给出的 patch_note（中文短句），供前端与日志展示。
    """
    base = _normalize_intent({**intent})
    if not settings.enable_judge_intent_patch:
        return base, ""

    client = _client(settings)
    model = _intent_model(settings)
    judge_compact = {
        k: judge_result.get(k)
        for k in (
            "overall",
            "match",
            "melody",
            "harmony",
            "emotion_fit",
            "suggestions",
        )
    }
    user_in = (
        f"原始需求：{_truncate(user_prompt, settings.judge_user_max_chars)}\n"
        f"当前意图：{json.dumps(_compact_intent_for_judge(base), ensure_ascii=False)}\n"
        f"技术指标：{_truncate(technical_summary, 700)}\n"
        f"第 {attempt_index + 1} 次重试前；质检：{json.dumps(judge_compact, ensure_ascii=False)}\n"
    )
    mt = max(200, min(1024, int(getattr(settings, "intent_patch_max_tokens", 384))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": PATCH_INTENT_JUDGE_SYSTEM},
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
        except Exception as e:
            logger.info("intent patch stream failed (%s), fallback", e)
            use_stream = False
    if not use_stream:
        try:
            completion = client.chat.completions.create(
                **base_kw,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.info("intent patch json_object failed (%s), retry without", e)
            completion = client.chat.completions.create(**base_kw)
        raw = completion.choices[0].message.content or "{}"
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("intent patch JSON parse failed, keep intent. raw=%s", raw[:400])
        return base, ""
    if not isinstance(data, dict):
        return base, ""
    patch_note_raw = data.pop("patch_note", None)
    patch_note = (
        str(patch_note_raw).strip()[:500]
        if isinstance(patch_note_raw, str)
        else ""
    )
    out = _normalize_intent({**base, **{k: v for k, v in data.items() if v is not None}})
    return out, patch_note


def refine_music_intent(
    settings: Settings,
    *,
    original_prompt: str,
    previous_intent: dict[str, Any],
    refine_instruction: str,
    stream_emit: EmitFn | None = None,
) -> dict[str, Any]:
    """会话增量：合并上一轮意图与用户本轮修改说明。"""
    client = _client(settings)
    model = _intent_model(settings)
    prev = _normalize_intent({**previous_intent})
    user_in = (
        f"原始创作描述：{_truncate(original_prompt, settings.intent_user_max_chars)}\n"
        f"上一轮意图：{json.dumps(_compact_intent_for_judge(prev), ensure_ascii=False)}\n"
        f"本轮修改说明：{_truncate(refine_instruction, settings.intent_user_max_chars)}\n"
    )
    mt = min(1024, max(256, int(settings.intent_max_tokens)))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": REFINE_INTENT_SYSTEM},
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
            logger.info("refine intent stream failed (%s), fallback", e)
            use_stream = False
    if not use_stream:
        try:
            completion = client.chat.completions.create(
                **base_kw,
                response_format={"type": "json_object"},
            )
        except Exception as e:
            logger.info("refine intent json_object failed (%s), retry without", e)
            completion = client.chat.completions.create(**base_kw)
        raw = completion.choices[0].message.content or "{}"
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("refine intent JSON parse failed, fallback previous. raw=%s", raw[:400])
        return prev
    merged = _normalize_intent({**prev, **{k: v for k, v in data.items() if v is not None}})
    combined = f"{original_prompt}\n{refine_instruction}"
    return apply_explicit_duration_from_text(combined, merged)


PLAYBACK_VISUAL_SYSTEM = (
    "你是音乐可视化参数推断器。你听不见音频，只能根据文件名与技术指标摘要（若有），"
    "推断适合「动态背景配色与律动」的音乐参数；用于可视化映射而非作曲。"
    "若 lyrics_text 为空、缺失或仅标注「转写未出字」类说明：**不得**仅凭此把作品当成「纯器乐/无人声」；"
    "商业歌曲常因混音、和声或转写失败而无正文，此时 vocal_presence 仍宜保持中等偏高（约 0.45～0.75），"
    "visual_tags 可含 vocal、song，confidence 适度降低并说明依据不足。"
    "仅当 vocal_label 明确为 instrumental 且 has_vocal 为 false 并有解析依据时，才可把 vocal_presence 压到较低。"
    "仅输出一个 JSON，除基础字段外尽量补充："
    "visual_density(0-1 float), layer_density(0-1 float), motion_complexity(0-1 float),"
    "pulse_strength(0-1 float), atmosphere(0-1 float), brightness(0-1 float),"
    "contrast(0-1 float), stereo_wideness(0-1 float), bass_weight(0-1 float),"
    "high_energy(0-1 float), acousticness(0-1 float), instrument_count(int), vocal_presence(0-1 float),"
    "primary_instruments(str[]), secondary_instruments(str[]), visual_tags(str[])."
    "基础字段仍需包含：key, tempo, emotion, structure, instruments, duration_seconds, style, harmony_style, confidence。"
    "emotion 用小写英文（如 melancholic, calm, joyful, yearning, nostalgic）。tempo 为 40-200 的整数。"
    "若摘要中含 lyrics_language、lyrics_text（只看长度与语言标签，不要复述歌词正文）、"
    "has_vocal、vocal_label、transcription_whisper_language，必须据此显著调整 emotion、style、"
    "vocal_presence、visual_tags（例如日语歌词倾向 j-pop / yearning，人声歌曲 vocal_presence 应偏高）。"
    "如果文件名或摘要显示是带歌词的人声歌曲，可以把 vocal / lyric / song / voice / chorus / verse 等线索纳入判断，"
    "但不要输出歌词正文，也不要声称逐字识别。"
    "若摘要不足以判断某项，给出保守合理的默认值并在 confidence 适当降低。"
)

AUDIO_TRANSCRIPTION_SYSTEM = (
    "你是音频歌词转写助手。请基于提供的音频转写出其中可辨识的人声歌词，"
    "尽量保留原语言和断句。只输出纯文本，不要 JSON，不要解释。"
    "如果听不清或没有人声，请输出空字符串。"
)

JP_LYRIC_SYSTEM = (
    "你是多语言歌词识别与整理助手。请判断输入中的歌词语言，并输出一个 JSON。"
    "字段：language(str, zh/en/ja/mixed/unknown), lyrics(str, 保留原文断句), translation_zh(str, 可选中文翻译，没有则空串), confidence(0-1 float)。"
    "只输出 JSON，不要解释。"
)


def infer_playback_visual_intent(
    settings: Settings,
    *,
    source: str,
    filename: str,
    analysis: dict[str, Any] | None,
    intent: dict[str, Any] | None,
    duration_seconds: int | None,
) -> dict[str, Any]:
    """
    统一试听：生成曲目可直接沿用结构化意图；上传文件根据摘要让模型推断情绪等。
    """
    src = (source or "").strip().lower()
    if src == "generated":
        if intent:
            return _normalize_intent({**intent})
        return _normalize_intent({})

    heuristic = _heuristic_playback_intent_from_analysis(analysis, filename, duration_seconds)

    if not getattr(settings, "enable_playback_visual_llm", True):
        return _normalize_intent({**heuristic, **(intent or {})})

    parts: list[str] = []
    parts.append(f"来源：上传文件（仅文本推断）")
    parts.append(f"文件名：{_truncate(filename, 200)}")
    if duration_seconds is not None:
        try:
            parts.append(f"时长约 {int(duration_seconds)} 秒")
        except (TypeError, ValueError):
            pass
    if analysis:
        parts.append(
            "技术指标与解析字段：\n"
            f"{_truncate(json.dumps(analysis, ensure_ascii=False), 1400)}",
        )
    user_in = "\n".join(parts)

    try:
        client = _client(settings)
    except RuntimeError:
        logger.info("playback visual: no API key, fallback heuristic intent")
        return _normalize_intent({**heuristic, **(intent or {})})

    model = _intent_model(settings)
    mt = max(200, min(768, int(getattr(settings, "playback_visual_max_tokens", 384))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": PLAYBACK_VISUAL_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.35,
        max_tokens=mt,
    )
    raw = "{}"
    try:
        completion = client.chat.completions.create(
            **base_kw,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
    except Exception as e:
        logger.info("playback visual json_object failed (%s), retry without", e)
        try:
            completion = client.chat.completions.create(**base_kw)
            raw = completion.choices[0].message.content or "{}"
        except Exception as e2:
            logger.warning("playback visual LLM failed: %s", e2)
            return _normalize_intent({**heuristic, **(intent or {})})

    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("playback visual JSON parse failed. raw=%s", raw[:400])
        return _normalize_intent({**heuristic, **(intent or {})})
    if not isinstance(data, dict):
        return _normalize_intent({**heuristic, **(intent or {})})
    return _normalize_intent(
        {
            **heuristic,
            **(intent or {}),
            **{k: v for k, v in data.items() if v is not None},
        }
    )


LISTENING_CAPTIONS_SYSTEM = (
    "你是中文乐评散文作者。你听不见真实音频，只能根据「文件名 + 机器生成的简介字段」或「创作意图」"
    "去想象这首歌在心里的样子，写出有文采、偏情绪与意象的四段话，贴在全屏可视化的上、右、下、左四边。"
    "仅输出一个 JSON，无 markdown。字段："
    "top、right、bottom、left（各为 str），footnote（str，可空）。"
    "每段 2～4 句中文，每句以句号或省略号结尾；每段总长约 36～120 字；四段角度必须不同，禁止复制粘贴式雷同。"
    "整体语气：抒情、含蓄、有画面感，可适度用比喻与通感，像写给朋友的一段听后感。"
    "**禁止**在正文中出现以下类别的词（含中英文）："
    "BPM、赫兹、分贝、频段、低频、中频、高频、混响、延迟、失真、压缩、音轨、轨道、"
    "波形、FFT、采样、比特率、MIDI、JSON、字段名、和声进行、调性、和弦、织体、配器、"
    "合成器、钢琴音色、音域、声场宽度、立体声、母带、响度、技术、参数、算法、模型、"
    "metadata、analysis、instrumental、vocal 等。"
    "也**不要**写「我听了」「波形显示」「从参数看」「根据 JSON」等暴露推断来源的句子；"
    "可改用「若这份简介没骗我……」「恍惚间像……」「让人想起……」等自然引入。"
    "不要复述或引用歌词原文；若简介里歌词为空，不要断言「没有歌词」或「纯器乐」，"
    "只写情绪上「像有人在唱又像在叹息」之类留有余地的感受。"
    "若机器摘要显示倾向人声歌曲（has_vocal、song、商采曲目 id、转写失败但附说明等），"
    "禁止写「没有词句」「无歌词」「只有呼吸没有字」等与该倾向矛盾的句子。"
    "禁止在正文里写死精确总时长（如「216秒」「3分36秒」），可用「这一程」「从头到尾」等笼统说法。"
    "footnote 用一句极短中文说明「据简介推断，非逐句听录」类意思即可；不需要引号。"
)

LISTENING_CAPTIONS_STREAM_SYSTEM = (
    "你是中文乐评散文作者：偏情绪与意象、有文采，写给「正在听这首歌的人」；"
    "禁止音乐工程与乐理术语（如混响、频段、合成器、织体、BPM、波形、JSON 等）；"
    "不要写「我听了」「从参数看」等暴露推断来源的话。"
    "若摘要倾向人声歌曲，禁止写「没有词句」「无歌词」「纯器乐」「只有呼吸没有字」等否定句。"
    "禁止在正文里写死精确总时长秒数或「几分几秒」式读秒。"
    "你必须输出**纯文本**，且严格依次使用下列标记（全大写、一字不改），不得用 JSON、不得用 markdown 代码块：\n"
    "<<SIDE_TOP>>\n（此处写「上边」2～4 句中文……）\n"
    "<<SIDE_RIGHT>>\n（右边……）\n"
    "<<SIDE_BOTTOM>>\n（下边……）\n"
    "<<SIDE_LEFT>>\n（左边……）\n"
    "<<SIDE_FOOT>>\n（一句极短脚注）\n"
    "<<SIDE_END>>\n"
    "标记必须单独成行或紧跟正文开头；正文里不要出现与标记相同的字符串。"
)


def _listening_caption_semantics_constraints(*, filename: str, analysis: dict[str, Any] | None) -> str:
    """从解析字段提炼硬性语义约束，减少模型与简介矛盾（如有人声却写无词句）。"""
    a = analysis or {}
    low_fn = (filename or "").lower()
    pop_id = bool(re.search(r"m[0-9]{5,}", low_fn))
    inst_name = any(
        k in low_fn for k in ("instrumental", "minus", "karaoke", "backing", "inst_", "_inst", "off vocal")
    )
    lyrics_nonempty = bool(str(a.get("lyrics_text") or "").strip())
    has_vocal = bool(a.get("has_vocal"))
    v_lab = str(a.get("vocal_label") or "").strip().lower()
    lyrics_note = str(a.get("lyrics_note") or "").strip()
    whisper_lang = str(a.get("transcription_whisper_language") or "").strip().lower()
    songish_lang = whisper_lang in (
        "ja",
        "japanese",
        "zh",
        "zh-cn",
        "ko",
        "yue",
        "en",
        "english",
        "chinese",
        "cantonese",
        "korean",
    )

    lean_vocal = (
        has_vocal
        or lyrics_nonempty
        or v_lab == "song"
        or (pop_id and v_lab != "instrumental" and not inst_name)
        or bool(lyrics_note)
        or songish_lang
    )
    lean_instrumental = (
        v_lab == "instrumental"
        and not has_vocal
        and not lyrics_nonempty
        and not pop_id
        and not lyrics_note
        and not songish_lang
    )

    lines = [
        "【听感与简介一致性（务必遵守）】",
        "不要在正文里写死精确总时长（禁止使用「216秒」「3分36秒」等具体秒数或读秒），可用「这一程」「从头到尾」等笼统说法。",
    ]
    if lean_vocal and not lean_instrumental:
        lines.append(
            "当前机器摘要**明显倾向真人演唱/人声歌曲**（如 has_vocal、vocal_label=song、"
            "歌词转写非空、商采类文件名、或 lyrics_note 说明转写失败但仍像歌曲等）："
            "禁止写「没有词句」「无歌词」「纯器乐」「无人声」「只有呼吸没有字」等与人声倾向矛盾的句子；"
            "若字句听不清，请写成咬字若隐若现、和声里浮着半句、气息像有人在唱等，留余地。"
        )
    elif lean_instrumental:
        lines.append("当前摘要更偏器乐曲目：可写无词意境或演奏感，但仍避免武断工程术语。")
    else:
        lines.append("人声证据混杂时请用留余地写法，不要一口咬定「完全没有唱」。")
    return "\n".join(lines)


def _build_listening_captions_user_block(
    *,
    source: str,
    filename: str,
    analysis: dict[str, Any] | None,
    intent: dict[str, Any] | None,
    duration_seconds: int | None,
) -> str:
    src = (source or "").strip().lower()
    parts: list[str] = []
    if src == "generated":
        parts.append("来源：模型生成曲目（结构化意图，非实时波形）。")
        if intent:
            parts.append(
                "创作意图 JSON：\n"
                f"{_truncate(json.dumps(intent, ensure_ascii=False), 2200)}",
            )
        else:
            parts.append("未提供意图 JSON，请根据文件名写保守的泛化听感。")
    else:
        parts.append("来源：用户上传文件（仅文本摘要推断，听不见真实音频）。")
        parts.append(f"文件名：{_truncate(filename, 200)}")
        if duration_seconds is not None:
            try:
                parts.append(f"时长约 {int(duration_seconds)} 秒")
            except (TypeError, ValueError):
                pass
        if analysis:
            parts.append(
                "技术指标与解析字段：\n"
                f"{_truncate(json.dumps(analysis, ensure_ascii=False), 1600)}",
            )
        if intent:
            parts.append(
                "补充意图/可视化参数：\n"
                f"{_truncate(json.dumps(intent, ensure_ascii=False), 600)}",
            )
    user_in = "\n".join(parts)
    user_in += (
        "\n\n以下摘要多为机器字段，请你只当作情绪与场景的隐性线索；"
        "正文里不要复述字段名、不要列举英文键名、不要写任何音乐工程术语。"
    )
    user_in += "\n\n" + _listening_caption_semantics_constraints(filename=filename, analysis=analysis)
    return user_in


_STREAM_TAG_RE = re.compile(r"<<SIDE_(TOP|RIGHT|BOTTOM|LEFT|FOOT|END)>>", re.IGNORECASE)

# 与真实 side 名不冲突的哨兵，表示 <<SIDE_END>>
_STREAM_TAG_END = "__side_end__"


def _stream_tag_to_side(tag: str) -> str | None:
    u = tag.upper()
    if u == "END":
        return _STREAM_TAG_END
    m = {
        "TOP": "top",
        "RIGHT": "right",
        "BOTTOM": "bottom",
        "LEFT": "left",
        "FOOT": "footnote",
    }
    return m.get(u)


def stream_listening_captions_events(
    settings: Settings,
    *,
    source: str,
    filename: str,
    analysis: dict[str, Any] | None,
    intent: dict[str, Any] | None,
    duration_seconds: int | None,
) -> Iterator[dict[str, Any]]:
    """
    流式生成四边听感：yield dict
    - {"kind": "side", "side": "top"|...}
    - {"kind": "chunk", "side": str, "chunk": str}
    - {"kind": "final", "captions": dict}  # top,right,bottom,left,footnote
    """
    src = (source or "").strip().lower()
    if not getattr(settings, "enable_listening_caption_llm", True):
        fb = _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )
        yield {"kind": "final", "captions": fb}
        return

    user_in = _build_listening_captions_user_block(
        source=source,
        filename=filename,
        analysis=analysis,
        intent=intent,
        duration_seconds=duration_seconds,
    )

    try:
        client = _client(settings)
    except RuntimeError:
        fb = _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )
        yield {"kind": "final", "captions": fb}
        return

    model = _intent_model(settings)
    mt = max(280, min(1200, int(getattr(settings, "listening_caption_max_tokens", 720))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": LISTENING_CAPTIONS_STREAM_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.62,
        max_tokens=mt,
        stream=True,
    )

    buf = ""
    side: str | None = None
    acc: dict[str, list[str]] = {"top": [], "right": [], "bottom": [], "left": [], "footnote": []}
    LOOK = 36

    def flush_acc() -> dict[str, str]:
        return {
            "top": "".join(acc["top"]).strip(),
            "right": "".join(acc["right"]).strip(),
            "bottom": "".join(acc["bottom"]).strip(),
            "left": "".join(acc["left"]).strip(),
            "footnote": "".join(acc["footnote"]).strip(),
        }

    try:
        stream = client.chat.completions.create(**base_kw)
    except Exception as e:
        logger.warning("listening captions stream failed to start: %s", e)
        fb = _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )
        yield {"kind": "final", "captions": fb}
        return

    try:
        for part in stream:
            ch0 = part.choices[0] if part.choices else None
            delta = (getattr(ch0, "delta", None) and getattr(ch0.delta, "content", None)) or ""
            if not delta:
                continue
            buf += delta
            while True:
                if side is None:
                    m = _STREAM_TAG_RE.search(buf)
                    if not m:
                        if len(buf) > 400:
                            buf = buf[-200:]
                        break
                    if m.start() > 0:
                        buf = buf[m.start():]
                        continue
                    tag = m.group(1).upper()
                    buf = buf[m.end() :]
                    nx = _stream_tag_to_side(tag)
                    if nx is None:
                        continue
                    if nx == _STREAM_TAG_END:
                        continue
                    side = nx
                    yield {"kind": "side", "side": side}
                    continue

                m2 = _STREAM_TAG_RE.search(buf)
                if m2 is None:
                    if len(buf) > LOOK:
                        safe = len(buf) - LOOK
                        tail = buf[-LOOK:]
                        cut = tail.find("<<")
                        if cut != -1:
                            safe = min(safe, len(buf) - LOOK + cut)
                        if safe > 0:
                            piece = buf[:safe]
                            buf = buf[safe:]
                            acc[side].append(piece)
                            yield {"kind": "chunk", "side": side, "chunk": piece}
                    break

                if m2.start() > 0:
                    piece = buf[: m2.start()]
                    tag2 = m2.group(1).upper()
                    buf = buf[m2.end() :]
                    if piece:
                        acc[side].append(piece)
                        yield {"kind": "chunk", "side": side, "chunk": piece}
                    nx2 = _stream_tag_to_side(tag2)
                    if nx2 is None:
                        continue
                    if nx2 == _STREAM_TAG_END:
                        side = None
                        continue
                    side = nx2
                    yield {"kind": "side", "side": side}
                    continue

                if m2.start() == 0:
                    tag2 = m2.group(1).upper()
                    buf = buf[m2.end() :]
                    nx2 = _stream_tag_to_side(tag2)
                    if nx2 is None:
                        continue
                    if nx2 == _STREAM_TAG_END:
                        side = None
                        continue
                    side = nx2
                    yield {"kind": "side", "side": side}
                    continue
    except Exception as e:
        logger.warning("listening captions stream read failed: %s", e)

    if side and buf.strip():
        acc[side].append(buf)
        yield {"kind": "chunk", "side": side, "chunk": buf}

    out = flush_acc()
    if not (out["top"] or out["right"] or out["bottom"] or out["left"]):
        fb = _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )
        yield {"kind": "final", "captions": fb}
        return

    if not out["footnote"]:
        out["footnote"] = "据简介推断，非逐句听录。"
    yield {"kind": "final", "captions": out}


_EMOTION_ZH: dict[str, str] = {
    "melancholic": "略带忧郁的内省",
    "calm": "平静舒缓",
    "joyful": "明朗轻快",
    "yearning": "悠远与渴望交织",
    "nostalgic": "怀旧温柔",
    "reflective": "沉思内敛",
    "expressive": "情绪外放",
    "energetic": "富有动感",
    "neutral": "中性克制",
    "dramatic": "戏剧张力",
    "romantic": "浪漫柔和",
    "mysterious": "神秘幽微",
}


def _fallback_listening_captions(
    *,
    source: str,
    filename: str,
    analysis: dict[str, Any] | None,
    intent: dict[str, Any] | None,
    duration_seconds: int | None,
) -> dict[str, str]:
    """LLM 不可用时仍给出四边占位文案。"""
    src = (source or "").strip().lower()
    if src == "generated" and intent:
        base = dict(intent)
    else:
        h = _heuristic_playback_intent_from_analysis(analysis, filename, duration_seconds)
        base = {**h, **(intent or {})}
    em = str(base.get("emotion") or "calm").strip().lower()
    mood = _EMOTION_ZH.get(em, "层次丰富的听感")
    name = _truncate(filename, 80)
    top = f"像暮色里慢慢铺开的一段心事，底色偏{mood}，又夹着几缕欲言又止的温柔。"
    right = "脚步不疾不徐，像有人在心底轻轻打拍子，让人愿意跟着再走一小段路。"
    bottom = "周遭很静，却不是空；像房间里还留着昨夜对话的余温，风一过就轻轻晃。"
    left = f"题名「{name}」里仿佛藏着秘而不宣的情节，只等你用想象把它轻轻填满。"
    foot = "据简介推断，非逐句听录。"
    return {"top": top, "right": right, "bottom": bottom, "left": left, "footnote": foot}


def infer_listening_captions(
    settings: Settings,
    *,
    source: str,
    filename: str,
    analysis: dict[str, Any] | None,
    intent: dict[str, Any] | None,
    duration_seconds: int | None,
) -> dict[str, str]:
    """
    四边听感短句：上传侧用 analysis；生成侧用 intent（与 infer_playback_visual_intent 同源约束）。
    """
    src = (source or "").strip().lower()
    if not getattr(settings, "enable_listening_caption_llm", True):
        return _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )

    user_in = _build_listening_captions_user_block(
        source=source,
        filename=filename,
        analysis=analysis,
        intent=intent,
        duration_seconds=duration_seconds,
    )

    try:
        client = _client(settings)
    except RuntimeError:
        logger.info("listening captions: no API key, fallback")
        return _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )

    model = _intent_model(settings)
    mt = max(280, min(1200, int(getattr(settings, "listening_caption_max_tokens", 720))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": LISTENING_CAPTIONS_SYSTEM},
            {"role": "user", "content": user_in},
        ],
        temperature=0.62,
        max_tokens=mt,
    )
    raw = "{}"
    try:
        completion = client.chat.completions.create(
            **base_kw,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
    except Exception as e:
        logger.info("listening captions json_object failed (%s), retry without", e)
        try:
            completion = client.chat.completions.create(**base_kw)
            raw = completion.choices[0].message.content or "{}"
        except Exception as e2:
            logger.warning("listening captions LLM failed: %s", e2)
            return _fallback_listening_captions(
                source=src,
                filename=filename,
                analysis=analysis,
                intent=intent,
                duration_seconds=duration_seconds,
            )

    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("listening captions JSON parse failed. raw=%s", raw[:400])
        return _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )
    if not isinstance(data, dict):
        return _fallback_listening_captions(
            source=src,
            filename=filename,
            analysis=analysis,
            intent=intent,
            duration_seconds=duration_seconds,
        )

    def _clip(s: Any, n: int = 220) -> str:
        t = str(s or "").strip()
        if len(t) > n:
            return t[: n - 1] + "…"
        return t

    fb = _fallback_listening_captions(
        source=src,
        filename=filename,
        analysis=analysis,
        intent=intent,
        duration_seconds=duration_seconds,
    )
    top = _clip(data.get("top")) or fb["top"]
    right = _clip(data.get("right")) or fb["right"]
    bottom = _clip(data.get("bottom")) or fb["bottom"]
    left = _clip(data.get("left")) or fb["left"]
    foot = _clip(data.get("footnote"), 120) or fb.get("footnote", "")
    return {"top": top, "right": right, "bottom": bottom, "left": left, "footnote": foot}


POETIC_LYRICS_SYSTEM = (
    "你是中文作词助理与音乐编辑。"
    "用户会给出「曲名」「歌手（可选）」以及「上传音频解析 JSON」（时长、格式、是否像有人声、自动转写片段等，可能不完整或为空）。"
    "请先据曲名与歌手调动常识性、公开层面的曲目认知：背景意象、常见主题、整体情绪走向；若曲目不明或记忆不确定，在 song_uncertainty_zh 中明确说明「推断/不确定」，"
    "禁止编造可核验的具体事实（如精确发行日、榜单名次、未给出的创作轶事）。"
    "再结合上传解析中的线索（时长、人声判断、转写摘要等）写出一首富有诗意的原创中文歌词：可分 2～3 节，可有副歌，换行用 \\n，押韵自然。"
    "自动转写若有内容，仅作语气与节奏参考，禁止大段照搬转写原文当作终稿；禁止逐句复述或抄录任何已知版权歌词。"
    "仅输出一个 JSON，字段均为中文：song_background_zh, musical_mood_zh, audio_alignment_zh, song_uncertainty_zh, "
    "safety_note_zh（版权与原创声明一两句）, poetic_lyrics_zh。无 markdown。"
)


def _compact_analysis_for_poetic_lyrics(analysis: dict[str, Any]) -> dict[str, Any]:
    """去掉时间轴等大字段，控制 prompt 体积。"""
    keys = (
        "filename",
        "duration_seconds",
        "analysis_mode",
        "suffix",
        "size_bytes",
        "has_vocal",
        "vocal_label",
        "lyrics_language",
        "lyrics_source",
        "lyrics_note",
        "lyrics_transcription_status",
        "note",
        "suggested_workflow",
        "transcription_whisper_language",
    )
    out: dict[str, Any] = {}
    for k in keys:
        if k in analysis and analysis[k] not in (None, "", []):
            out[k] = analysis[k]
    lt = str(analysis.get("lyrics_text") or "").strip()
    if lt:
        out["lyrics_text_excerpt"] = _truncate(lt, 720)
    zh = str(analysis.get("lyrics_translation_zh") or "").strip()
    if zh:
        out["lyrics_translation_zh_excerpt"] = _truncate(zh, 480)
    segs = analysis.get("lyrics_timeline")
    if isinstance(segs, list) and segs:
        head = segs[:8]
        slim: list[dict[str, Any]] = []
        for s in head:
            if not isinstance(s, dict):
                continue
            slim.append(
                {
                    "start": s.get("start"),
                    "end": s.get("end"),
                    "text": _truncate(str(s.get("text") or ""), 80),
                }
            )
        out["lyrics_timeline_head"] = slim
        out["lyrics_timeline_segment_count"] = len(segs)
    return out


def _fallback_poetic_lyrics(
    *,
    song_title: str,
    artist: str | None,
    analysis: dict[str, Any],
    saved_filename: str,
) -> dict[str, Any]:
    title = (song_title or "").strip() or "未命名曲目"
    art = (artist or "").strip()
    sub = _truncate(saved_filename, 72)
    dur = analysis.get("duration_seconds")
    vocal = analysis.get("vocal_label")
    head = f"《{title}》" + (f"，{art}" if art else "")
    lyrics = (
        f"{head}\n\n"
        "风经过空房间\n"
        "把回声折成一行行未寄出的信\n\n"
        "光在尘埃里练习慢舞\n"
        "节拍贴着心跳轻轻靠岸\n\n"
        "若你也在听\n"
        "就把沉默翻译成一句晚安\n"
    )
    return {
        "song_background_zh": f"{head}：当前为离线占位，未调用大模型。请配置 API Key 后重试。",
        "musical_mood_zh": "温柔、内敛、略带叙事感（占位）。",
        "audio_alignment_zh": f"结合上传摘要：文件名「{sub}」、时长线索「{dur}」、人声标签「{vocal}」作意象铺陈（占位）。",
        "song_uncertainty_zh": "未进行模型检索；背景为泛化描述。",
        "safety_note_zh": "占位稿为原创句式示例；正式环境请开启 LLM 并遵守版权与平台规范。",
        "poetic_lyrics_zh": lyrics,
        "fallback": True,
    }


def infer_poetic_lyrics_with_song_context(
    settings: Settings,
    *,
    song_title: str,
    artist: str | None,
    analysis: dict[str, Any],
    saved_filename: str,
) -> dict[str, Any]:
    """
    曲名/歌手（模型常识） + 上传 analysis 紧凑摘要 → 背景/情绪 + 原创诗意词。
    """
    st = (song_title or "").strip()
    if not st:
        raise ValueError("song_title is empty")

    if not getattr(settings, "enable_poetic_lyrics_llm", True):
        return _fallback_poetic_lyrics(
            song_title=st, artist=artist, analysis=analysis, saved_filename=saved_filename
        )

    try:
        client = _client(settings)
    except RuntimeError:
        return _fallback_poetic_lyrics(
            song_title=st, artist=artist, analysis=analysis, saved_filename=saved_filename
        )

    compact = _compact_analysis_for_poetic_lyrics(analysis)
    art_line = (artist or "").strip()
    user_block = (
        f"曲名：{st}\n"
        f"歌手：{art_line if art_line else '（未提供）'}\n"
        f"上传保存名：{saved_filename}\n"
        f"上传解析 JSON：\n{json.dumps(compact, ensure_ascii=False)}\n"
    )

    model = _intent_model(settings)
    mt = max(400, min(2400, int(getattr(settings, "poetic_lyrics_max_tokens", 1600))))
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": POETIC_LYRICS_SYSTEM},
            {"role": "user", "content": user_block},
        ],
        temperature=0.72,
        max_tokens=mt,
    )
    raw = "{}"
    try:
        completion = client.chat.completions.create(
            **base_kw,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content or "{}"
    except Exception as e:
        logger.info("poetic lyrics json_object failed (%s), retry without", e)
        try:
            completion = client.chat.completions.create(**base_kw)
            raw = completion.choices[0].message.content or "{}"
        except Exception as e2:
            logger.warning("poetic lyrics LLM failed: %s", e2)
            return _fallback_poetic_lyrics(
                song_title=st, artist=artist, analysis=analysis, saved_filename=saved_filename
            )

    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        logger.warning("poetic lyrics JSON parse failed. raw=%s", raw[:400])
        return _fallback_poetic_lyrics(
            song_title=st, artist=artist, analysis=analysis, saved_filename=saved_filename
        )
    if not isinstance(data, dict):
        return _fallback_poetic_lyrics(
            song_title=st, artist=artist, analysis=analysis, saved_filename=saved_filename
        )

    def clip(s: Any, n: int = 2000) -> str:
        t = str(s or "").strip()
        if len(t) > n:
            return t[: n - 1] + "…"
        return t

    fb = _fallback_poetic_lyrics(
        song_title=st, artist=artist, analysis=analysis, saved_filename=saved_filename
    )
    out = {
        "song_background_zh": clip(data.get("song_background_zh")) or fb["song_background_zh"],
        "musical_mood_zh": clip(data.get("musical_mood_zh"), 900) or fb["musical_mood_zh"],
        "audio_alignment_zh": clip(data.get("audio_alignment_zh"), 1200) or fb["audio_alignment_zh"],
        "song_uncertainty_zh": clip(data.get("song_uncertainty_zh"), 800) or fb["song_uncertainty_zh"],
        "safety_note_zh": clip(data.get("safety_note_zh"), 400) or fb["safety_note_zh"],
        "poetic_lyrics_zh": clip(data.get("poetic_lyrics_zh"), 4500) or fb["poetic_lyrics_zh"],
        "fallback": False,
    }
    return out


def _normalize_lyrics_text(text: str) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines()]
    cleaned: list[str] = []
    for ln in lines:
        if not ln:
            continue
        if ln in ("♪", "♫"):
            continue
        cleaned.append(ln)
    return "\n".join(cleaned).strip()


def _detect_lyrics_language(text: str) -> str:
    t = text or ""
    if re.search(r"[ぁ-ゟ゠-ヿ]", t):
        return "ja"
    if re.search(r"[ァ-ヶー]", t):
        return "ja"
    # 纯汉字块无法区分中日；常见日语歌词助词/终助词略作偏向
    if re.search(r"[一-鿿]", t) and re.search(
        r"[ぁ-ゟ゠-ヿァ-ヶ]|(?:の|を|は|が|に|へ|と|や|も|か|ね|よ|だ|である|です|ません|しましょう|なんて|きっと)",
        t,
    ):
        return "ja"
    if re.search(r"[一-鿿]", t):
        return "zh"
    if re.search(r"[A-Za-z]", t):
        return "en"
    return "unknown"


def _heuristic_playback_intent_from_analysis(
    analysis: dict[str, Any] | None,
    filename: str,
    duration_seconds: int | None,
) -> dict[str, Any]:
    """LLM 不可用时仍给出可用的配色/律动参数（尤其上传侧车含歌词语言时）。"""
    a = analysis or {}
    lang = str(a.get("lyrics_language") or "").strip().lower()
    wl = str(a.get("transcription_whisper_language") or "").strip().lower()
    has_vocal = bool(a.get("has_vocal"))
    vocal_lab = str(a.get("vocal_label") or "").strip().lower()
    lyrics = str(a.get("lyrics_text") or "").strip()
    lyrics_len = len(lyrics)
    is_audio = str(a.get("analysis_mode") or "").strip().lower() == "audio"
    whisper_song_lang = wl in ("ja", "japanese", "zh", "yue", "ko", "en", "english")
    # 短片段也可能是真实转写；转写失败≠无人声
    short_snip = 2 <= lyrics_len <= 40
    low_fn = (filename or "").lower()
    # 不要用 \\b：保存名常为 uuid_M500003xxx.mp3，_ 与 M 之间无「词边界」
    id_like_pop_upload = bool(is_audio and vocal_lab != "instrumental" and re.search(r"m[0-9]{5,}", low_fn))

    emotion = "calm"
    style = "pop"
    tempo = 100
    vocal_presence = 0.14
    visual_tags = ["minimal"]
    motion_complexity = 0.5
    layer_density = 0.62
    visual_density = 0.68
    high_energy = 0.48

    likely_song = (
        lyrics_len > 6
        or has_vocal
        or vocal_lab == "song"
        or (is_audio and vocal_lab != "instrumental" and (whisper_song_lang or short_snip))
        or id_like_pop_upload
    )
    if likely_song:
        vocal_presence = min(0.95, 0.38 + lyrics_len / 900)
        visual_tags = ["lyric", "vocal", "song"]
        motion_complexity = 0.72
        layer_density = 0.78
        visual_density = 0.82
        high_energy = 0.58
        if lang == "ja" or wl in ("ja", "japanese"):
            emotion = "yearning"
            style = "j-pop"
            tempo = 86
        elif lang == "zh":
            emotion = "reflective"
            style = "mandopop"
            tempo = 90
        elif lang == "en":
            emotion = "expressive"
            style = "western_pop"
            tempo = 102
        else:
            emotion = "expressive"
            style = "pop"
            tempo = 96

    dur_src = duration_seconds
    if dur_src is None or dur_src <= 0:
        try:
            dur_src = int(float(a.get("duration_seconds") or 0))
        except (TypeError, ValueError):
            dur_src = 0
    if dur_src <= 0:
        dur_src = 45
    dur_src = max(15, min(180, int(dur_src)))

    key_guess = "A小调" if emotion in ("yearning", "reflective", "melancholic") else "C大调"
    return {
        "emotion": emotion,
        "style": style,
        "tempo": max(40, min(200, tempo)),
        "harmony_style": "pop",
        "structure": "verse-chorus",
        "instruments": ["piano", "strings"] if likely_song else ["piano"],
        "duration_seconds": dur_src,
        "vocal_presence": max(0.0, min(1.0, vocal_presence)),
        "visual_tags": visual_tags,
        "motion_complexity": motion_complexity,
        "layer_density": layer_density,
        "visual_density": visual_density,
        "high_energy": high_energy,
        "key": key_guess,
        "confidence": 0.42 if likely_song else 0.35,
    }


def annotate_lyrics_language(
    settings: Settings,
    lyrics_text: str,
    *,
    whisper_lang_hint: str | None = None,
) -> dict[str, Any]:
    """给歌词增加语言标注；离线规则优先，复杂情况再让模型修正。"""
    text = _normalize_lyrics_text(lyrics_text)
    if not text:
        return {"language": "unknown", "lyrics": "", "translation_zh": "", "confidence": 0.0}
    hint = (whisper_lang_hint or "").strip().lower()
    if hint in ("ja", "japanese", "jp"):
        return {"language": "ja", "lyrics": text, "translation_zh": "", "confidence": 0.68}
    if hint in ("zh", "chinese", "mandarin", "cmn"):
        return {"language": "zh", "lyrics": text, "translation_zh": "", "confidence": 0.66}
    if hint in ("en", "english"):
        return {"language": "en", "lyrics": text, "translation_zh": "", "confidence": 0.64}
    if hint in ("ko", "korean"):
        return {"language": "ko", "lyrics": text, "translation_zh": "", "confidence": 0.64}

    lang = _detect_lyrics_language(text)
    if lang != "unknown":
        return {"language": lang, "lyrics": text, "translation_zh": "", "confidence": 0.72}

    try:
        client = _client(settings)
    except RuntimeError:
        return {"language": "unknown", "lyrics": text, "translation_zh": "", "confidence": 0.3}

    model = _intent_model(settings)
    base_kw = dict(
        model=model,
        messages=[
            {"role": "system", "content": JP_LYRIC_SYSTEM},
            {"role": "user", "content": _truncate(text, 2000)},
        ],
        temperature=0.1,
        max_tokens=420,
    )
    raw = "{}"
    try:
        completion = client.chat.completions.create(**base_kw, response_format={"type": "json_object"})
        raw = completion.choices[0].message.content or "{}"
    except Exception:
        try:
            completion = client.chat.completions.create(**base_kw)
            raw = completion.choices[0].message.content or "{}"
        except Exception:
            return {"language": "unknown", "lyrics": text, "translation_zh": "", "confidence": 0.3}
    try:
        data = _extract_json(raw)
    except json.JSONDecodeError:
        return {"language": "unknown", "lyrics": text, "translation_zh": "", "confidence": 0.3}
    return {
        "language": str(data.get("language") or "unknown").strip() or "unknown",
        "lyrics": str(data.get("lyrics") or text).strip(),
        "translation_zh": str(data.get("translation_zh") or "").strip(),
        "confidence": max(0.0, min(1.0, float(data.get("confidence") or 0.3))),
    }


def _transcription_text_and_lang(result: Any) -> tuple[str, str]:
    if result is None:
        return "", ""
    if isinstance(result, str):
        return _normalize_lyrics_text(result.strip()), ""
    text = str(getattr(result, "text", "") or "").strip()
    lang = str(getattr(result, "language", "") or "").strip().lower()
    if not text and isinstance(result, dict):
        text = str(result.get("text") or "").strip()
        lang = str(result.get("language") or "").strip().lower()
    return _normalize_lyrics_text(text), lang


def _whisper_segments_from_response(resp: Any) -> list[dict[str, Any]]:
    """从 Whisper verbose_json 响应解析带时间轴的片段。"""
    segments_raw: Any = getattr(resp, "segments", None)
    if segments_raw is None and hasattr(resp, "model_dump"):
        try:
            dumped = resp.model_dump()
            if isinstance(dumped, dict):
                segments_raw = dumped.get("segments")
        except Exception:
            segments_raw = None
    if not isinstance(segments_raw, list):
        return []
    out: list[dict[str, Any]] = []
    for s in segments_raw:
        if isinstance(s, dict):
            st = float(s.get("start") or 0)
            en = float(s.get("end") or 0)
            tx = str(s.get("text") or "").strip()
        else:
            try:
                st = float(getattr(s, "start", 0) or 0)
                en = float(getattr(s, "end", 0) or 0)
            except (TypeError, ValueError):
                st, en = 0.0, 0.0
            tx = str(getattr(s, "text", "") or "").strip()
        if tx and en > st:
            out.append({"start": round(st, 2), "end": round(en, 2), "text": tx})
    return out


def _verbose_transcription_bundle(resp: Any) -> tuple[str, str, list[dict[str, Any]]]:
    """verbose_json 单次调用：全文 + 语言 + 分段时间轴。"""
    text, lang = _transcription_text_and_lang(resp)
    segs = _whisper_segments_from_response(resp)
    return text, lang, segs


PLAYBACK_OMNI_TIMELINE_SYSTEM = (
    "你是资深音乐编辑，已听到用户给出的音频（单声道截取片段，从原曲开头附近开始）。"
    "请仅输出一个 JSON，不要用 markdown。结构：{\"lines\":[{\"t0\":数,\"t1\":数,\"zh\":字符串}]}。\n"
    "要求：lines 共 6～12 条；t0、t1 为相对于**本条音频片段起点**的秒数（可含一位小数），"
    "满足 0<=t0<t1<=片段可感时长；每条 zh 为 8～26 个汉字，偏意象与情绪听感，"
    "避免工程/乐理/混音类术语，不要复述可能存在的歌词原文；相邻时间段可略重叠；"
    "从听感上大致覆盖整条片段的时间轴。"
)


def _ffmpeg_audio_head_wav(
    src: Path,
    dest_wav: Path,
    *,
    ffmpeg_bin: str,
    max_seconds: float,
) -> bool:
    """截取音频前段为单声道 16kHz WAV，供 Omni 输入。"""
    try:
        r = subprocess.run(
            [
                ffmpeg_bin,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(src),
                "-t",
                str(max(0.5, max_seconds)),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "wav",
                str(dest_wav),
            ],
            capture_output=True,
            text=True,
            timeout=150,
        )
        return r.returncode == 0 and dest_wav.is_file()
    except (OSError, subprocess.TimeoutExpired):
        return False


def infer_playback_omni_timeline(
    settings: Settings,
    audio_path: Path,
    *,
    duration_hint: float | None,
    ffmpeg_bin: str,
) -> list[dict[str, Any]]:
    """
    用 Qwen-Omni 听短片段，输出带相对时间轴的中文意象短句。
    与 Whisper 分词时间轴互补；失败返回空列表。
    """
    if not getattr(settings, "judge_audio_with_omni", False):
        return []
    if not getattr(settings, "enable_playback_omni_insight", False):
        return []
    if not audio_path.is_file():
        return []
    suf = audio_path.suffix.lower()
    if suf not in (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"):
        return []
    max_b = max(256 * 1024, int(getattr(settings, "playback_omni_insight_max_bytes", 1_800_000)))
    try:
        client = _client(settings)
    except RuntimeError:
        return []

    model = (settings.qwen_omni_model or "qwen3.5-omni-plus").strip()
    tmp_wav = Path(NamedTemporaryFile(suffix=".wav", delete=False).name)
    try:
        picked_sec = 0.0
        for sec in (56.0, 40.0, 26.0):
            if not _ffmpeg_audio_head_wav(audio_path, tmp_wav, ffmpeg_bin=ffmpeg_bin, max_seconds=sec):
                continue
            sz = tmp_wav.stat().st_size if tmp_wav.is_file() else 0
            if sz > max_b:
                try:
                    tmp_wav.unlink(missing_ok=True)
                except OSError:
                    pass
                continue
            picked_sec = sec
            break
        else:
            return []

        raw = tmp_wav.read_bytes()
        if len(raw) > max_b:
            return []
        b64 = base64.standard_b64encode(raw).decode("ascii")
        hint = ""
        if duration_hint and duration_hint > 1:
            hint = f"用户侧标注整曲时长约 {duration_hint:.1f} 秒；你听到的是从 0 秒起约 {picked_sec:.0f} 秒的片头。时间坐标仍相对于片段自身 0 秒。"
        user_content: list[Any] = [
            {
                "type": "input_audio",
                "input_audio": {
                    "data": f"data:audio/wav;base64,{b64}",
                    "format": "wav",
                },
            },
            {"type": "text", "text": hint + "请严格按系统说明只输出 JSON。"},
        ]
        messages = [
            {"role": "system", "content": PLAYBACK_OMNI_TIMELINE_SYSTEM},
            {"role": "user", "content": user_content},
        ]
        omt = min(700, max(320, int(getattr(settings, "judge_omni_max_tokens", 384)) + 120))
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.35,
                max_tokens=omt,
                stream=False,
                extra_body={"modalities": ["text"]},
            )
        except Exception as e:
            logger.info("playback omni timeline modalities failed: %s, retry plain", e)
            try:
                completion = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=0.35,
                    max_tokens=omt,
                    stream=False,
                )
            except Exception as e2:
                logger.warning("playback omni timeline failed: %s", e2)
                return []

        raw_txt = ""
        try:
            raw_txt = completion.choices[0].message.content or ""  # type: ignore[union-attr]
        except Exception:
            raw_txt = ""
        raw_txt = (raw_txt or "").strip()
        try:
            data = _extract_json(raw_txt)
        except json.JSONDecodeError:
            logger.warning("playback omni timeline JSON parse failed: %s", raw_txt[:400])
            return []
        lines_raw = data.get("lines") if isinstance(data, dict) else None
        if not isinstance(lines_raw, list):
            return []
        out: list[dict[str, Any]] = []
        for row in lines_raw:
            if not isinstance(row, dict):
                continue
            try:
                t0 = float(row.get("t0"))
                t1 = float(row.get("t1"))
            except (TypeError, ValueError):
                continue
            zh = str(row.get("zh") or "").strip()
            if not zh or t1 <= t0:
                continue
            out.append({"start": round(t0, 2), "end": round(t1, 2), "text": zh})
        out.sort(key=lambda x: float(x.get("start") or 0))
        return out
    except Exception as e:
        logger.warning("infer_playback_omni_timeline: %s", e)
        return []
    finally:
        try:
            tmp_wav.unlink(missing_ok=True)
        except OSError:
            pass


def transcribe_audio_lyrics(
    settings: Settings,
    audio_path: Path,
) -> dict[str, Any]:
    """
    调用 Whisper 转写人声歌词。
    返回 {"text": str, "language": str, "segments": list}；segments 为 verbose_json 分段时间轴；失败或无人声时 text 为空。
    对日语等会多语言依次尝试，减轻「有歌词却转写不出」的情况。
    """
    empty: dict[str, Any] = {"text": "", "language": "", "segments": []}
    try:
        client = _client(settings)
    except RuntimeError:
        return dict(empty)

    max_bytes = max(1, int(getattr(settings, "audio_transcription_max_bytes", 25 * 1024 * 1024)))
    try:
        raw = audio_path.read_bytes()
    except OSError:
        return dict(empty)
    if len(raw) > max_bytes:
        logger.info("audio transcription skipped: too large (%s bytes)", len(raw))
        return dict(empty)

    model = (getattr(settings, "audio_transcription_model", "whisper-1") or "whisper-1").strip()
    jp_prompt = (
        "歌詞は日本語の可能性があります。ひらがな・カタカナ・漢字をできるだけそのまま書き起こしてください。"
    )

    def _one_call(
        fh,
        *,
        response_format: str,
        language: str | None,
        prompt: str | None,
    ) -> tuple[str, str, list[dict[str, Any]]]:
        kw: dict[str, Any] = {"model": model, "file": fh, "response_format": response_format}
        if language:
            kw["language"] = language
        if prompt:
            kw["prompt"] = prompt[:1200]
        try:
            fh.seek(0)
            resp = client.audio.transcriptions.create(**kw)
            if response_format == "verbose_json":
                return _verbose_transcription_bundle(resp)
            t, lang = _transcription_text_and_lang(resp)
            return t, lang, []
        except TypeError:
            kw.pop("prompt", None)
            fh.seek(0)
            resp = client.audio.transcriptions.create(**kw)
            if response_format == "verbose_json":
                return _verbose_transcription_bundle(resp)
            t, lang = _transcription_text_and_lang(resp)
            return t, lang, []
        except Exception:
            return "", "", []

    try:
        with NamedTemporaryFile(suffix=audio_path.suffix or ".wav", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            with tmp_path.open("rb") as fh:
                hint_any = (
                    "Audio may contain sung lyrics in Japanese (日本語), English, Mandarin, or Korean. "
                    "Transcribe all clearly audible sung words in their original script; do not translate."
                )
                zh_prompt = "请转写歌声中的中文歌词，尽量保留原文用字与断句，不要翻译。"
                cjk_in_name = bool(
                    re.search(r"[\u4e00-\u9fff]", audio_path.name)
                    or re.search(r"[\u3040-\u30ff\uac00-\ud7af]", audio_path.name)
                )
                best_t, best_l, best_segs = "", "", []
                if cjk_in_name and re.search(r"[\u4e00-\u9fff]", audio_path.name):
                    tz, lz, sz = _one_call(
                        fh,
                        response_format="verbose_json",
                        language="zh",
                        prompt=zh_prompt,
                    )
                    if len(tz) > 0:
                        best_t, best_l, best_segs = tz, lz or "zh", sz
                t0, l0, s0 = _one_call(fh, response_format="verbose_json", language=None, prompt=hint_any)
                if len(t0) > len(best_t):
                    best_t, best_l, best_segs = t0, l0, s0
                # 始终与显式日语竞争：自动语言常把 J-POP 误听成短英文碎片
                t1, l1, s1 = _one_call(fh, response_format="verbose_json", language="ja", prompt=jp_prompt)
                if len(t1) > len(best_t):
                    best_t, best_l, best_segs = t1, l1 or "ja", s1
                if len(best_t) >= 12:
                    return {"text": best_t, "language": best_l or "ja", "segments": best_segs}
                for lang_try, prompt in (("ko", None), ("zh", None), ("en", None)):
                    t3, l3, s3 = _one_call(fh, response_format="verbose_json", language=lang_try, prompt=prompt)
                    if len(t3) > len(best_t):
                        best_t, best_l, best_segs = t3, l3 or lang_try, s3
                if len(best_t) >= 4:
                    return {"text": best_t, "language": best_l, "segments": best_segs}
                t4, l4, _s4 = _one_call(fh, response_format="text", language=None, prompt=hint_any)
                if len(t4) > len(best_t):
                    best_t, best_l, best_segs = t4, l4, []
                return {"text": best_t, "language": best_l, "segments": best_segs}
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
    except Exception as e:
        logger.info("audio transcription failed: %s", e)
        return dict(empty)

