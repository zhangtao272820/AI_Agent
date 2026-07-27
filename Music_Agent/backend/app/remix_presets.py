"""重演绎：曲风预设 → 乐队编制（供前端下拉、编配引擎与 LLM）。"""
from __future__ import annotations

import re
from typing import Any

# GM 乐器名见 midi_remap.GM_BY_NAME；channel 9 为鼓轨
_DEFAULT_BAND: list[dict[str, Any]] = [
    {"role": "melody", "channel": 0, "instrument": "piano"},
    {"role": "bass", "channel": 1, "instrument": "bass"},
    {"role": "harmony", "channel": 2, "instrument": "strings"},
    {"role": "pad", "channel": 3, "instrument": "synth"},
    {"role": "drums", "channel": 9, "instrument": "drums"},
]

REMIX_STYLE_PRESETS: dict[str, dict[str, Any]] = {
    "mandopop": {
        "label": "华语流行",
        "harmony_style": "pop",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "piano"},
            {"role": "bass", "channel": 1, "instrument": "bass"},
            {"role": "harmony", "channel": 2, "instrument": "strings"},
            {"role": "pad", "channel": 3, "instrument": "synth"},
            {"role": "drums", "channel": 9, "instrument": "drums"},
        ],
    },
    "jpop": {
        "label": "日系流行",
        "harmony_style": "pop",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "electric_piano"},
            {"role": "bass", "channel": 1, "instrument": "bass"},
            {"role": "harmony", "channel": 2, "instrument": "strings"},
            {"role": "pad", "channel": 3, "instrument": "synth"},
            {"role": "drums", "channel": 9, "instrument": "drums"},
        ],
    },
    "classical": {
        "label": "古典 / 影视",
        "harmony_style": "classical",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "violin"},
            {"role": "bass", "channel": 1, "instrument": "cello"},
            {"role": "harmony", "channel": 2, "instrument": "viola"},
            {"role": "pad", "channel": 3, "instrument": "harp"},
            {"role": "drums", "channel": 9, "instrument": "drums"},
        ],
    },
    "jazz": {
        "label": "爵士",
        "harmony_style": "jazz",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "sax"},
            {"role": "bass", "channel": 1, "instrument": "bass"},
            {"role": "harmony", "channel": 2, "instrument": "electric_piano"},
            {"role": "pad", "channel": 3, "instrument": "guitar"},
            {"role": "drums", "channel": 9, "instrument": "drums"},
        ],
    },
    "folk": {
        "label": "民谣",
        "harmony_style": "folk",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "guitar"},
            {"role": "bass", "channel": 1, "instrument": "bass"},
            {"role": "harmony", "channel": 2, "instrument": "violin"},
            {"role": "pad", "channel": 3, "instrument": "flute"},
            {"role": "drums", "channel": 9, "instrument": "drums"},
        ],
    },
    "electronic": {
        "label": "电子 / 舞曲",
        "harmony_style": "pop",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "synth"},
            {"role": "bass", "channel": 1, "instrument": "bass"},
            {"role": "harmony", "channel": 2, "instrument": "electric_guitar"},
            {"role": "pad", "channel": 3, "instrument": "synth"},
            {"role": "drums", "channel": 9, "instrument": "drums"},
        ],
    },
    "bgm": {
        "label": "氛围 BGM / 影视",
        "harmony_style": "classical",
        "band": [
            {"role": "melody", "channel": 0, "instrument": "flute"},
            {"role": "bass", "channel": 1, "instrument": "cello"},
            {"role": "harmony", "channel": 2, "instrument": "strings"},
            {"role": "pad", "channel": 3, "instrument": "harp"},
        ],
    },
}


def style_label(style_id: str) -> str:
    spec = get_style_spec(style_id)
    return str(spec["label"]) if spec else style_id


def list_remix_presets_payload() -> dict[str, Any]:
    styles = [
        {
            "id": "auto",
            "label": "智能识别（推荐）",
            "harmony_style": "pop",
            "band": [],
            "auto": True,
        }
    ]
    for sid, spec in REMIX_STYLE_PRESETS.items():
        band = list(spec.get("band") or _DEFAULT_BAND)
        styles.append(
            {
                "id": sid,
                "label": spec["label"],
                "harmony_style": spec.get("harmony_style", "pop"),
                "band": [
                    {
                        "role": p.get("role"),
                        "instrument": p.get("instrument"),
                        "label": p.get("label") or p.get("instrument"),
                    }
                    for p in band
                    if isinstance(p, dict) and p.get("role") != "drums"
                ],
            }
        )
    return {"ok": True, "styles": styles}


def get_style_spec(style_id: str) -> dict[str, Any] | None:
    return REMIX_STYLE_PRESETS.get((style_id or "").strip().lower())


def build_band_parts(style_id: str) -> list[dict[str, Any]]:
    spec = get_style_spec(style_id) or REMIX_STYLE_PRESETS["mandopop"]
    parts: list[dict[str, Any]] = []
    for p in spec.get("band") or _DEFAULT_BAND:
        if not isinstance(p, dict):
            continue
        parts.append(
            {
                "role": str(p.get("role") or "part"),
                "channel": int(p.get("channel", 0)),
                "instrument": str(p.get("instrument") or "piano"),
            }
        )
    return parts


def band_parts_to_track_mappings(band_parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按 channel 分配 GM 音色（鼓轨不改 program）。"""
    maps: list[dict[str, Any]] = []
    for p in band_parts:
        ch = int(p.get("channel", 0))
        if ch == 9:
            continue
        inst = str(p.get("instrument") or "piano")
        maps.append({"channel": ch, "to": inst, "to_instrument": inst})
    return maps


def selection_brief(style_id: str) -> str:
    spec = get_style_spec(style_id) or REMIX_STYLE_PRESETS["mandopop"]
    parts = build_band_parts(style_id)
    roles = "、".join(
        f"{p.get('role')}={p.get('instrument')}" for p in parts if p.get("role") != "drums"
    )
    drums = next((p for p in parts if p.get("role") == "drums"), None)
    drum_s = "含鼓组" if drums else ""
    return (
        f"曲风：{spec.get('label', style_id)}；乐队重编（{roles}；{drum_s}）。"
        f"请像资深编曲家一样分配声部、统一节拍，织体贴合该曲风与上传音频气质。"
    )


def infer_style_hint(analysis: dict[str, Any] | None, filename: str = "") -> str:
    """根据上传摘要推断更像哪类曲风，供模型与编配底稿使用。"""
    a = analysis or {}
    low_fn = (filename or str(a.get("filename") or "")).lower()
    text_blob = " ".join(
        str(a.get(k) or "")
        for k in (
            "lyrics_text",
            "lyrics_language",
            "transcription_whisper_language",
            "note",
            "vocal_label",
            "style",
            "suggested_workflow",
            "emotion",
            "genre",
        )
    ).lower()
    combined = f"{low_fn} {text_blob}"
    mode = str(a.get("analysis_mode") or "").lower()
    if mode == "midi":
        notes = int(a.get("notes_estimate") or 0)
        if notes > 0 and notes < 120:
            return "folk"
        if notes > 800:
            return "classical"

    if any(k in combined for k in ("jazz", "swing", "blues", "sax", "improvis", "爵士")):
        return "jazz"
    if any(k in combined for k in ("classical", "orchestra", "symph", "strings", "violin", "piano solo")):
        return "classical"
    if any(k in combined for k in ("folk", "民谣", "acoustic", "guitar", "ukulele")):
        return "folk"
    if any(k in combined for k in ("electro", "dance", "edm", "synth", "club", "techno")):
        return "electronic"
    if any(
        k in combined
        for k in ("bgm", "ambient", "氛围", "配乐", "背景", "纯音乐", "inst", "piano", "钢琴", "轻音乐")
    ):
        return "bgm"
    if mode == "audio" and not any(k in combined for k in ("vocal", "人声", "歌", "lyric")):
        return "bgm"
    if any(k in combined for k in ("jpop", "j-pop", "anime", "idol", "日语", "japanese")):
        return "jpop"
    return "mandopop"
